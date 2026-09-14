/** Pure helpers for visible RECORDING / consent chrome (kept out of Electron for unit tests). */

export function recordingBannerClass(isRecording: boolean): string {
  return isRecording ? 'on' : '';
}

export function consentStripClass(isRecording: boolean): string {
  return isRecording ? 'on' : '';
}

export function idleConsentDisplay(isRecording: boolean): 'none' | 'block' {
  return isRecording ? 'none' : 'block';
}

/** Package entry the Electron binary must resolve after `npm run build`. */
export function desktopMainEntry(): string {
  return 'dist/main.js';
}
