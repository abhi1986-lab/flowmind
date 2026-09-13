import {
  DECLARED_TEXT_METADATA_KEYS,
  EventMetadataSanitizerError,
  isTextBearingEventType,
  sanitizeEventBatch,
  sanitizeEventForIngestion,
  stripDeclaredTextMetadata,
  TEXT_BEARING_EVENT_TYPES,
} from './event-metadata.sanitizer';
import {
  isDeclaredTextMetadataKey,
  isKeyloggingMetadataKey,
} from '@flowmind/shared-types';

describe('event-metadata.sanitizer (Gate 0.3)', () => {
  describe('isTextBearingEventType', () => {
    it.each([...TEXT_BEARING_EVENT_TYPES])('allows %s', (t) => {
      expect(isTextBearingEventType(t)).toBe(true);
    });

    it.each(['APP_CHANGED', 'WINDOW_CHANGED', 'MOUSE_CLICK', 'KEY_ACTION', 'UI_ACTION', 'URL_CHANGED'])(
      'rejects text on %s',
      (t) => {
        expect(isTextBearingEventType(t)).toBe(false);
      },
    );
  });

  describe('sanitizeEventForIngestion — reject side channel', () => {
    it.each([...DECLARED_TEXT_METADATA_KEYS])(
      'rejects metadata.%s on APP_CHANGED',
      (key) => {
        expect(() =>
          sanitizeEventForIngestion({
            eventType: 'APP_CHANGED',
            metadata: { [key]: 'smuggled field text', url: 'https://ok.example' },
          }),
        ).toThrow(EventMetadataSanitizerError);
        expect(() =>
          sanitizeEventForIngestion({
            eventType: 'APP_CHANGED',
            metadata: { [key]: 'smuggled' },
          }),
        ).toThrow(/only allowed on TEXT_INPUT, PASTE_INPUT, or USER_NOTE/);
      },
    );

    it('rejects metadata.value on WINDOW_CHANGED / MOUSE_CLICK / KEY_ACTION', () => {
      for (const eventType of ['WINDOW_CHANGED', 'MOUSE_CLICK', 'KEY_ACTION', 'UI_ACTION']) {
        expect(() =>
          sanitizeEventForIngestion({
            eventType,
            metadata: { value: 'password123' },
          }),
        ).toThrow(/metadata\.value/);
      }
    });

    it('rejects metadata.focusedValue on non-text events (Gate 0.3 follow-up)', () => {
      for (const eventType of ['APP_CHANGED', 'WINDOW_CHANGED', 'MOUSE_CLICK', 'UI_ACTION']) {
        expect(() =>
          sanitizeEventForIngestion({
            eventType,
            metadata: { focusedValue: 'smuggled field contents' },
          }),
        ).toThrow(/metadata\.focusedValue/);
      }
    });

    it('rejects top-level typedText / rawKeystrokes', () => {
      expect(() =>
        sanitizeEventForIngestion({ eventType: 'KEY_ACTION', typedText: 'abc' }),
      ).toThrow(/keylogging/);
      expect(() =>
        sanitizeEventForIngestion({ eventType: 'KEY_ACTION', rawKeystrokes: ['a'] }),
      ).toThrow(/keylogging/);
    });

    it('rejects keylogging metadata keys even on TEXT_INPUT', () => {
      expect(() =>
        sanitizeEventForIngestion({
          eventType: 'TEXT_INPUT',
          metadata: { text: 'ok', typedText: 'stream' },
        }),
      ).toThrow(/keylogging/);
      expect(() =>
        sanitizeEventForIngestion({
          eventType: 'USER_NOTE',
          metadata: { note: 'ok', keystrokes: 'a,b' },
        }),
      ).toThrow(/keylogging/);
    });
  });

  describe('sanitizeEventForIngestion — allow declared text', () => {
    it('allows metadata.text / textPreview on TEXT_INPUT', () => {
      const out = sanitizeEventForIngestion({
        eventType: 'TEXT_INPUT',
        metadata: { text: 'Rewrite hero', textPreview: 'Rewrite…', actionHint: 'enter text' },
      });
      expect(out.metadata).toMatchObject({
        text: 'Rewrite hero',
        textPreview: 'Rewrite…',
      });
    });

    it('allows metadata.value on PASTE_INPUT', () => {
      const out = sanitizeEventForIngestion({
        eventType: 'PASTE_INPUT',
        metadata: { value: 'pasted clipboard', text: 'pasted clipboard' },
      });
      expect((out.metadata as Record<string, unknown>).value).toBe('pasted clipboard');
    });

    it('allows metadata.note on USER_NOTE', () => {
      const out = sanitizeEventForIngestion({
        eventType: 'USER_NOTE',
        metadata: { note: 'operator intent', actionHint: 'operator intent' },
      });
      expect((out.metadata as Record<string, unknown>).note).toBe('operator intent');
    });

    it('allows non-text metadata on APP_CHANGED', () => {
      const out = sanitizeEventForIngestion({
        eventType: 'APP_CHANGED',
        appName: 'Chrome',
        metadata: {
          url: 'https://example.com',
          actionHint: 'open gallery',
          focusedRole: 'AXButton',
          focusedName: 'Submit',
        },
      });
      expect(out.metadata).toEqual({
        url: 'https://example.com',
        actionHint: 'open gallery',
        focusedRole: 'AXButton',
        focusedName: 'Submit',
      });
    });

    it('passes through events without metadata', () => {
      const out = sanitizeEventForIngestion({
        eventType: 'APP_CHANGED',
        appName: 'Finder',
      });
      expect(out.metadata).toBeUndefined();
    });
  });

  describe('sanitizeEventBatch', () => {
    it('sanitizes all events and fails fast on first offender', () => {
      const ok = sanitizeEventBatch([
        { eventType: 'APP_CHANGED', metadata: { url: 'https://a' } },
        { eventType: 'TEXT_INPUT', metadata: { text: 'hello' } },
      ]);
      expect(ok).toHaveLength(2);

      expect(() =>
        sanitizeEventBatch([
          { eventType: 'APP_CHANGED', metadata: { url: 'https://a' } },
          { eventType: 'APP_CHANGED', metadata: { value: 'leak' } },
        ]),
      ).toThrow(/metadata\.value/);
    });
  });

  describe('shared policy helpers', () => {
    it('classifies focusedValue as declared text and typedText as keylogging', () => {
      expect(isDeclaredTextMetadataKey('focusedValue')).toBe(true);
      expect(isDeclaredTextMetadataKey('url')).toBe(false);
      expect(isKeyloggingMetadataKey('typedText')).toBe(true);
      expect(isKeyloggingMetadataKey('value')).toBe(false);
    });
  });

  describe('stripDeclaredTextMetadata (desktop helper)', () => {
    it('strips value cousins + focusedValue on APP_CHANGED but keeps structural keys', () => {
      const cleaned = stripDeclaredTextMetadata('APP_CHANGED', {
        value: 'secret',
        text: 'secret',
        note: 'nope',
        focusedValue: 'field leak',
        url: 'https://ok',
        actionHint: 'click Submit',
      });
      expect(cleaned).toEqual({
        url: 'https://ok',
        actionHint: 'click Submit',
      });
    });

    it('preserves text metadata on TEXT_INPUT / USER_NOTE', () => {
      expect(
        stripDeclaredTextMetadata('TEXT_INPUT', { text: 'keep', url: 'https://x' }),
      ).toEqual({ text: 'keep', url: 'https://x' });
      expect(stripDeclaredTextMetadata('USER_NOTE', { note: 'keep' }).toEqual({
        note: 'keep',
      });
    });

    it('returns undefined when nothing remains', () => {
      expect(stripDeclaredTextMetadata('MOUSE_CLICK', { value: 'x' })).toBeUndefined();
      expect(stripDeclaredTextMetadata('APP_CHANGED', undefined)).toBeUndefined();
    });

    it('strips keylogging keys even on TEXT_INPUT (fail-closed client helper)', () => {
      expect(
        stripDeclaredTextMetadata('TEXT_INPUT', {
          text: 'keep',
          typedText: 'stream',
          keystrokes: 'a,b',
        }),
      ).toEqual({ text: 'keep' });
    });
  });
});
