import { Injectable } from '@nestjs/common';
import { Event } from '@prisma/client';

export interface WorkflowStep {
  stepNo: number;
  title: string;
  description: string;
  /** Imperative action line for SOP procedure (preferred over title/description paste). */
  action?: string;
  eventRefs?: string[];
}

type Meta = Record<string, unknown>;

function metaOf(ev: Event): Meta {
  const m = ev.metadata;
  if (m && typeof m === 'object' && !Array.isArray(m)) return m as Meta;
  return {};
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(missing value|null|undefined|none)$/i.test(s)) return undefined;
  return s;
}

function pickMeta(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return undefined;
}

/** Normalize URL for SPA dedupe (keep hash — #gallery vs #booking are different places). */
function normalizeUrl(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    // Drop tracking junk; keep path + hash (important for SPAs)
    return `${u.origin}${u.pathname}${u.hash}`.replace(/\/$/, '') || u.origin;
  } catch {
    return url.split('?')[0];
  }
}

function shortPlace(url?: string, pageTitle?: string, win?: string): string {
  if (url) {
    try {
      const u = new URL(url);
      const path = `${u.pathname}${u.hash}`.replace(/\/$/, '') || '/';
      if (pageTitle && pageTitle.length < 60) return `"${pageTitle}" (${path})`;
      return path === '/' ? u.host : `${u.host}${path}`;
    } catch {
      return url;
    }
  }
  if (pageTitle) return `"${pageTitle}"`;
  if (win) return `"${win}"`;
  return 'the app';
}

function isChatLike(app: string): boolean {
  return /chatgpt|claude|gemini|slack|discord|messages|whatsapp|teams/i.test(app);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build a concise imperative action. Avoid repeating "Open page X" on every click.
 */
export function describeAction(ev: Event, opts?: { alreadyOnUrl?: string }): string {
  const meta = metaOf(ev);
  const app = str(ev.appName) || 'the application';
  const win = str(ev.windowTitle);
  const url = pickMeta(meta.url);
  const prevUrl = pickMeta(meta.previousUrl);
  const pageTitle = pickMeta(meta.pageTitle);
  const focused =
    pickMeta(meta.focusedName, meta.focusedElement, meta.focusedDescription) ||
    pickMeta(meta.focusedRole);
  const role = pickMeta(meta.focusedRole);
  const selection = pickMeta(meta.selection);
  const note = pickMeta(meta.note);
  const actionHint = pickMeta(meta.actionHint);
  const keyAction = pickMeta(meta.action);
  const sameUrl =
    opts?.alreadyOnUrl && url && normalizeUrl(opts.alreadyOnUrl) === normalizeUrl(url);

  if (ev.eventType === 'USER_NOTE' && note) {
    return `Operator note: ${note}`;
  }

  // Prefer explicit actionHint unless it's low-value / redundant open spam
  if (actionHint) {
    const lowValue =
      /^work in (window|application)/i.test(actionHint) ||
      (sameUrl && /^open page /i.test(actionHint) && /click on the page/i.test(actionHint));

    if (!lowValue) {
      // Strip duplicated "Open page ...; Open page ..."
      let hint = actionHint.replace(/(Open page "[^"]+" \([^)]+\))(?:;\s*\1)+/gi, '$1');
      hint = hint.replace(/;\s*open page "[^"]+" \([^)]+\)/gi, (m) => {
        // keep first open only when already opening
        return '';
      });
      if (/^open |^switch |^navigate |^in |^click |^press |^select |^focus |^send |^use |^toggle |^operator /i.test(hint) || hint.includes(app)) {
        return capitalize(hint.trim());
      }
      return capitalize(`In ${app}, ${hint}`.trim());
    }
  }

  switch (ev.eventType) {
    case 'APP_CHANGED': {
      if (isChatLike(app)) return `Open ${app}`;
      let line = `Switch to ${app}`;
      if (url) line += ` and go to ${shortPlace(url, pageTitle, win)}`;
      else if (pageTitle || win) line += ` (${pageTitle || win})`;
      if (focused) line += `; focus "${focused}"`;
      return line;
    }
    case 'WINDOW_CHANGED':
    case 'URL_CHANGED': {
      if (sameUrl) return ''; // no-op for builder
      let line = `In ${app}, open ${shortPlace(url, pageTitle, win)}`;
      if (prevUrl && normalizeUrl(prevUrl) !== normalizeUrl(url || '')) {
        line += ` (from ${shortPlace(prevUrl)})`;
      }
      return line;
    }
    case 'FOCUS_CHANGED': {
      if (!focused && !selection) return '';
      let line = `In ${app}`;
      if (url || pageTitle) line += ` on ${shortPlace(url, pageTitle, win)}`;
      if (focused) {
        if (role && /button/i.test(role)) line += `, focus button "${focused}"`;
        else if (role && /text|field|area|search|edit/i.test(role))
          line += `, focus field "${focused}"`;
        else line += `, focus "${focused}"`;
      }
      if (selection) line += `, select "${selection}"`;
      return line;
    }
    case 'UI_ACTION': {
      if (selection) return `In ${app}, select "${selection}"`;
      if (focused) return `In ${app}, interact with "${focused}"`;
      return '';
    }
    case 'MOUSE_CLICK': {
      if (focused) {
        if (role && /button/i.test(role)) return `In ${app}, click button "${focused}"`;
        if (role && /link/i.test(role)) return `In ${app}, click link "${focused}"`;
        return `In ${app}, click "${focused}"`;
      }
      // Generic click while already on a page — keep short
      if (url || pageTitle) return `In ${app}, click on ${shortPlace(url, pageTitle, win)}`;
      if (win) return `In ${app}, click inside "${win}"`;
      return `In ${app}, click`;
    }
    case 'KEY_ACTION': {
      if (keyAction === 'ENTER_SUBMIT') {
        if (isChatLike(app)) {
          return `In ${app}, send/submit a message (typed text is not recorded — add a User Note describing the prompt)`;
        }
        return `In ${app}, press Enter to submit${focused ? ` on "${focused}"` : ''}${
          url ? ` on ${shortPlace(url, pageTitle)}` : ''
        }`;
      }
      if (keyAction === 'TAB_NAVIGATION') {
        // Usually noise for SOPs unless we have a field name
        if (!focused) return '';
        return `In ${app}, press Tab to move to "${focused}"`;
      }
      if (keyAction === 'ESC_CANCEL') return `In ${app}, press Escape to cancel/close`;
      return `In ${app}, press ${keyAction || 'a navigation key'}`;
    }
    case 'SCREEN_DELTA':
      return '';
    default: {
      if (actionHint && !/^work in /i.test(actionHint)) return capitalize(actionHint);
      return '';
    }
  }
}

