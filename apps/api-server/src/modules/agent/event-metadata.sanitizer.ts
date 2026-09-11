/**
 * Gate 0.3 — Metadata side channel guard for event ingestion.
 *
 * Declared free-text may ONLY appear on TEXT_INPUT / PASTE_INPUT / USER_NOTE.
 * Elsewhere, metadata.value (and cousins) are rejected so APP_CHANGED etc.
 * cannot be used as a keylogging / field-value smuggling path.
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

export class EventMetadataSanitizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventMetadataSanitizerError';
  }
}

export function isTextBearingEventType(eventType: string): boolean {
  return TEXT_BEARING.has(eventType);
}

function asMeta(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Validate + return a copy of the event safe for persistence.
 * Throws EventMetadataSanitizerError on keylogging or text side-channels.
 */
export function sanitizeEventForIngestion(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const type = String(event['eventType'] || '');

  if (event['typedText'] !== undefined || event['rawKeystrokes'] !== undefined) {
    throw new EventMetadataSanitizerError(
      'Forbidden: keylogging fields (typedText/keystrokes/raw) are not allowed.',
    );
  }

  const meta = asMeta(event['metadata']);
  if (!meta) {
    return { ...event };
  }

  for (const key of Object.keys(meta)) {
    if (KEYLOGGING.has(key) && meta[key] !== undefined) {
      throw new EventMetadataSanitizerError(
        'Forbidden: keylogging fields (typedText/keystrokes/raw) are not allowed.',
      );
    }
  }

  if (!isTextBearingEventType(type)) {
    for (const key of Object.keys(meta)) {
      if (DECLARED_TEXT.has(key) && meta[key] !== undefined) {
        throw new EventMetadataSanitizerError(
          `Forbidden: metadata.${key} is only allowed on TEXT_INPUT, PASTE_INPUT, or USER_NOTE events.`,
        );
      }
    }
  }

  return {
    ...event,
    metadata: { ...meta },
  };
}

/** Sanitize a full batch; fails fast on the first offending event. */
export function sanitizeEventBatch(
  events: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return events.map((e) => sanitizeEventForIngestion(e));
}

/**
 * Strip declared-text cousins from metadata (client-side helper).
 * Does not throw — used by desktop before upload. Server still rejects.
 */
export function stripDeclaredTextMetadata(
  eventType: string,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  if (isTextBearingEventType(eventType)) {
    return { ...metadata };
  }
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (DECLARED_TEXT.has(k) || KEYLOGGING.has(k)) continue;
    cleaned[k] = v;
  }
  return Object.keys(cleaned).length ? cleaned : undefined;
}
