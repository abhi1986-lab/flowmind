/**
 * FlowMind Desktop Agent - Electron Main
 *
 * Capture model v3 (consent-based, visible, user-controlled):
 * - App / window switches, browser URL + tab title
 * - Mouse clicks + Tab/Enter/Escape (no keystream)
 * - Accessibility focus path when available
 * - Opt-in TEXT CONTEXT (not keylogging):
 *     - TEXT_INPUT: field value snapshot on commit (Enter) or focus leave
 *     - PASTE_INPUT: clipboard text on Cmd/Ctrl+V (redacted)
 *
 * Privacy:
 * - Never store raw keystreams
 * - Secure/password fields never captured
 * - FlowMind recorder window is ignored
 * - Text context only when operator enables Intent Capture for the session
 */

import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';

// @ts-ignore
const activeWin = require('active-win');

type UiSnapshot = {
  appName: string;
  windowTitle: string;
  pageTitle?: string;
  url?: string;
  document?: string;
  focusedRole?: string;
  focusedName?: string;
  focusedDescription?: string;
  focusedValue?: string;
  /** Non-secure field text for intent capture (on-commit). Not a keystream. */
  intentText?: string;
  focusPath?: string;
  selection?: string;
  actionHint?: string;
  fingerprint: string;
};

const MISSING = /^(missing value|null|undefined|none|)$/i;
const SECURE_ROLES = /secure|password|AXSecureTextField|passwd/i;

function clean(s: unknown, max = 200): string | undefined {
  if (s == null) return undefined;
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (!t || MISSING.test(t)) return undefined;
  if (t.startsWith('«class')) return undefined;
  if (t.length > max) t = t.slice(0, max) + '…';
  return t;
}

function isSensitiveRole(role?: string, name?: string): boolean {
  const blob = `${role || ''} ${name || ''}`;
  return SECURE_ROLES.test(blob) || /password|passcode|otp|secret|api.?key|token/i.test(blob);
}

function sanitizeFieldValue(
  role: string | undefined,
  name: string | undefined,
  raw: string | undefined,
): string | undefined {
  if (!raw || MISSING.test(raw)) return undefined;
  if (isSensitiveRole(role, name)) return '[redacted-secure-field]';
  if (raw.length > 80) return `[text length ${raw.length}]`;
  if (/^\d{8,}$/.test(raw)) return '[numeric-id]';
  return clean(raw, 80);
}

function looksLikeSecret(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/^(sk-|xai-|ghp_|gho_|AKIA|ASIA|xox[baprs]-)/i.test(t)) return true;
  if (/password\s*[:=]/i.test(t) && t.length < 80) return true;
  if (/^-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(t)) return true;
  if (/bearer\s+[a-z0-9._\-]+/i.test(t)) return true;
  return false;
}

/** Intent-safe text: final field/clipboard content, never secure fields or secrets. */
function toIntentText(
  role: string | undefined,
  name: string | undefined,
  raw: string | undefined,
  max = 1500,
): string | undefined {
  if (!raw || MISSING.test(raw)) return undefined;
  if (isSensitiveRole(role, name)) return undefined;
  const t = String(raw).replace(/\r\n/g, '\n').trim();
  if (!t || MISSING.test(t)) return undefined;
  if (looksLikeSecret(t)) return undefined;
  // Skip pure UI noise
  if (t.length < 2) return undefined;
  if (t.length > max) return t.slice(0, max) + '…';
  return t;
}

function isFlowMindWindow(appName: string, windowTitle: string): boolean {
  const a = (appName || '').toLowerCase();
  const t = (windowTitle || '').toLowerCase();
  if (t.includes('flowmind')) return true;
  // Electron shell showing our recorder title
  if ((a === 'electron' || a.includes('flowmind')) && (t.includes('flowmind') || t.includes('recorder') || !t)) {
    // only treat as FM if title looks like recorder OR empty electron during our session
    if (t.includes('flowmind') || t.includes('activity capture') || t.includes('recorder')) return true;
  }
  return false;
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out.trim()));
    try {
      child.stdin.write(script);
      child.stdin.end();
    } catch {
      resolve('');
    }
  });
}

