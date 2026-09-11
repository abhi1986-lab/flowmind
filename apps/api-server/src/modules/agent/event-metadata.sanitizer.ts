/**
 * Gate 0.3 — Metadata side channel guard for event ingestion.
 *
 * Deny lists + strip helper live in `@flowmind/shared-types` (event-metadata-policy)
 * so desktop and server cannot drift. This module validates and rejects.
 */

import {
  DECLARED_TEXT_METADATA_KEYS,
  KEYLOGGING_METADATA_KEYS,
  TEXT_BEARING_EVENT_TYPES,
  isTextBearingEventType,
  stripDeclaredTextMetadata,
} from '@flowmind/shared-types';

export {
  DECLARED_TEXT_METADATA_KEYS,
  KEYLOGGING_METADATA_KEYS,
  TEXT_BEARING_EVENT_TYPES,
  isTextBearingEventType,
  stripDeclaredTextMetadata,
};

export type TextBearingEventType = (typeof TEXT_BEARING_EVENT_TYPES)[number];

const DECLARED_TEXT = new Set<string>(DECLARED_TEXT_METADATA_KEYS);
const KEYLOGGING = new Set<string>(KEYLOGGING_METADATA_KEYS);

export class EventMetadataSanitizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventMetadataSanitizerError';
  }
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
