import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clean,
  isFlowMindWindow,
  isSensitiveRole,
  looksLikeSecret,
  sanitizeFieldValue,
  toIntentText,
} from './capture-privacy';

describe('capture privacy', () => {
  it('redacts secure field roles', () => {
    assert.equal(isSensitiveRole('AXSecureTextField', 'Password'), true);
    assert.equal(sanitizeFieldValue('secure text field', 'Password', 'hunter2'), '[redacted-secure-field]');
  });

  it('detects secret-looking intent text', () => {
    assert.equal(looksLikeSecret('sk-abc123456'), true);
    assert.equal(looksLikeSecret('ghp_abcdefghijklmnopqrstuvwxyz'), true);
    assert.equal(looksLikeSecret('bearer eyJhbGciOi'), true);
    assert.equal(looksLikeSecret('normal note about invoices'), false);
  });

  it('drops secrets and secure roles from intent text', () => {
    assert.equal(toIntentText('password', 'pwd', 'secret'), undefined);
    assert.equal(toIntentText('text', 'note', 'sk-live-key-12345'), undefined);
    assert.equal(toIntentText('text', 'note', 'Create invoice for ACME'), 'Create invoice for ACME');
  });

  it('ignores FlowMind recorder windows', () => {
    assert.equal(isFlowMindWindow('Electron', 'FlowMind Recorder'), true);
    assert.equal(isFlowMindWindow('Google Chrome', 'Inbox'), false);
  });


  it('truncates long fields and numeric ids', () => {
    const long = 'x'.repeat(90);
    assert.equal(sanitizeFieldValue('text', 'note', long), '[text length 90]');
    assert.equal(sanitizeFieldValue('text', 'id', '12345678'), '[numeric-id]');
  });

  it('truncates very long intent text', () => {
    const long = 'ab' + 'c'.repeat(1600);
    const out = toIntentText('text', 'note', long, 20);
    assert.ok(out && out.endsWith('…'));
    assert.ok(out && out.length <= 21);
  });

  it('cleans empty and noisy accessibility strings', () => {
    assert.equal(clean('missing value'), undefined);
    assert.equal(clean('  Hello   world  '), 'Hello world');
  });
});