async function getBrowserInfo(appName: string): Promise<{ url?: string; pageTitle?: string }> {
  const lower = (appName || '').toLowerCase();
  try {
    if (
      lower.includes('chrome') ||
      lower.includes('chromium') ||
      lower.includes('brave') ||
      lower.includes('edge') ||
      lower.includes('arc')
    ) {
      const appTarget = lower.includes('brave')
        ? 'Brave Browser'
        : lower.includes('edge')
          ? 'Microsoft Edge'
          : lower.includes('arc')
            ? 'Arc'
            : 'Google Chrome';
      const out = await runOsascript(`
try
  tell application "${appTarget}"
    set u to URL of active tab of front window
    set t to title of active tab of front window
    return u & "|||" & t
  end tell
on error
  return "|||"
end try
`);
      const [u, t] = (out || '').split('|||');
      return { url: clean(u, 500), pageTitle: clean(t, 160) };
    }
    if (lower.includes('safari')) {
      const out = await runOsascript(`
try
  tell application "Safari"
    set u to URL of front document
    set t to name of front document
    return u & "|||" & t
  end tell
on error
  return "|||"
end try
`);
      const [u, t] = (out || '').split('|||');
      return { url: clean(u, 500), pageTitle: clean(t, 160) };
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Resolve System Events process name (often differs from active-win owner name). */
async function resolveProcessName(preferred: string): Promise<string> {
  const out = await runOsascript(`
tell application "System Events"
  try
    return name of first application process whose frontmost is true
  on error
    return "${(preferred || 'Unknown').replace(/"/g, '')}"
  end try
end tell
`);
  return clean(out, 80) || preferred || 'Unknown';
}

async function captureUiSnapshot(): Promise<UiSnapshot | null> {
  let appName = 'Unknown';
  let windowTitle = '';

  try {
    const win = await activeWin();
    if (win) {
      appName = win.owner?.name || (win as any).app || 'Unknown';
      windowTitle = win.title || '';
    }
  } catch (err) {
    console.error('active-win error:', (err as Error)?.message || err);
  }

  if (process.platform === 'darwin') {
    const proc = await resolveProcessName(appName);
    if (proc) appName = proc;
    if (!windowTitle) {
      const t = await runOsascript(`
tell application "System Events"
  try
    set p to first application process whose frontmost is true
    return name of window 1 of p
  on error
    return ""
  end try
end tell
`);
      windowTitle = clean(t, 200) || '';
    }
  }

  if (process.platform !== 'darwin') {
    return {
      appName,
      windowTitle,
      fingerprint: `${appName}|${windowTitle}`,
      actionHint: windowTitle ? `work in window "${windowTitle}"` : `work in application "${appName}"`,
    };
  }

  const safeApp = (appName || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Focused control + parent path + selection + document + web area
  const axOut = await runOsascript(`
tell application "System Events"
  try
    set p to first application process whose name is "${safeApp}"
  on error
    try
      set p to first application process whose frontmost is true
    on error
      return "ERR"
    end try
  end try

  set roleV to ""
  set nameV to ""
  set descV to ""
  set valV to ""
  set selV to ""
  set docV to ""
  set webV to ""
  set pathV to ""
  set helpV to ""

  try
    set w to window 1 of p
    try
      set docV to value of attribute "AXDocument" of w
    end try

    try
      set focusedEl to value of attribute "AXFocusedUIElement" of p
      try
        set roleV to role of focusedEl
      end try
      try
        set nameV to name of focusedEl
      end try
      try
        set descV to description of focusedEl
      end try
      try
        set helpV to help of focusedEl
      end try
      try
        set valV to value of focusedEl as text
      end try

      -- Build short parent path for SOP context
      set pathParts to {}
      set cur to focusedEl
      repeat 4 times
        try
          set nm to ""
          try
            set nm to name of cur
          end try
          if nm is missing value then set nm to ""
          set rl to ""
          try
            set rl to role of cur
          end try
          if nm is not "" then
            set end of pathParts to nm
          else if rl is not "" then
            set end of pathParts to rl
          end if
          set cur to value of attribute "AXParent" of cur
        on error
          exit repeat
        end try
      end repeat
      if (count of pathParts) > 0 then
        set AppleScript's text item delimiters to " > "
        set pathV to pathParts as text
        set AppleScript's text item delimiters to ""
      end if

      try
        set selectedChildren to value of attribute "AXSelectedChildren" of focusedEl
        set selParts to {}
        repeat with sc in selectedChildren
          try
            set end of selParts to (name of sc as text)
          end try
        end repeat
        if (count of selParts) > 0 then
          set AppleScript's text item delimiters to ", "
          set selV to selParts as text
          set AppleScript's text item delimiters to ""
        end if
      end try
    end try

    if selV is "" then
      try
        set outs to UI elements of w
        repeat with el in outs
          try
            set selectedChildren to value of attribute "AXSelectedChildren" of el
            set selParts to {}
            repeat with sc in selectedChildren
              try
                set end of selParts to (name of sc as text)
              end try
            end repeat
            if (count of selParts) > 0 then
              set AppleScript's text item delimiters to ", "
              set selV to selParts as text
              set AppleScript's text item delimiters to ""
              exit repeat
            end if
          end try
        end repeat
      end try
    end if

    try
      set webAreas to every UI element of w whose role is "AXWebArea"
      if (count of webAreas) > 0 then
        set webV to name of item 1 of webAreas
      end if
    end try
  end try

  return roleV & "|||" & nameV & "|||" & descV & "|||" & valV & "|||" & selV & "|||" & docV & "|||" & webV & "|||" & pathV & "|||" & helpV
end tell
`);

  let focusedRole: string | undefined;
  let focusedName: string | undefined;
  let focusedDescription: string | undefined;
  let focusedValue: string | undefined;
  let intentText: string | undefined;
  let selection: string | undefined;
  let document: string | undefined;
  let webTitle: string | undefined;
  let focusPath: string | undefined;
  let focusedHelp: string | undefined;

  if (axOut && axOut !== 'ERR') {
    const parts = axOut.split('|||');
    focusedRole = clean(parts[0], 80);
    focusedName = clean(parts[1], 120);
    focusedDescription = clean(parts[2], 160) || clean(parts[8], 160);
    focusedHelp = clean(parts[8], 160);
    const rawValFull =
      parts[3] && !MISSING.test(String(parts[3]).trim()) ? String(parts[3]).trim() : undefined;
    const rawVal = clean(rawValFull, 500);
    focusedValue = sanitizeFieldValue(focusedRole, focusedName, rawVal);
    intentText = toIntentText(focusedRole, focusedName, rawValFull, 1500);
    selection = clean(parts[4], 200);
    document = clean(parts[5], 300);
    if (document?.startsWith('file://')) {
      try {
        document = decodeURIComponent(document.replace(/^file:\/\//, ''));
      } catch {
        /* keep */
      }
    }
    webTitle = clean(parts[6], 160);
    focusPath = clean(parts[7], 200);
  }

  const browser = await getBrowserInfo(appName);
  let url = browser.url;
  let pageTitle = browser.pageTitle || webTitle;
  if (!url && /https?:\/\//i.test(windowTitle)) {
    const m = windowTitle.match(/https?:\/\/\S+/i);
    if (m) url = clean(m[0], 500);
  }

  // Prefer tab title over bare window chrome
  if (pageTitle && (!windowTitle || windowTitle === appName)) {
    windowTitle = pageTitle;
  }

  const actionHint = buildActionHint({
    appName,
    windowTitle,
    pageTitle,
    url,
    document,
    focusedRole,
    focusedName,
    focusedDescription: focusedDescription || focusedHelp,
    focusedValue,
    selection,
    focusPath,
    click: false,
  });

  const fingerprint = [
    appName,
    windowTitle,
    pageTitle || '',
    url || '',
    focusedRole || '',
    focusedName || '',
    focusPath || '',
    selection || '',
    document || '',
  ].join('|');

  return {
    appName,
    windowTitle,
    pageTitle,
    url,
    document,
    focusedRole,
    focusedName,
    focusedDescription: focusedDescription || focusedHelp,
    focusedValue,
    intentText,
    focusPath,
    selection,
    actionHint,
    fingerprint,
  };
}

function isChatLikeApp(appName: string): boolean {
  return /chatgpt|claude|gemini|slack|discord|messages|whatsapp|teams/i.test(appName || '');
}

function buildActionHint(s: {
  appName: string;
  windowTitle: string;
  pageTitle?: string;
  url?: string;
  document?: string;
  focusedRole?: string;
  focusedName?: string;
  focusedDescription?: string;
  focusedValue?: string;
  selection?: string;
  focusPath?: string;
  click?: boolean;
  /** When true, do not restate "open page" — user is already there */
  alreadyOnPage?: boolean;
  keyAction?: string;
}): string {
  const role = (s.focusedRole || '').toLowerCase();
  const name = s.focusedName || s.focusedDescription || '';
  const parts: string[] = [];
  const clickVerb = s.click ? 'click' : 'focus';

  // Safe key categories — no character stream / no message content
  if (s.keyAction === 'ENTER_SUBMIT') {
    if (isChatLikeApp(s.appName)) {
      return 'send/submit a message (typed text is NOT recorded — add a User Note describing the prompt)';
    }
    return name
      ? `press Enter to submit on "${name}"`
      : 'press Enter to submit';
  }
  if (s.keyAction === 'TAB_NAVIGATION') {
    if (!name && isChatLikeApp(s.appName)) return ''; // pure noise
    return name ? `press Tab to reach "${name}"` : '';
  }
  if (s.keyAction === 'ESC_CANCEL') return 'press Escape to cancel/close';

  // Navigation (only when not already on page / not a pure click)
  if (!s.alreadyOnPage && !s.click) {
    if (s.url) {
      if (s.pageTitle) parts.push(`open page "${s.pageTitle}" (${s.url})`);
      else parts.push(`open ${s.url}`);
    } else if (s.pageTitle) {
      parts.push(`view "${s.pageTitle}"`);
    }
  }

  if (s.selection) {
    parts.push(`select "${s.selection}"`);
  }

  if (name || s.focusedRole) {
    if (/button|btn|axbutton/i.test(role)) {
      parts.push(`${clickVerb} button "${name || 'button'}"`);
    } else if (/link|axlink/i.test(role)) {
      parts.push(`${s.click ? 'open' : 'focus'} link "${name || 'link'}"`);
    } else if (/text|field|area|combo|search|edit|axtext/i.test(role)) {
      if (s.focusedValue === '[redacted-secure-field]') {
        parts.push(`${clickVerb} secure field "${name || 'password'}"`);
      } else {
        // Never attach free-text field contents (privacy / no form-value capture)
        parts.push(`${clickVerb} field "${name || 'text field'}"`);
      }
    } else if (/menu|menuitem/i.test(role)) {
      parts.push(`use menu "${name || 'menu'}"`);
    } else if (/checkbox|radio|toggle|switch/i.test(role)) {
      parts.push(`toggle "${name || s.focusedRole}"`);
    } else if (/tab|axtab/i.test(role)) {
      parts.push(`select tab "${name || 'tab'}"`);
    } else if (name) {
      parts.push(`${clickVerb} "${name}"`);
    } else if (s.click) {
      parts.push(`click the ${s.focusedRole || 'active'} control`);
    }
  } else if (s.click) {
    if (s.url || s.pageTitle) {
      const place = s.url
        ? (() => {
            try {
              const u = new URL(s.url!);
              return `${u.pathname}${u.hash}` || u.host;
            } catch {
              return s.pageTitle || s.url;
            }
          })()
        : s.pageTitle;
      parts.push(`click on ${place}`);
    } else if (isChatLikeApp(s.appName)) {
      parts.push('click in the chat window');
    } else if (s.windowTitle) {
      parts.push(`click inside "${s.windowTitle}"`);
    } else {
      parts.push(`click inside ${s.appName}`);
    }
  }

  if (s.document) parts.push(`document: ${s.document}`);

  if (parts.length === 0) {
    if (s.windowTitle) return `work in window "${s.windowTitle}"`;
    return `work in application "${s.appName}"`;
  }

  return parts.join('; ');
}

function snapToPayload(
  snap: UiSnapshot,
  eventType: string,
  extras?: Record<string, string>,
) {
  const metadata: Record<string, string> = { ...(extras || {}) };
  if (snap.url) metadata.url = snap.url;
  if (snap.pageTitle) metadata.pageTitle = snap.pageTitle;
  if (snap.document) metadata.document = snap.document;
  if (snap.focusedRole) metadata.focusedRole = snap.focusedRole;
  if (snap.focusedName) {
    metadata.focusedName = snap.focusedName;
    metadata.focusedElement = snap.focusedName;
  } else if (snap.focusedRole) {
    metadata.focusedElement = snap.focusedRole;
  }
  if (snap.focusedDescription) metadata.focusedDescription = snap.focusedDescription;
  if (snap.focusedValue) metadata.value = snap.focusedValue;
  if (snap.focusPath) metadata.focusPath = snap.focusPath;
  if (snap.selection) metadata.selection = snap.selection;
  if (snap.actionHint) metadata.actionHint = snap.actionHint;

  return {
    eventType,
    timestamp: new Date().toISOString(),
    appName: snap.appName,
    windowTitle: snap.pageTitle || snap.windowTitle,
    url: snap.url,
    pageTitle: snap.pageTitle,
    document: snap.document,
    focusedRole: snap.focusedRole,
    focusedName: snap.focusedName,
    focusedElement: snap.focusedName || snap.focusedRole,
    focusedDescription: snap.focusedDescription,
    focusedValue: snap.focusedValue,
    focusPath: snap.focusPath,
    selection: snap.selection,
    actionHint: snap.actionHint,
    metadata,
  };
}

let mainWindow: BrowserWindow | null = null;
let recordingInterval: NodeJS.Timeout | null = null;
let hooksRunning = false;
let captureArmed = false; // true only while user-started recording
let clickBusy = false;
let hooksWired = false;
/** Opt-in: capture field/paste text on commit (not a keystream). */
let intentCaptureEnabled = true;
/** Track last focused field text to emit on focus-leave. */
let pendingField: {
  appName: string;
  windowTitle: string;
  url?: string;
  pageTitle?: string;
  fieldName?: string;
  fieldRole?: string;
  text: string;
} | null = null;
let lastEmittedIntentHash = '';

// Optional global mouse/key hooks (safe categories only for keys)
let uiohookMod: {
  uIOhook: {
    on: (ev: string, cb: (e: any) => void) => void;
    start: () => void;
    stop: () => void;
  };
  UiohookKey: Record<string, number>;
} | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  uiohookMod = require('uiohook-napi');
  console.log('[capture] uiohook-napi loaded — mouse click capture enabled');
} catch (e) {
  console.warn('[capture] uiohook-napi unavailable — click capture disabled:', (e as Error).message);
  uiohookMod = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'FlowMind Recorder',
  });

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
        .log{white-space:pre-wrap;font-family:monospace;font-size:11px;background:#1e2937;padding:6px;margin-top:4px;max-height:100px;overflow:auto}
        input{padding:4px;margin:2px;width:min(100%,280px)}
        .hint{margin-top:12px;font-size:11px;opacity:0.8;line-height:1.45}
        code{background:#1e2937;padding:1px 4px;border-radius:3px}
      </style>
      </head>
      <body>
        <h1>FlowMind — Activity Capture v3</h1>
        <div id="loginStatus" class="status idle">Not logged in</div>
        <button id="loginBtn">Login (demo contributor@acme.test)</button>

        <div class="section">
          <div>Session: <span id="sessionId">-</span></div>
          <div>Status: <span id="sessionStatus">IDLE</span></div>
          <div>Events sent: <span id="eventCount">0</span></div>
          <div>Last captured: <span id="lastCaptured">-</span></div>
          <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0;cursor:pointer">
            <input id="intentToggle" type="checkbox" checked style="width:auto;margin-top:3px" />
            <span>
              <strong>Intent text capture</strong> (recommended for robust SOPs)<br/>
              <span style="opacity:0.75">Captures field text on Enter/focus-leave and paste — <em>not</em> a keystream. Passwords never captured.</span>
            </span>
          </label>
          <button id="createBtn" disabled>Create Session</button>
          <button id="startBtn" disabled>Start Session</button>
          <button id="stopBtn" disabled>Stop Session</button>
        </div>

        <div class="section">
          <strong>Annotate (backup when apps hide text):</strong><br>
          <input id="noteInput" placeholder="e.g. Asked ChatGPT to summarize Q3 report" disabled>
          <button id="noteBtn" disabled>Add User Note</button>
        </div>

        <div class="section">
          <strong>SOP:</strong>
          <button id="timelineBtn" disabled>Build Timeline</button>
          <button id="sopBtn" disabled>Generate SOP Draft</button>
          <button id="viewerBtn" disabled>Open SOP Viewer</button>
        </div>

        <div>Last API response: <div id="lastResponse" class="log">-</div></div>
        <div id="error" style="color:#f87171;min-height:1em;font-weight:bold"></div>

        <p class="hint">
          <b>Captures:</b> apps, URLs, clicks, Tab/Enter/Esc,
          and (if Intent on) <b>committed text + pastes</b> for SOP context.<br/><br/>
          This is <b>not keylogging</b>: we never store per-key events; only snapshots on commit/paste.
          Grant <b>Accessibility</b> + <b>Input Monitoring</b>. FlowMind’s window is ignored.<br/><br/>
          If ChatGPT hides text from Accessibility, paste prompts or add a User Note.
        </p>

        <script>
          let token = null;
          let currentSessionId = null;
          let eventCount = 0;
          let isRecording = false;

          const $ = (id) => document.getElementById(id);
          function updateUI() {
            $('sessionId').textContent = currentSessionId || '-';
            $('sessionStatus').textContent = isRecording ? 'RECORDING' : (currentSessionId ? 'STOPPED' : 'IDLE');
            $('eventCount').textContent = eventCount;
            const loggedIn = !!token;
            $('loginStatus').textContent = loggedIn ? 'Logged in' : 'Not logged in';
            $('loginStatus').className = 'status ' + (loggedIn ? 'loggedin' : 'idle');
            const can = loggedIn && !!currentSessionId;
            $('startBtn').disabled = !can || isRecording;
            $('stopBtn').disabled = !can || !isRecording;
            $('noteInput').disabled = !can || !isRecording;
            $('noteBtn').disabled = !can || !isRecording;
            $('createBtn').disabled = !loggedIn || !!currentSessionId;
            const after = loggedIn && currentSessionId && !isRecording;
            $('timelineBtn').disabled = !after;
            $('sopBtn').disabled = !after;
            $('viewerBtn').disabled = !after;
          }
          function showResponse(data) {
            $('lastResponse').textContent = JSON.stringify(data, null, 2);
            $('error').textContent = '';
          }
          function showError(msg) {
            $('error').textContent = msg;
            console.error(msg);
          }
          async function apiCall(method, path, body = null) {
            if (!window.flowmind || typeof window.flowmind.apiRequest !== 'function') {
              throw new Error('API bridge not available');
            }
            const result = await window.flowmind.apiRequest(method, path, body, token);
            if (result && result.error) throw new Error(result.error);
            showResponse(result || {});
            return result || {};
          }

          $('loginBtn').onclick = async () => {
            try {
              const data = await apiCall('POST', '/auth/login', {
                email: 'contributor@acme.test', password: 'demo123'
              });
              if (data.accessToken) { token = data.accessToken; updateUI(); }
              else showError('No accessToken');
            } catch (e) { showError(e.message || e); }
          };
          $('createBtn').onclick = async () => {
            try {
              const data = await apiCall('POST', '/agent/sessions', {});
              currentSessionId = data.sessionId;
              isRecording = false; eventCount = 0; updateUI();
            } catch (e) { showError(e.message || e); }
          };
          $('intentToggle').onchange = () => {
            if (window.flowmind.setIntentCapture) {
              window.flowmind.setIntentCapture(!!$('intentToggle').checked);
            }
          };
          // sync default
          if (window.flowmind.setIntentCapture) {
            window.flowmind.setIntentCapture(!!$('intentToggle').checked);
          }

          $('startBtn').onclick = async () => {
            if (!currentSessionId) return;
            try {
              if (window.flowmind.setIntentCapture) {
                window.flowmind.setIntentCapture(!!$('intentToggle').checked);
              }
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/start');
              isRecording = true; updateUI();
              window.flowmind.startRecording(currentSessionId);
              showResponse({
                message: $('intentToggle').checked
                  ? 'Recording with intent text capture (on-commit + paste).'
                  : 'Recording without text capture. Use User Notes for intent.'
              });
            } catch (e) { showError(e.message || e); }
          };
          $('stopBtn').onclick = async () => {
            if (!currentSessionId) return;
            try {
              await apiCall('POST', '/agent/sessions/' + currentSessionId + '/stop');
              isRecording = false; updateUI();
              window.flowmind.stopRecording();
            } catch (e) {}
          };
          function sendEvent(eventObj) {
            if (!currentSessionId || !isRecording) return;
            apiCall('POST', '/agent/events/batch', {
              sessionId: currentSessionId,
              events: [eventObj]
            }).then(() => { eventCount++; updateUI(); }).catch(() => {});
          }
          $('noteBtn').onclick = () => {
            const note = $('noteInput').value.trim();
            if (!note) return;
            sendEvent({
              sequenceNo: eventCount + 1,
              eventType: 'USER_NOTE',
              timestamp: new Date().toISOString(),
              appName: 'Operator',
              windowTitle: 'Note',
              metadata: { note, actionHint: note }
            });
            $('noteInput').value = '';
          };
          $('timelineBtn').onclick = async () => {
            try { await apiCall('POST', '/agent/sessions/' + currentSessionId + '/build-timeline'); } catch (e) {}
          };
          $('sopBtn').onclick = async () => {
            try { await apiCall('POST', '/agent/sessions/' + currentSessionId + '/generate-sop-draft'); } catch (e) {}
          };
          $('viewerBtn').onclick = () => {
            alert('Open http://localhost:3000/sop-viewer?sessionId=' + currentSessionId);
          };

          window.flowmind.onActiveWindowChanged((data) => {
            if (!isRecording || !currentSessionId) return;
            const metadata = Object.assign({}, data.metadata || {});
            ['url','pageTitle','document','focusedRole','focusedName','focusedElement',
             'focusedDescription','value','focusPath','selection','actionHint','action',
             'text','textPreview','captureMode'].forEach((k) => {
              if (data[k] && !metadata[k]) metadata[k] = data[k];
            });
            if (data.focusedValue && !metadata.value) metadata.value = data.focusedValue;
            if (data.metadata) {
              Object.keys(data.metadata).forEach((k) => {
                if (data.metadata[k] != null && metadata[k] == null) metadata[k] = data.metadata[k];
              });
            }
            Object.keys(metadata).forEach((k) => {
              if (metadata[k] == null || metadata[k] === '' || metadata[k] === 'missing value') delete metadata[k];
            });
            const eventObj = {
              sequenceNo: eventCount + 1,
              eventType: data.eventType,
              timestamp: data.timestamp,
              appName: data.appName,
              windowTitle: data.windowTitle,
            };
            if (Object.keys(metadata).length) eventObj.metadata = metadata;
            const lastCap = $('lastCaptured');
            if (lastCap) lastCap.textContent = data.actionHint || (data.eventType + ' · ' + data.appName);
            sendEvent(eventObj);
          });

          if (window.flowmind.onCaptureTip) {
            window.flowmind.onCaptureTip((tip) => {
              const err = $('error');
              if (err) {
                err.style.color = '#fbbf24';
                err.textContent = tip && tip.message ? tip.message : '';
                setTimeout(() => { if (err.textContent === (tip && tip.message)) err.textContent = ''; }, 8000);
              }
              // Focus note field so user can type intent quickly
              try { $('noteInput').focus(); } catch (e) {}
            });
          }

          updateUI();
          setInterval(updateUI, 1000);
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
  stopCaptureHooks();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-token', async () => null);

ipcMain.handle('api-request', async (_event, { method, path: apiPath, body, authToken }) => {
  console.log('[main] api-request', method, apiPath, 'hasToken:', !!authToken);
  const API = 'http://localhost:4000';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': 'acme',
  };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API + apiPath, opts);
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.message || 'HTTP ' + res.status };
    return data;
  } catch (e: any) {
    return { error: e.message || 'Network error' };
  }
});

// --- Capture session state ---
let lastApp = '';
let lastTitle = '';
let lastUrl = '';
let lastFocusKey = '';
let lastSelection = '';
let lastFingerprint = '';
let lastEmitAt = 0;

function emitToRenderer(payload: {
  eventType: string;
  timestamp: string;
  appName: string;
  windowTitle?: string;
  actionHint?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}) {
  if (!mainWindow) return;
  // Always ignore FlowMind recorder noise
  if (isFlowMindWindow(payload.appName, String(payload.windowTitle || ''))) {
    console.log('[capture] skip FlowMind window');
    return;
  }
  lastEmitAt = Date.now();
  mainWindow.webContents.send('active-window-changed', payload);
  console.log('[capture]', payload.eventType, payload.appName, payload.actionHint || '');
}

function emitTextContext(
  eventType: 'TEXT_INPUT' | 'PASTE_INPUT',
  snap: Partial<UiSnapshot> & { appName: string; windowTitle: string },
  text: string,
  fieldLabel?: string,
) {
  if (!intentCaptureEnabled || !captureArmed || !mainWindow) return;
  if (isFlowMindWindow(snap.appName, snap.windowTitle || '')) return;
  const cleaned = toIntentText(snap.focusedRole, fieldLabel || snap.focusedName, text, 1500);
  if (!cleaned) return;
  const hash = `${eventType}|${snap.appName}|${cleaned.slice(0, 200)}`;
  if (hash === lastEmittedIntentHash) return;
  lastEmittedIntentHash = hash;

  const preview = cleaned.length > 120 ? cleaned.slice(0, 117) + '…' : cleaned;
  const actionHint =
    eventType === 'PASTE_INPUT'
      ? `paste text${fieldLabel ? ` into "${fieldLabel}"` : ''}: "${preview}"`
      : `enter/submit text${fieldLabel ? ` in "${fieldLabel}"` : ''}: "${preview}"`;

  const metadata: Record<string, string> = {
    text: cleaned,
    textPreview: preview,
    actionHint,
    captureMode: 'intent-on-commit',
  };
  if (fieldLabel) metadata.focusedName = fieldLabel;
  if (snap.focusedRole) metadata.focusedRole = snap.focusedRole;
  if (snap.url) metadata.url = snap.url;
  if (snap.pageTitle) metadata.pageTitle = snap.pageTitle;

  emitToRenderer({
    eventType,
    timestamp: new Date().toISOString(),
    appName: snap.appName,
    windowTitle: snap.pageTitle || snap.windowTitle,
    url: snap.url,
    pageTitle: snap.pageTitle,
    focusedRole: snap.focusedRole,
    focusedName: fieldLabel || snap.focusedName,
    focusedElement: fieldLabel || snap.focusedName || snap.focusedRole,
    actionHint,
    metadata,
  });
}

function rememberPendingField(snap: UiSnapshot) {
  if (!intentCaptureEnabled || !snap.intentText) {
    return;
  }
  pendingField = {
    appName: snap.appName,
    windowTitle: snap.windowTitle,
    url: snap.url,
    pageTitle: snap.pageTitle,
    fieldName: snap.focusedName,
    fieldRole: snap.focusedRole,
    text: snap.intentText,
  };
}

function flushPendingFieldIfChanged(next?: UiSnapshot | null) {
  if (!pendingField || !intentCaptureEnabled) return;
  const sameFocus =
    next &&
    next.appName === pendingField.appName &&
    (next.focusedName || '') === (pendingField.fieldName || '') &&
    (next.intentText || '') === pendingField.text;
  if (sameFocus) return;
  // Focus left or text committed elsewhere — emit prior field content
  if (pendingField.text.length >= 2) {
    emitTextContext(
      'TEXT_INPUT',
      {
        appName: pendingField.appName,
        windowTitle: pendingField.windowTitle,
        url: pendingField.url,
        pageTitle: pendingField.pageTitle,
        focusedRole: pendingField.fieldRole,
        focusedName: pendingField.fieldName,
      },
      pendingField.text,
      pendingField.fieldName,
    );
  }
  pendingField = null;
}

let lastClickAt = 0;
let lastClickFp = '';

async function emitClickOrKey(kind: 'MOUSE_CLICK' | 'KEY_ACTION', keyAction?: string) {
  if (clickBusy) return;
  clickBusy = true;
  try {
    // On Enter: snapshot field text FIRST (before chat apps clear the composer)
    let preSubmitSnap: UiSnapshot | null = null;
    if (kind === 'KEY_ACTION' && keyAction === 'ENTER_SUBMIT' && intentCaptureEnabled) {
      preSubmitSnap = await captureUiSnapshot();
      if (
        preSubmitSnap &&
        !isFlowMindWindow(preSubmitSnap.appName, preSubmitSnap.windowTitle) &&
        (preSubmitSnap.intentText || pendingField?.text)
      ) {
        const text = preSubmitSnap.intentText || pendingField?.text || '';
        emitTextContext(
          'TEXT_INPUT',
          preSubmitSnap,
          text,
          preSubmitSnap.focusedName || pendingField?.fieldName,
        );
        pendingField = null;
      }
    }

    // Let focus settle on the clicked control
    await new Promise((r) => setTimeout(r, kind === 'MOUSE_CLICK' ? 150 : 80));
    const snap = await captureUiSnapshot();
    if (!snap) return;
    if (isFlowMindWindow(snap.appName, snap.windowTitle)) return;

    // Debounce identical generic clicks (same app+url, no control name)
    const fp = [
      kind,
      keyAction || '',
      snap.appName,
      snap.url || '',
      snap.focusedName || '',
      snap.focusedRole || '',
    ].join('|');
    const now = Date.now();
    if (kind === 'MOUSE_CLICK' && fp === lastClickFp && now - lastClickAt < 600) {
      return;
    }
    // Skip pure Tab noise in chat apps
    if (
      kind === 'KEY_ACTION' &&
      keyAction === 'TAB_NAVIGATION' &&
      isChatLikeApp(snap.appName) &&
      !snap.focusedName
    ) {
      return;
    }

    const alreadyOnPage = !!(snap.url && lastUrl && snap.url === lastUrl);
    snap.actionHint = buildActionHint({
      ...snap,
      focusedDescription: snap.focusedDescription,
      click: kind === 'MOUSE_CLICK',
      alreadyOnPage: kind === 'MOUSE_CLICK' ? alreadyOnPage || !!snap.url : alreadyOnPage,
      keyAction: kind === 'KEY_ACTION' ? keyAction : undefined,
    });
    if (!snap.actionHint) return;

    lastClickAt = now;
    lastClickFp = fp;
    lastFingerprint = snap.fingerprint + '|' + kind;
    lastApp = snap.appName;
    lastTitle = snap.windowTitle;
    lastUrl = snap.url || lastUrl;
    lastFocusKey = [snap.focusedRole, snap.focusedName].filter(Boolean).join('|');
    lastSelection = snap.selection || lastSelection;

    const extras: Record<string, string> = {};
    if (keyAction) extras.action = keyAction;

    emitToRenderer(snapToPayload(snap, kind, extras));
    rememberPendingField(snap);

    // If intent capture off or AX empty, still nudge for chat apps
    if (
      kind === 'KEY_ACTION' &&
      keyAction === 'ENTER_SUBMIT' &&
      isChatLikeApp(snap.appName) &&
      mainWindow
    ) {
      const hadText = !!(preSubmitSnap?.intentText || pendingField?.text);
      mainWindow.webContents.send('capture-tip', {
        message: hadText
          ? 'Captured message text for SOP (intent mode). Edit in SOP viewer if needed.'
          : 'Could not read chat text via Accessibility. Add a User Note describing the prompt.',
      });
    }
  } catch (e) {
    console.error('[capture] click/key emit failed', e);
  } finally {
    clickBusy = false;
  }
}

function emitPasteFromClipboard() {
  if (!intentCaptureEnabled || !captureArmed) return;
  try {
    const text = clipboard.readText('clipboard');
    if (!text || !text.trim()) return;
    // Fire-and-forget async snapshot for app context
    void (async () => {
      const snap = await captureUiSnapshot();
      if (!snap || isFlowMindWindow(snap.appName, snap.windowTitle)) return;
      emitTextContext('PASTE_INPUT', snap, text.trim(), snap.focusedName);
      rememberPendingField({ ...snap, intentText: toIntentText(snap.focusedRole, snap.focusedName, text) });
    })();
  } catch (e) {
    console.warn('[capture] paste read failed', e);
  }
}

function wireCaptureHooksOnce() {
  if (!uiohookMod || hooksWired) return;
  const { uIOhook, UiohookKey } = uiohookMod;

  uIOhook.on('click', (e: { button?: number }) => {
    if (!captureArmed) return;
    // button 1 = left in uiohook
    if (e.button != null && e.button !== 1) return;
    void emitClickOrKey('MOUSE_CLICK');
  });

  uIOhook.on('keydown', (e: { keycode: number; metaKey?: boolean; ctrlKey?: boolean }) => {
    if (!captureArmed) return;
    // Paste (Cmd+V / Ctrl+V) — context capture, not keylogging
    const vKey = UiohookKey.V;
    if (e.keycode === vKey && (e.metaKey || e.ctrlKey)) {
      emitPasteFromClipboard();
      return;
    }
    // Safe categories only — never capture character stream
    if (e.keycode === UiohookKey.Tab) void emitClickOrKey('KEY_ACTION', 'TAB_NAVIGATION');
    else if (e.keycode === UiohookKey.Enter || e.keycode === UiohookKey.NumpadEnter)
      void emitClickOrKey('KEY_ACTION', 'ENTER_SUBMIT');
    else if (e.keycode === UiohookKey.Escape) void emitClickOrKey('KEY_ACTION', 'ESC_CANCEL');
  });

  hooksWired = true;
}

function startCaptureHooks() {
  captureArmed = true;
  if (!uiohookMod) return;
  wireCaptureHooksOnce();
  if (hooksRunning) return;
  try {
    uiohookMod.uIOhook.start();
    hooksRunning = true;
    console.log('[capture] global hooks started (clicks + Tab/Enter/Esc)');
  } catch (e) {
    console.error('[capture] failed to start uiohook — grant Input Monitoring?', e);
    hooksRunning = false;
  }
}

function stopCaptureHooks() {
  captureArmed = false;
  if (!uiohookMod || !hooksRunning) return;
  try {
    uiohookMod.uIOhook.stop();
  } catch {
    /* ignore */
  }
  hooksRunning = false;
  console.log('[capture] global hooks stopped');
}

ipcMain.on('set-intent-capture', (_e, enabled: boolean) => {
  intentCaptureEnabled = !!enabled;
  console.log('[capture] intentCaptureEnabled =', intentCaptureEnabled);
});

ipcMain.on('start-recording', () => {
  if (recordingInterval) clearInterval(recordingInterval);

  lastApp = '';
  lastTitle = '';
  lastUrl = '';
  lastFocusKey = '';
  lastSelection = '';
  lastFingerprint = '';
  pendingField = null;
  lastEmittedIntentHash = '';

  startCaptureHooks();

  const emitIfChanged = async () => {
    try {
      // Avoid racing a click snapshot
      if (clickBusy) return;
      // Debounce against recent click emit
      if (Date.now() - lastEmitAt < 250) return;

      const snap = await captureUiSnapshot();
      if (!snap || !mainWindow) return;
      if (isFlowMindWindow(snap.appName, snap.windowTitle)) return;

      // Track field text for focus-leave commits
      if (intentCaptureEnabled && snap.intentText) {
        const focusId = `${snap.appName}|${snap.focusedName || ''}|${snap.focusedRole || ''}`;
        const prevId = pendingField
          ? `${pendingField.appName}|${pendingField.fieldName || ''}|${pendingField.fieldRole || ''}`
          : '';
        if (prevId && prevId !== focusId) {
          flushPendingFieldIfChanged(snap);
        }
        rememberPendingField(snap);
      }

      if (snap.fingerprint === lastFingerprint) return;

      const prevUrl = lastUrl;
      let eventType = '';
      const focusKey = [snap.focusedRole, snap.focusedName, snap.focusPath].filter(Boolean).join('|');

      if (!lastApp || snap.appName !== lastApp) eventType = 'APP_CHANGED';
      else if (snap.url && snap.url !== lastUrl) eventType = 'URL_CHANGED';
      else if ((snap.pageTitle || snap.windowTitle) !== lastTitle) eventType = 'WINDOW_CHANGED';
      else if (focusKey && focusKey !== lastFocusKey) eventType = 'FOCUS_CHANGED';
      else if (snap.selection && snap.selection !== lastSelection) eventType = 'UI_ACTION';
      else eventType = 'UI_ACTION';

      // Skip low-value "work in window" spam when nothing meaningful changed except fingerprint noise
      if (
        eventType === 'UI_ACTION' &&
        !snap.focusedName &&
        !snap.selection &&
        !snap.url &&
        snap.actionHint?.startsWith('work in ')
      ) {
        lastFingerprint = snap.fingerprint;
        return;
      }

      lastFingerprint = snap.fingerprint;
      lastApp = snap.appName;
      lastTitle = snap.pageTitle || snap.windowTitle || '';
      const extras: Record<string, string> = {};
      if (prevUrl && eventType === 'URL_CHANGED' && snap.url && prevUrl !== snap.url) {
        extras.previousUrl = prevUrl;
      }
      lastUrl = snap.url || lastUrl;
      lastFocusKey = focusKey;
      lastSelection = snap.selection || lastSelection;

      emitToRenderer(snapToPayload(snap, eventType, extras));
    } catch (err) {
      console.error('capture poll error:', err);
    }
  };

  void emitIfChanged();
  recordingInterval = setInterval(() => {
    void emitIfChanged();
  }, 700);
});

ipcMain.on('stop-recording', () => {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }
  stopCaptureHooks();
});
