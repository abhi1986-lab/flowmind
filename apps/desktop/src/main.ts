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

type ActiveWinFn = () => Promise<{ owner?: { name?: string }; title?: string; app?: string } | undefined>;
let activeWin: ActiveWinFn | null = null;
try {
  // Optional native module — must not block Electron window launch on demo boxes.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  activeWin = require('active-win') as ActiveWinFn;
} catch (e) {
  console.warn('[capture] active-win unavailable — app/window polling limited:', (e as Error).message);
  activeWin = null;
}

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
