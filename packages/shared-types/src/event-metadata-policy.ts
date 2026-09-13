/**
 * Gate 0.3 — Shared declared-text / keylogging metadata policy.
 *
 * Single source of truth for deny lists + strip helper used by:
 * - api-server ingestion sanitizer (reject / fail-closed)
 * - desktop agent (strip before upload; server still rejects)
 *
 * Declared free-text may ONLY appear on TEXT_INPUT / PASTE_INPUT / USER_NOTE.
 */

export const TEXT_BEARING_EVENT_TYPES = [
  'TEXT_INPUT',
  'PASTE_INPUT',
  'USER_NOTE',
] as const;

export type TextBearingEventType = (typeof TEXT_BEARING_EVENT_TYPES)[number];

/** Field-value / declared-text cousins that must not leak via non-text events. */
export const DECLARED_TEXT_METADATA_KEYS = [
  'value',
  'text',
  'textPreview',
  'note',
  'content',
  'clipboard',
  'clipboardText',
  'paste',
  'fieldValue',
  'inputValue',
  'typedValue',
  /** Desktop AX snapshot field; must not ride as metadata on APP_CHANGED etc. */
  'focusedValue',
] as const;

/** Always forbidden — raw keystream / keylogging shapes. */
export const KEYLOGGING_METADATA_KEYS = [
  'typedText',
  'keystrokes',
  'raw',
  'keyStream',
  'rawKeystrokes',
] as const;

const TEXT_BEARING = new Set<string>(TEXT_BEARING_EVENT_TYPES);
const DECLARED_TEXT = new Set<string>(DECLARED_TEXT_METADATA_KEYS);
const KEYLOGGING = new Set<string>(KEYLOGGING_METADATA_KEYS);

/** All metadata keys stripped/denied on non-text events (declared text + keylogging). */
export const STRIP_ON_NON_TEXT_METADATA_KEYS = [
  ...DECLARED_TEXT_METADATA_KEYS,
  ...KEYLOGGING_METADATA_KEYS,
] as const;

export function isTextBearingEventType(eventType: string): boolean {
  return TEXT_BEARING.has(eventType);
}

export function isDeclaredTextMetadataKey(key: string): boolean {
  return DECLARED_TEXT.has(key);
}

export function isKeyloggingMetadataKey(key: string): boolean {
  return KEYLOGGING.has(key);
}

/**
 * Strip declared-text cousins + keylogging keys from metadata (client-side helper).
 * Does not throw — used by desktop before upload. Server still rejects.
 */
export function stripDeclaredTextMetadata(
  eventType: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (isTextBearingEventType(eventType)) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (KEYLOGGING.has(k)) continue;
      cleaned[k] = v;
    }
    return Object.keys(cleaned).length ? cleaned : undefined;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (DECLARED_TEXT.has(k) || KEYLOGGING.has(k)) continue;
    cleaned[k] = v;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
}
