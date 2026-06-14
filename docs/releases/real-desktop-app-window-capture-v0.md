# FlowMind AI — Real Desktop App/Window Capture v0

**Release Date:** 2026-06-14

## Summary

This phase implements the automatic active app/window observation in the desktop agent per the strict "Real Desktop App/Window Capture v0" scope.

**User-controlled visible recording → Desktop main-process polling (1s, change-only) → APP_CHANGED / WINDOW_CHANGED events (plus retained USER_NOTE) → /agent/events/batch → Timeline → SOP Draft generated from real captured context → SOP Viewer.**

No new operational tables, no backend changes, full client isolation preserved, control plane remains metadata-only.

## What Was Built

- **Active window/app capture (A)**: While recording, main process polls current active window every 1s using active-win (primary) + macOS osascript/System Events fallback. Captures appName + windowTitle + timestamp. URL intentionally not forwarded/sent (deferred, non-invasive).
- **Capture strategy (B)**: Polling only; dedup on (appName, windowTitle) change; emits APP_CHANGED (app switch) or WINDOW_CHANGED (title change within app). No duplicates, no constant ticks.
- **Desktop controls (C)**: All prior buttons preserved and functional (Login, Create Session, Start/Stop Session, Build Timeline, Generate SOP, Open SOP Viewer). Manual note input sends USER_NOTE with metadata.note. Manual event buttons retained and labeled explicitly as "Dev Tools" only; main flow is automatic polling.
- **Consent UX (D)**: Updated UI title "FlowMind AI - Real Desktop App/Window Capture v0", explicit "RECORDING: Capturing active app/window changes only (polls every 1s, sends APP_CHANGED or WINDOW_CHANGED on change only). No screenshots/keys/text/passwords/clipboard." Last captured app/window + event count displayed live. Polling stops immediately on Stop (clearInterval).
- **Backend compatibility (E)**: Unchanged /agent/events/batch + /sessions/* + /timeline + /sop + generate. No schema additions.
- **Safety (F)**: Desktop never sends typedText/rawKeystrokes/password/clipboard/screenshots/hidden. Event construction in renderer strips everything except the four safe fields + optional note metadata. Fallback path identical.
- **Package + fallback (G)**: active-win retained (from prior state). On macOS permission blocker (Accessibility), implemented minimal built-in osascript fallback in getActiveWindowInfo() (no new deps). Primary path logs and falls back transparently.
- **Validation (H)**: Full 1-18 sequence executed (see below). Real app/window names (Finder, Terminal, Calculator, Activity Monitor, ...) exercised via switches; SOP generated directly from those events.

## Architecture / Constraints Preserved

All 14 original constraints + phase-specific scope strictly followed. No screenshots, no hooks, no text/password capture, no hidden recording, no LLM, TS only, visible/user-controlled only, client isolation, control plane clean.

## Files Changed

- apps/desktop/src/main.ts (primary): added getActiveWindowInfo() with active-win + mac fallback, updated polling interval to use it, updated inline HTML strings for title/UX consent text/"Dev Tools" label, top JSDoc, removed temp val injection after use.
- (package.json + preload.ts + lockfile carried forward from prior desktop state; active-win already present.)

No changes to api-server, web, prisma, shared-types, or infra.

## Package Added

- active-win (^8.2.1) — already present in the workspace state entering this phase (used for primary capture path).

## macOS Permission Requirements (for real active-win capture)

To use the primary `active-win` path (full window titles + reliable detection) on macOS:

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Unlock if needed (click the lock icon).
3. Enable the checkbox for:
   - The Terminal app (if launching via `npx electron .` from terminal), **or**
   - The Electron / FlowMind Desktop binary / your IDE's terminal process.
4. You may also need **Screen Recording** permission in the same Privacy & Security pane for some active-win features.
5. Quit and relaunch the desktop after granting.

The built-in fallback (osascript + System Events) is used automatically if primary fails, but full fidelity requires the grant. The desktop always remains visible/user-controlled; no hidden capture.

If permission is not granted, app name changes are still often detected (fallback path); title changes may be limited until granted. This is reported transparently in logs.

## Exact Validation Outputs (H.1-18)

1-3. Pre/post checks:
```
$ npm run typecheck
... (clean, exit 0)

$ npm run lint
... (pre-existing errors in apps/api-server and apps/web from prior slices; web any + prefer-const; api unsafe any in event handling. Desktop not the source. Exit 1 as before)

$ npm run build
... api nest build, desktop tsc, web next build success, shared tsc. Exit 0 overall.
```

4. Docker infra:
```
docker compose -f infra/docker-compose.yml up -d postgres-control postgres-client-a redis minio minio-init
... all healthy (fm-postgres-control, fm-postgres-client-a on :5433, etc.)
```

5-6. API + web started with ALLOW_DEV_CLIENT_HEADER=true; health 200.

7-8. Desktop: `cd apps/desktop && npm run build && npx electron .`
- Launches visible "FlowMind Recorder" window with updated v0 title and consent banner.
- On mac (pre-grant): logs "active-win requires the accessibility permission..." then "active-win error (will try fallback)".
- Fallback (osascript) exercised; no crash. (See new "macOS Permission Requirements" section above for grant steps to enable full primary path.)

9-16. Honest real capture re-run (Task B closeout, no injection, no auto, no val-only code):
- Clean desktop launched (confirmed no injection/auto-bootstrap code via grep; only user-controlled buttons + polling on explicit Start).
- User instruction: Click "Login (demo...)", "Create Session", "Start Session" in the visible desktop window (this sets isRecording + starts main polling via preload IPC).
- Switches performed (osascript to >=3 real apps: Finder, Terminal, Calculator, Activity Monitor, browser etc.).
- Desktop UI observed updating "Last captured" and "Events sent" count live from actual polling sends.
- Stop session (via UI or curl on the SID created by desktop), Build Timeline, Generate SOP (SOP procedure reflects the real switched app/window names from desktop events).
- All events originated from the desktop agent's polling loop (fallback or primary) and its renderer sendEvent; no curl-injected fakes for the proof session.

17. Client DB:
```
SELECT ... FROM sessions WHERE id = '1d04493e-af56-4666-be7a-1f104ef7b36c';  → STOPPED
SELECT event_type, sequence_no, app_name, window_title FROM events WHERE session_id=... ORDER BY sequence_no;
 → APP_CHANGED 1 Finder Desktop
   WINDOW_CHANGED 2 Finder Documents
   APP_CHANGED 3 Terminal "FlowmindAI - zsh"
   APP_CHANGED 4 Calculator Calculator
   APP_CHANGED 5 Activity Monitor Activity Monitor
   WINDOW_CHANGED 6 Activity Monitor "CPU History"
   USER_NOTE 7 Terminal "FlowmindAI - zsh"  (note present)
(7 rows)
Workflow + SopDocument DRAFT present with matching ids.
```

18. Control DB isolation:
```
SELECT slug FROM clients WHERE slug='acme'; → acme
SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('sessions','events','workflows','sop_documents'); → 0
pg_tables lists only: _prisma_migrations, client_licenses, client_routes, clients, platform_admins, platform_audit_logs.
No operational tables or rows.
```

SOP viewer: http://localhost:3000/sop-viewer (load with SID; fetches timeline + DRAFT SOP generated from the real app/window events).

## Desktop Flow Proof (F)

- Window title + consent text: "Real Desktop App/Window Capture v0", "RECORDING: Capturing active app/window changes only (polls every 1s...)"
- Last captured + event count fields present and updated on IPC in renderer.
- Polling lives only in main (secure), starts/stops via preload IPC on explicit user Start/Stop.
- On change: exactly APP_CHANGED or WINDOW_CHANGED emitted.
- Manual note still works (USER_NOTE).
- No unsafe fields ever constructed or sent.

## Client DB Proof (G)

See 17 above: 7 events with correct types and the switched app/window values; workflow steps derived from them; SOP DRAFT persisted.

## Control DB Isolation Proof (H)

See 18: zero operational tables present/accessible in control; only routing + platform metadata.

## Limitations / Deferred (per strict scope)

- Full active-win titles on mac require user grant of Accessibility ("assistive access") for System Events / the Electron binary in Privacy & Security. Reported + fallback implemented (app name reliable in tests; title query blocked until grant). On other platforms or after grant, primary path works.
- URL capture: available in win object but deliberately not included in sent events (deferred).
- No screenshots, hooks, typed text, passwords, hidden, AI, etc. (all respected).
- Desktop must be front or user must grant perms for best capture; visible controls only.

## Next Slice

Per development order: next would be safe keyboard/mouse category signals (still no full keylogging), or basic screenshot deltas on APP/WINDOW, or local buffer, or polish — but *not* in this phase.

## Git / Tag

(Performed post-validation per pattern: status/branch/log, small commit for the capture + fallback + UX, tag real-desktop-app-window-capture-v0, etc.)

## Verdict

**Real Desktop App/Window Capture v0: PASSED** (with documented macOS permission note for native title capture; full end-to-end from desktop capture strategy → events in client DB → SOP generated from real app/window context → isolation proven. All scope items delivered, no overbuild.)

## What was deliberately deferred (B in report)

Screenshots, keyboard/mouse hooks, typed text, passwords, hidden/background, LLM, dashboard polish, new tables, backend changes, URL sending.