function stepTitle(ev: Event, action: string): string {
  const app = str(ev.appName) || 'App';
  const meta = metaOf(ev);
  const url = pickMeta(meta.url);
  const pageTitle = pickMeta(meta.pageTitle);
  const focused = pickMeta(meta.focusedName, meta.focusedElement);
  const note = pickMeta(meta.note);

  if (ev.eventType === 'USER_NOTE' && note) {
    return `${app}: note`;
  }
  if (url) {
    try {
      const u = new URL(url);
      const loc = `${u.pathname}${u.hash}`.replace(/\/$/, '') || u.host;
      return `${app}: ${loc}`;
    } catch {
      return `${app}: ${url.slice(0, 40)}`;
    }
  }
  if (focused) return `${app}: ${focused}`;
  if (pageTitle && pageTitle.length < 50) return `${app}: ${pageTitle}`;
  return action.length > 70 ? `${app}: ${action.slice(0, 60)}…` : `${app}`;
}

function semanticKey(ev: Event, action: string): string {
  const meta = metaOf(ev);
  const app = str(ev.appName) || '';
  const url = normalizeUrl(pickMeta(meta.url));
  const focused = pickMeta(meta.focusedName, meta.focusedElement) || '';
  const note = pickMeta(meta.note) || '';
  const keyAction = pickMeta(meta.action) || '';
  // Group by meaning, not by every event type
  if (ev.eventType === 'USER_NOTE') return `note|${note}`;
  if (ev.eventType === 'KEY_ACTION' && keyAction === 'ENTER_SUBMIT')
    return `enter|${app}|${url}|${focused}`;
  if (ev.eventType === 'MOUSE_CLICK') return `click|${app}|${url}|${focused || 'page'}`;
  if (ev.eventType === 'URL_CHANGED' || ev.eventType === 'APP_CHANGED' || ev.eventType === 'WINDOW_CHANGED')
    return `nav|${app}|${url || pickMeta(meta.pageTitle) || str(ev.windowTitle)}`;
  return `other|${app}|${url}|${action}`;
}

