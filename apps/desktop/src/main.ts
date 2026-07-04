/**
 * FlowMind Desktop Agent - Electron Main (MVP skeleton)
 *
 * Per constraints:
 * - Visible recording indicator at all times when capturing
 * - User-initiated start/pause/stop ONLY
 * - NO keylogging (only safe categories)
 * - Local encrypted buffer (to be implemented)
 * - Upload to backend with proper client JWT (obtained at login)
 *
 * Real Desktop App/Window Capture v0 (per phase scope): automatic active app/window polling (1s, change-only APP_CHANGED/WINDOW_CHANGED), visible RECORDING UX, user-controlled start/stop. Manual test events as dev tools only. Uses existing /events/batch. No screenshots, keys, text, passwords, hidden recording, AI, new tables. URL capture deferred (not sent). Client isolation + control no-op data preserved.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// @ts-ignore - active-win is CJS, works in main process
const activeWin = require('active-win');

const execPromise = promisify(exec);

async function getActiveWindowInfo() {
  // Primary: active-win (may require Accessibility/Screen Recording perms on macOS)
  try {
    const win = await activeWin();
    if (win) return win;
  } catch (err) {
    console.error('active-win error (will try fallback):', (err as Error)?.message || err);
  }
  // Minimal OS-specific fallback for macOS (no new packages, uses built-in osascript + System Events)
  if (process.platform === 'darwin') {
    try {
      const { stdout: appOut } = await execPromise(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || echo 'Unknown'`
      );
      const appName = (appOut || '').trim() || 'Unknown';
      let windowTitle = '';
      try {
        const { stdout: winOut } = await execPromise(
          `osascript -e 'tell application "System Events" to get name of window 1 of (first application process whose frontmost is true)' 2>/dev/null || echo ''`
        );
        windowTitle = (winOut || '').trim();
      } catch {}
      return { owner: { name: appName }, title: windowTitle } as any;
    } catch (e) {
      console.error('mac fallback osascript error:', e);
    }
  }
  return null;
}

let mainWindow: BrowserWindow | null = null;

let recordingInterval: NodeJS.Timeout | null = null;
let lastApp = '';
let lastTitle = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 620,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'FlowMind Recorder',
  });

  // Real active window/app capture UI for Desktop App/Window Capture v0: polling in main, IPC to renderer, auto APP/WINDOW on change while recording. Manual buttons kept as dev tools only.
  const html = `
    <!doctype html>
    <html>
      <head><meta charset="utf-8"/><title>FlowMind</title>
      <style>
        body{font-family:system-ui;padding:16px;background:#0f172a;color:#e2e8f0;font-size:14px}
        .status{padding:8px 12px;border-radius:4px;margin:8px 0;font-weight:600}
        .recording{background:#b91c1c;color:white}
        .idle{background:#334155}
        .loggedin{background:#166534;color:white}
        button{margin:4px;padding:6px 10px;cursor:pointer}
        .section{margin:12px 0;padding:8px;border:1px solid #334155;border-radius:4px}
        .log{white-space:pre-wrap;font-family:monospace;font-size:11px;background:#1e2937;padding:6px;margin-top:4px;max-height:80px;overflow:auto}
        input{padding:4px;margin:2px}
      </style>
      </head>
      <body>
        <h1>FlowMind AI - Real Desktop App/Window Capture v0</h1>
        <div id="loginStatus" class="status idle">Not logged in</div>
        <button id="loginBtn">Login (demo contributor@acme.test)</button>

        <div class="section">
          <div>Session: <span id="sessionId">-</span></div>
          <div>Status: <span id="sessionStatus">IDLE</span></div>
          <div>Events sent: <span id="eventCount">0</span></div>
          <div>Last captured: <span id="lastCaptured">-</span></div>
          <button id="createBtn" disabled>Create Session</button>
          <button id="startBtn" disabled>Start Session</button>
          <button id="stopBtn" disabled>Stop Session</button>
        </div>

        <div class="section">
          <strong>Dev Tools: Manual Safe Events (validation only - main flow is automatic app/window polling):</strong><br>
          <button id="appBtn" disabled>App Changed</button>
          <button id="winBtn" disabled>Window Changed</button>
          <button id="clickBtn" disabled>Mouse Clicked</button>
          <button id="keyBtn" disabled>Key Action: TAB_NAVIGATION</button><br>
          <input id="noteInput" placeholder="Note text" style="width:180px" disabled>
          <button id="noteBtn" disabled>User Note Added</button>
        </div>

        <div class="section">
          <strong>SOP Controls (after Stop):</strong><br>
          <button id="timelineBtn" disabled>Build Timeline</button>
          <button id="sopBtn" disabled>Generate SOP Draft</button>
          <button id="viewerBtn" disabled>Open SOP Viewer (use session ID)</button>
        </div>

        <div>Last API response: <div id="lastResponse" class="log">-</div></div>
        <div id="error" style="color:#f87171; min-height: 1em; font-weight: bold; background: #3f1f1f; padding: 4px; border-radius: 3px;"></div>

        <p style="margin-top:12px;font-size:11px;opacity:0.7">
          RECORDING: Capturing active app/window changes only (polls every 1s, sends APP_CHANGED or WINDOW_CHANGED on change only). No screenshots/keys/text/passwords/clipboard. Visible user-controlled. Token in memory. X-Client-Id: acme.
        </p>

        <script>
          const API = 'http://localhost:4000';
          const CLIENT_ID = 'acme';

          let token = null;
          let currentSessionId = null;
          let eventCount = 0;
          let isRecording = false;

          const loginStatus = document.getElementById('loginStatus');
          const sessionIdEl = document.getElementById('sessionId');
          const sessionStatusEl = document.getElementById('sessionStatus');
          const eventCountEl = document.getElementById('eventCount');
          const lastResponseEl = document.getElementById('lastResponse');
          const errorEl = document.getElementById('error');

          const loginBtn = document.getElementById('loginBtn');
          const createBtn = document.getElementById('createBtn');
          const startBtn = document.getElementById('startBtn');
          const stopBtn = document.getElementById('stopBtn');
          const appBtn = document.getElementById('appBtn');
          const winBtn = document.getElementById('winBtn');
          const clickBtn = document.getElementById('clickBtn');
          const keyBtn = document.getElementById('keyBtn');
          const noteInput = document.getElementById('noteInput');
          const noteBtn = document.getElementById('noteBtn');
          const timelineBtn = document.getElementById('timelineBtn');
          const sopBtn = document.getElementById('sopBtn');
          const viewerBtn = document.getElementById('viewerBtn');

          function updateUI() {
            sessionIdEl.textContent = currentSessionId || '-';
            sessionStatusEl.textContent = isRecording ? 'RECORDING' : (currentSessionId ? 'STOPPED' : 'IDLE');
            eventCountEl.textContent = eventCount;
            const loggedIn = !!token;
            loginStatus.textContent = loggedIn ? 'Logged in (memory token)' : 'Not logged in';
            loginStatus.className = 'status ' + (loggedIn ? 'loggedin' : 'idle');
            const canControl = loggedIn && !!currentSessionId;
            startBtn.disabled = !canControl || isRecording;
            stopBtn.disabled = !canControl || !isRecording;
            appBtn.disabled = !canControl || !isRecording;
            winBtn.disabled = !canControl || !isRecording;
            clickBtn.disabled = !canControl || !isRecording;
            keyBtn.disabled = !canControl || !isRecording;
            noteInput.disabled = !canControl || !isRecording;
            noteBtn.disabled = !canControl || !isRecording;
            createBtn.disabled = !loggedIn || !!currentSessionId;
            const afterStop = loggedIn && currentSessionId && !isRecording;
            timelineBtn.disabled = !afterStop;
            sopBtn.disabled = !afterStop;
            viewerBtn.disabled = !afterStop;
          }

          function showResponse(data) {
            lastResponseEl.textContent = JSON.stringify(data, null, 2);
            errorEl.textContent = '';
          }

          function showError(msg) {
            errorEl.textContent = msg;
            console.error(msg);
          }

          async function apiCall(method, path, body = null) {
            try {
              if (!window.flowmind || typeof window.flowmind.apiRequest !== 'function') {
                showError('API bridge not available (preload not loaded?)');
                throw new Error('API bridge not available');
              }
              const result = await window.flowmind.apiRequest(method, path, body, token);
              if (result && result.error) {
                showError(result.error);
                throw new Error(result.error);
              }
              const data = result || {};
              showResponse(data);
              return data;
            } catch (e) {
              showError((e && e.message) || 'Request failed');
              throw e;
            }
          }

          loginBtn.onclick = async () => {
            showResponse({message: 'Login clicked - calling API...'});
            try {
              const data = await apiCall('POST', '/auth/login', {
                email: 'contributor@acme.test',
                password: 'demo123'
              });
              if (data && data.accessToken) {
                token = data.accessToken;
                updateUI();
                showResponse({message: 'Login success! Token set. UI should update.'});
              } else {
                showError('Login response had no accessToken: ' + JSON.stringify(data));
              }
            } catch (e) {
              const msg = (e && e.message) ? e.message : (e ? String(e) : 'unknown error');
              showError('Login error: ' + msg);
            }
          };

          createBtn.onclick = async () => {
            showResponse({message: 'Creating session...'});
            try {
              const data = await apiCall('POST', '/agent/sessions', {});
              currentSessionId = data.sessionId;
              isRecording = false;
              eventCount = 0;
              updateUI();
              showResponse({message: 'Session created: ' + currentSessionId});
            } catch (e) {
              showError('Create session failed: ' + ((e && e.message) || e));
            }
          };

          startBtn.onclick = async () => {
            if (!currentSessionId) return;
            showResponse({message: 'Starting session...'});
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/start');
              isRecording = true;
              updateUI();
              window.flowmind.startRecording(currentSessionId);
              showResponse({message: 'Recording started. Switch apps now.'});
            } catch (e) {
              showError('Start failed: ' + ((e && e.message) || e));
            }
          };

          stopBtn.onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/stop');
              isRecording = false;
              updateUI();
              window.flowmind.stopRecording();
            } catch (e) {}
          };

          function sendEvent(eventObj) {
            if (!currentSessionId || !isRecording) return;
            const payload = {
              sessionId: currentSessionId,
              events: [eventObj]
            };
            apiCall('POST', '/agent/events/batch', payload).then(() => {
              eventCount++;
              updateUI();
            }).catch(() => {});
          }

          appBtn.onclick = () => sendEvent({
            sequenceNo: eventCount + 1,
            eventType: 'APP_CHANGED',
            timestamp: new Date().toISOString(),
            appName: 'DemoBrowser',
            windowTitle: 'Main Window'
          });

          winBtn.onclick = () => sendEvent({
            sequenceNo: eventCount + 1,
            eventType: 'WINDOW_CHANGED',
            timestamp: new Date().toISOString(),
            appName: 'DemoBrowser',
            windowTitle: 'Dashboard'
          });

          clickBtn.onclick = () => sendEvent({
            sequenceNo: eventCount + 1,
            eventType: 'MOUSE_CLICK',
            timestamp: new Date().toISOString(),
            appName: 'DemoBrowser',
            windowTitle: 'Main Window'
          });

          keyBtn.onclick = () => sendEvent({
            sequenceNo: eventCount + 1,
            eventType: 'KEY_ACTION',
            timestamp: new Date().toISOString(),
            appName: 'DemoBrowser',
            windowTitle: 'Main Window',
            metadata: { action: 'TAB_NAVIGATION' }
          });

          noteBtn.onclick = () => {
            const note = noteInput.value.trim();
            if (!note) return;
            sendEvent({
              sequenceNo: eventCount + 1,
              eventType: 'USER_NOTE',
              timestamp: new Date().toISOString(),
              appName: 'DemoBrowser',
              windowTitle: 'Main Window',
              metadata: { note: note }
            });
            noteInput.value = '';
          };

          timelineBtn.onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/build-timeline');
            } catch (e) {}
          };

          sopBtn.onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/generate-sop-draft');
            } catch (e) {}
          };

          viewerBtn.onclick = () => {
            if (!currentSessionId) return;
            const url = 'http://localhost:3000/sop-viewer';
            alert('Open ' + url + ' in browser and enter session ID: ' + currentSessionId + ' (or use the fetch in the viewer with your token).');
            // In real Electron: require('electron').shell.openExternal(url);
          };

          window.flowmind.onActiveWindowChanged((data) => {
            if (isRecording && currentSessionId) {
              const eventObj = {
                sequenceNo: eventCount + 1,
                eventType: data.eventType,
                timestamp: data.timestamp,
                appName: data.appName,
                windowTitle: data.windowTitle
              };
              // update last captured UI
              const lastCap = document.getElementById('lastCaptured');
              if (lastCap) lastCap.textContent = data.appName + ' - ' + data.windowTitle;
              sendEvent(eventObj);
            }
          });

          // Init
          updateUI();
          setInterval(updateUI, 1000); // simple refresh

          // No auto; user-controlled via visible buttons. Polling starts only on explicit Start + window.flowmind.startRecording. Dev tools manual buttons available during recording.
        </script>
      </body>
    </html>
  `;

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC stubs for renderer -> main secure token storage etc.
ipcMain.handle('get-token', async () => null);

ipcMain.handle('api-request', async (event, {method, path, body, authToken}) => {
  console.log('[main] api-request received:', method, path, 'hasToken:', !!authToken);
  const API = 'http://localhost:4000';
  const headers: any = {
    'Content-Type': 'application/json',
    'X-Client-Id': 'acme'
  };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const opts: any = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API + path, opts);
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log('[main] api-request error response:', data);
      return { error: data.message || 'HTTP ' + res.status };
    }
    console.log('[main] api-request success for', path, 'data has accessToken:', !!data.accessToken);
    return data;
  } catch (e: any) {
    console.log('[main] api-request network error:', e.message);
    return { error: e.message || 'Network error' };
  }
});

ipcMain.on('start-recording', (event, sessionId: string) => {
  if (recordingInterval) clearInterval(recordingInterval);
  lastApp = '';
  lastTitle = '';
  recordingInterval = setInterval(async () => {
    try {
      const win = await getActiveWindowInfo();
      if (!win) return;
      const appName = (win.owner && win.owner.name) || 'Unknown';
      const windowTitle = win.title || '';
      const timestamp = new Date().toISOString();
      let eventType = '';
      if (appName !== lastApp) {
        eventType = 'APP_CHANGED';
        lastApp = appName;
        lastTitle = windowTitle;
      } else if (windowTitle !== lastTitle) {
        eventType = 'WINDOW_CHANGED';
        lastTitle = windowTitle;
      }
      if (eventType && mainWindow) {
        mainWindow.webContents.send('active-window-changed', {
          eventType,
          timestamp,
          appName,
          windowTitle,
          url: (win as any).url || undefined
        });
      }
    } catch (err) {
      console.error('getActiveWindowInfo error:', err);
    }
  }, 1000);
});

ipcMain.on('stop-recording', () => {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
});
