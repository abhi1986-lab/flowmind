# FlowMind AI - Desktop Workflow Agent (Electron + TypeScript)

**Lightweight observer only.**

A minimal visible shell has been created in src/main.ts (data URL UI for immediate foundation validation).

Full responsibilities (MVP):
- Visible login (obtains JWT with client_id from /auth/login)
- Start / Pause / Resume / Stop (user intent only)
- ALWAYS visible + obvious recording indicator while active
- Capture only allowed signals (app/window, clicks, safe KEY_ACTION categories, screen delta, notes)
- Local encrypted buffer + retrying upload queue
- Pre-signed artifact flow + batch events to /agent/* (protected by ClientResolver)

**Strict prohibitions (enforced in code and review)**:
- No full keylogging / passwords / form values
- No webcam/mic in MVP
- No hidden/background recording
- No local heavy AI/OCR/automation

See detailed LLD in docs-pack/06_Desktop_Agent_LLD.docx and root constraints.

To try the shell: cd apps/desktop && npm install && npm run dev (requires electron in path or the package).

This component is next priority after the current platform/auth/resolver foundation to achieve the "record workflow -> see timeline" milestone.
