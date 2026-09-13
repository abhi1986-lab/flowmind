import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consentStripClass,
  desktopMainEntry,
  idleConsentDisplay,
  recordingBannerClass,
} from './recording-ui';

describe('recording UI consent chrome', () => {
  it('shows RECORDING banner class only while recording', () => {
    assert.equal(recordingBannerClass(true), 'on');
    assert.equal(recordingBannerClass(false), '');
  });

  it('shows consent strip class only while recording', () => {
    assert.equal(consentStripClass(true), 'on');
    assert.equal(consentStripClass(false), '');
  });

  it('hides idle consent tip while recording', () => {
    assert.equal(idleConsentDisplay(true), 'none');
    assert.equal(idleConsentDisplay(false), 'block');
  });

  it('keeps Electron main entry at dist/main.js', () => {
    assert.equal(desktopMainEntry(), 'dist/main.js');
  });
});
