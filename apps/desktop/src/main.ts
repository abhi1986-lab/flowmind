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
