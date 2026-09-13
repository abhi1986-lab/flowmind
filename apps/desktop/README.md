# FlowMind AI - Desktop Workflow Agent (Electron + TypeScript)

**Lightweight observer only.** Visible, user-started capture → events → timeline → SOP DRAFT.

## Launch (demo box)

```bash
cd apps/desktop
npm install
npm start          # builds dist/main.js then launches Electron
# or
npm run build && npx electron .
```

From repo root:

```bash
./scripts/dev-up.sh --desktop
```

`dist/` is gitignored. **Always build before launching** — `npm start` does this via `prestart`. A missing `dist/main.js` is the usual "broken binary / can't find Electron app" failure.

Native capture modules (`active-win`, `uiohook-napi`) are **optional**. If they fail to compile on the demo box, the recorder window still launches; app/window or click capture may be limited, but consent/RECORDING chrome remains visible.

## Consent / RECORDING

- Capture stays OFF until **Start Session**.
- While recording: red **RECORDING** banner + consent strip (always-on-top window).
- No hidden/background recording.

## Strict prohibitions

- No full keylogging / passwords / form values
- No webcam/mic in MVP
- No hidden/background recording
- No local heavy AI/OCR/automation

See `docs-pack/06_Desktop_Agent_LLD.docx` and root constraints.
