# FlowMind — Install and run (capture → SOP DRAFT)

This guide gets you from a clean machine to: **desktop agent capturing a real workflow → events ingested → timeline → SOP DRAFT ready for review**.

## Prerequisites

- Node.js **20+** and npm
- Docker (for local API + Postgres + MinIO)
- macOS or Linux desktop session (Electron UI)

## 1. Clone and install

```bash
git clone https://github.com/abhi1986-lab/flowmind.git
cd flowmind
npm install
```

If `active-win` / `uiohook-napi` fail to compile, that is OK for window launch — they are optional. The recorder still opens; capture fidelity may be reduced until native modules build.

## 2. Start backend (API + web + infra)

```bash
./scripts/dev-up.sh
```

Demo logins (after seed):

- `contributor@acme.test` / `demo123`
- `reviewer@acme.test` / `demo123`
- `admin@acme.test` / `demo123`

API: `http://localhost:4000` · SOP Viewer: `http://localhost:3000/sop-viewer`

## 3. Install and launch the desktop agent

```bash
cd apps/desktop
npm install
npm start
```

`npm start` **builds** `dist/main.js` then launches Electron. A missing `dist/main.js` is the usual launch failure — always build (or use `npm start`, which does).

Optional unpackaged directory build:

```bash
cd apps/desktop
npm run package
# output under apps/desktop/release/
```

Or from repo root with backend already up:

```bash
./scripts/dev-up.sh --desktop
```

## 4. Capture → SOP DRAFT (happy path)

1. In the recorder window, **log in** with a demo user.
2. **Create Session**, then **Start Session**.
3. Confirm the red **RECORDING** banner and consent strip are visible (window stays on top).
4. Switch apps/windows and/or add a user note while recording.
5. **Stop Session**.
6. **Build Timeline**, then **Generate SOP Draft**.
7. Open **SOP Viewer** (`http://localhost:3000/sop-viewer`) with the session id — status must be **DRAFT** (human review required; nothing auto-publishes).

## Consent rules (non-negotiable)

- Capture runs only after you click **Start Session**.
- Visible RECORDING + consent chrome while active.
- No hidden/background recording, no full keylogging, no passwords/secrets.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot find module '.../dist/main.js'` | `cd apps/desktop && npm run build` (or `npm start`) |
| Electron opens then native capture errors | Optional — window should still work; grant OS Accessibility / Input Monitoring on macOS for full capture |
| API login fails | Ensure `./scripts/dev-up.sh` finished and `/health` returns 200 |
| SOP not DRAFT | Generate via desktop/API only creates DRAFT; approve is a separate human action |

## Related docs

- `apps/desktop/README.md` — desktop agent overview
- `README.md` — repo map and MVP stack
- `docs-pack/` — LLD and coding-agent instructions (source of truth)
