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

  // In real: load a small React/Vite renderer or html UI
  const html = `
    <!doctype html>
    <html>
      <head><meta charset="utf-8"/><title>FlowMind</title>
      <style>body{font-family:system-ui;padding:20px;background:#0f172a;color:#e2e8f0} .status{padding:12px;border-radius:6px;margin:12px 0;font-weight:600} .recording{background:#b91c1c;color:white} .idle{background:#334155}</style>
      </head>
      <body>
        <h1>FlowMind AI</h1>
        <p>Operational Workflow Recorder (MVP)</p>
        <div id="status" class="status idle">IDLE - Not recording</div>
        
        <button id="login">Login (demo)</button>
        <button id="start" disabled>Start Recording</button>
        <button id="pause" disabled>Pause</button>
        <button id="stop" disabled>Stop</button>
        
        <p style="margin-top:24px;font-size:12px;opacity:0.7">
          This is the visible recording shell.<br/>
          Recording indicator must always be obvious while active.<br/>
          Full capture (app/window/events/screenshots + encrypted buffer) comes next.
        </p>
        
        <script>
          const statusEl = document.getElementById('status');
          const startBtn = document.getElementById('start');
          const pauseBtn = document.getElementById('pause');
          const stopBtn = document.getElementById('stop');

          let recording = false;

          function setRecording(on) {
            recording = on;
            statusEl.textContent = on ? '● RECORDING - Visible to user' : 'IDLE - Not recording';
            statusEl.className = 'status ' + (on ? 'recording' : 'idle');
            startBtn.disabled = on;
            pauseBtn.disabled = !on;
            stopBtn.disabled = !on;
          }

          document.getElementById('login').onclick = () => {
            // In real app: open login form, call API /auth/login, store token securely (keytar or safeStorage)
            alert('Demo login would call backend and store JWT for acme client. Token would be attached to uploads.');
          };

          startBtn.onclick = () => {
            // Must be user gesture. Backend will receive /agent/sessions + start
            setRecording(true);
            // TODO: fetch client config (policy), begin capture loop
            console.log('START recording (shell)');
          };

          pauseBtn.onclick = () => { setRecording(false); console.log('PAUSE (shell)'); };
          stopBtn.onclick = () => { setRecording(false); console.log('STOP + upload (shell)'); };

          // Always show obvious state
          setRecording(false);
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