@Injectable()
export class TimelineBuilder {
  /**
   * Convert client-DB events into a clean, non-repetitive workflow timeline.
   * Collapses click spam, skips empty/noise events, and keeps navigation once per URL.
   */
  buildTimeline(events: Event[]): WorkflowStep[] {
    if (!events || events.length === 0) return [];

    const sorted = [...events].sort((a, b) => {
      if (a.sequenceNo != null && b.sequenceNo != null) return a.sequenceNo - b.sequenceNo;
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    const steps: WorkflowStep[] = [];
    let currentStepNo = 1;
    let lastUrl = '';
    let lastApp = '';
    let lastSemantic = '';
    let lastClickBucket = '';
    let clicksInBucket = 0;

    for (const ev of sorted) {
      const meta = metaOf(ev);
      const app = str(ev.appName) || '';
      const url = pickMeta(meta.url);
      const keyAction = pickMeta(meta.action);

      // Drop pure Tab spam without focus target
      if (ev.eventType === 'KEY_ACTION' && keyAction === 'TAB_NAVIGATION') {
        const focused = pickMeta(meta.focusedName, meta.focusedElement);
        if (!focused) continue;
      }

      const action = describeAction(ev, { alreadyOnUrl: lastUrl });
      if (!action) {
        // Still track URL for context
        if (url) lastUrl = url;
        if (app) lastApp = app;
        continue;
      }

      const sem = semanticKey(ev, action);

      // Exact semantic duplicate → merge refs only
      if (sem === lastSemantic && steps.length > 0) {
        const last = steps[steps.length - 1];
        if (last.eventRefs) last.eventRefs.push(ev.id);
        else last.eventRefs = [ev.id];
        // Count repeated generic page clicks
        if (ev.eventType === 'MOUSE_CLICK' && !pickMeta(meta.focusedName, meta.focusedElement)) {
          clicksInBucket += 1;
          if (clicksInBucket > 1) {
            last.action = last.action?.replace(/ \(×\d+ clicks\)/, '') + ` (×${clicksInBucket} clicks)`;
            last.description = last.action;
          }
        }
        continue;
      }

      // New navigation to same URL while already there → skip
      if (
        (ev.eventType === 'URL_CHANGED' || ev.eventType === 'WINDOW_CHANGED') &&
        url &&
        normalizeUrl(url) === normalizeUrl(lastUrl)
      ) {
        continue;
      }

      // Generic page click right after opening same URL → append once, don't new step
      if (
        ev.eventType === 'MOUSE_CLICK' &&
        !pickMeta(meta.focusedName, meta.focusedElement) &&
        url &&
        normalizeUrl(url) === normalizeUrl(lastUrl) &&
        steps.length > 0
      ) {
        const last = steps[steps.length - 1];
        const clickBit = 'Interact with the page (click)';
        if (last.action && !/Interact with the page/i.test(last.action)) {
          last.action = `${last.action}. ${clickBit}`;
          last.description = last.action;
        }
        if (last.eventRefs) last.eventRefs.push(ev.id);
        else last.eventRefs = [ev.id];
        lastSemantic = sem;
        clicksInBucket = 1;
        lastClickBucket = normalizeUrl(url);
        continue;
      }

      // Enter after being in ChatGPT — always its own clear step
      steps.push({
        stepNo: currentStepNo++,
        title: stepTitle(ev, action),
        description: action,
        action,
        eventRefs: [ev.id],
      });

      lastSemantic = sem;
      if (url) lastUrl = url;
      if (app) lastApp = app;
      if (ev.eventType === 'MOUSE_CLICK') {
        clicksInBucket = 1;
        lastClickBucket = normalizeUrl(url || '') || lastClickBucket;
      } else {
        clicksInBucket = 0;
      }
    }

    // Renumber after any future filters
    return steps.map((s, i) => ({ ...s, stepNo: i + 1 }));
  }
}
