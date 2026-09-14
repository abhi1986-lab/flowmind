/** Pure capture privacy helpers — unit-tested; keep in sync with desktop main capture path. */

const MISSING = /^(missing value|null|undefined|none|)$/i;
const SECURE_ROLES = /secure|password|AXSecureTextField|passwd/i;

export function clean(s: unknown, max = 200): string | undefined {
  if (s == null) return undefined;
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (!t || MISSING.test(t)) return undefined;
  if (t.startsWith('«class')) return undefined;
  if (t.length > max) t = t.slice(0, max) + '…';
  return t;
}

export function isSensitiveRole(role?: string, name?: string): boolean {
  const blob = `${role || ''} ${name || ''}`;
  return SECURE_ROLES.test(blob) || /password|passcode|otp|secret|api.?key|token/i.test(blob);
}

export function sanitizeFieldValue(
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

export function looksLikeSecret(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/^(sk-|xai-|ghp_|gho_|AKIA|ASIA|xox[baprs]-)/i.test(t)) return true;
  if (/password\s*[:=]/i.test(t) && t.length < 80) return true;
  if (/^-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(t)) return true;
  if (/bearer\s+[a-z0-9._\-]+/i.test(t)) return true;
  return false;
}

/** Intent-safe text: final field/clipboard content, never secure fields or secrets. */
export function toIntentText(
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
  if (t.length < 2) return undefined;
  if (t.length > max) return t.slice(0, max) + '…';
  return t;
}

export function isFlowMindWindow(appName: string, windowTitle: string): boolean {
  const a = (appName || '').toLowerCase();
  const t = (windowTitle || '').toLowerCase();
  if (t.includes('flowmind')) return true;
  if ((a === 'electron' || a.includes('flowmind')) && (t.includes('flowmind') || t.includes('recorder') || !t)) {
    if (t.includes('flowmind') || t.includes('activity capture') || t.includes('recorder')) return true;
  }
  return false;
}
