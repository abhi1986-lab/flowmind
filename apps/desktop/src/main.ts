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
 * This is the absolute minimal shell to satisfy the platform foundation + prepare for real capture.
 * Full implementation (screen capture, event model, secure storage via keytar/electron-safe-storage, etc.)
 * follows Desktop Agent LLD after the first foundation milestone.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

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

  // Minimal manual capture UI for MVP v0 - functional only, no real capture
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
        <h1>FlowMind AI - Manual Capture v0</h1>
        <div id="loginStatus" class="status idle">Not logged in</div>
        <button id="loginBtn">Login (demo contributor@acme.test)</button>

        <div class="section">
          <div>Session: <span id="sessionId">-</span></div>
          <div>Status: <span id="sessionStatus">IDLE</span></div>
          <div>Events sent: <span id="eventCount">0</span></div>
          <button id="createBtn" disabled>Create Session</button>
          <button id="startBtn" disabled>Start Session</button>
          <button id="stopBtn" disabled>Stop Session</button>
        </div>

        <div class="section">
          <strong>Manual Safe Events (no typedText/raw keys ever):</strong><br>
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
        <div id="error" style="color:#f87171"></div>

        <p style="margin-top:12px;font-size:11px;opacity:0.7">
          Manual only. Visible controls. Safe events only. Token in memory. X-Client-Id: acme.
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
            const headers = {
              'Content-Type': 'application/json',
              'X-Client-Id': CLIENT_ID
            };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            const opts = { method, headers };
            if (body) opts.body = JSON.stringify(body);
            try {
              const res = await fetch(API + path, opts);
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
              showResponse(data);
              return data;
            } catch (e) {
              showError(e.message);
              throw e;
            }
          }

          loginBtn.onclick = async () => {
            try {
              const data = await apiCall('POST', '/auth/login', {
                email: 'contributor@acme.test',
                password: 'demo123'
              });
              token = data.accessToken;
              updateUI();
              showResponse({message: 'Login success, token in memory'});
            } catch (e) {}
          };

          createBtn.onclick = async () => {
            try {
              const data = await apiCall('POST', '/agent/sessions', {});
              currentSessionId = data.sessionId;
              isRecording = false;
              eventCount = 0;
              updateUI();
            } catch (e) {}
          };

          startBtn.onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/start');
              isRecording = true;
              updateUI();
            } catch (e) {}
          };

          stopBtn.onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/stop');
              isRecording = false;
              updateUI();
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

          // Init
          updateUI();
          setInterval(updateUI, 1000); // simple refresh
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
