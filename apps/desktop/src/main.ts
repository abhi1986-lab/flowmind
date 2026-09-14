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
