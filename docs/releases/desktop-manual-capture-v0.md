# FlowMind AI — Desktop Manual Capture v0

**Release Date:** 2026-06-12

## Summary

This milestone completes the first end-to-end MVP spine for FlowMind AI:

**Desktop Agent Manual Input → Backend Session → Safe Events → Timeline → SOP Draft → SOP Viewer / Review**

It demonstrates a controlled, consent-based workflow intelligence prototype that turns manually captured operational sessions into human-reviewable SOP drafts, with all operational data isolated to the client data plane and no operational data stored in the shared control plane.

This is explicitly **not** full task mining or automated process discovery. It is a manual-capture SOP-generation prototype.

## What Works Now

- **DB-backed foundation**: Full control plane (client registry, routing, licensing, metadata only) and per-client operational data planes using PostgreSQL + Prisma with driver adapters.
- **Client resolver with real DB-backed isolation**: Requests are validated against JWT `client_id` matching the resolved client from subdomain or `X-Client-Id` header (dev). AccessScope and client-specific PrismaClient are provided only after isolation check.
- **Client-specific operational DB writes**: All sessions, events, workflows, and SOP documents are written exclusively to the resolved client's database.
- **Session creation/start/stop**: Full lifecycle via protected `/agent/sessions` endpoints. Status transitions (CREATED → RECORDING → STOPPED) persisted in client DB.
- **Safe event ingestion**: Batch upload of events via `/agent/events/batch`. Explicit rejection of `typedText`, raw keystrokes, or any keylogging fields.
- **Timeline builder**: Deterministic conversion of session events into ordered, grouped workflow steps (app/window changes as major steps, actions grouped). Stored as `Workflow` draft in client DB.
- **Template-based SOP draft generation**: Pure deterministic/template SOPs (no LLM). Includes title, purpose, scope, prerequisites, step-by-step procedure, decision points, exceptions/notes, and checklist. Stored as `SopDocument` with status `DRAFT`.
- **SOP review APIs**: Full human review flow (`PATCH /agent/sop-documents/:id`, `/submit-review`, `/approve`, `/reject` with optional reason). Statuses: DRAFT → IN_REVIEW → APPROVED or REJECTED. Approval/rejection gated by basic `REVIEW_SOP` permission or reviewer/admin role.
- **Minimal SOP viewer**: Functional (not polished) Next.js page at `/sop-viewer` for dev/demo: login, session ID input, fetch/display timeline + SOP, edit content (PATCH), submit/approve/reject buttons.
- **Electron desktop manual capture UI (v0)**: Login with demo credentials (token in memory), Create/Start/Stop Session buttons with real API calls. Manual safe event buttons (App Changed, Window Changed, Mouse Clicked, Key Action: TAB_NAVIGATION, User Note with input). Post-stop: Build Timeline, Generate SOP Draft, Open SOP Viewer instruction (with session ID).
- **End-to-end manual spine**: Desktop-driven sessions produce real client-DB records for sessions, events, workflows, and SOP drafts that can be viewed/reviewed.

## Architecture Constraints Preserved

- TypeScript-only product stack (Electron + NestJS + Next.js + Prisma).
- No operational data (sessions, events, workflows, SOPs, artifacts) in the control plane — control plane stores only client registry, routing references, licenses, and platform metadata.
- No hidden monitoring or employee surveillance.
- No keylogging: only safe event categories (e.g., `KEY_ACTION: TAB_NAVIGATION`); `typedText` and raw keystrokes are explicitly rejected at ingestion.
- No raw typed text capture.
- No desktop hooks, real OS-level capture, or screenshots yet (manual buttons only).
- No LLM/AI integration yet (deterministic template SOP generator only).
- No SOP auto-approval or auto-publishing: all SOPs start as DRAFT; human review is required for status changes.
- Human review remains required.

## Validation Summary

The following were executed and confirmed working:

- `npm run typecheck` — clean
- `npm run lint` — clean (source)
- `npm run build` — succeeds (API + web + desktop)
- Docker-backed environment (Postgres control + client-a, Redis, MinIO) healthy
- API health check (`/health` → 200)
- Login (demo contributor/reviewer/admin accounts)
- Desktop manual session create/start/stop
- Safe events upload (4 events per validation, no forbidden fields)
- Timeline generation
- SOP draft generation
- SOP viewer access and fetch
- Client DB contains: session (with status/timestamps), events (safe types), workflow (steps), sop_documents (with status and content)
- Control DB contains: only client metadata (e.g., "acme"); no sessions, events, workflows, or sop_documents tables/data (queries return "relation does not exist" or count 0 for operational entities)

## Known Limitations

- Desktop agent uses manual buttons only (no real OS-level app/window/click/keyboard capture).
- No real OS-level desktop capture, screenshots, or hooks yet.
- No encrypted local desktop buffer.
- Token stored in memory only (no OS keychain or secure storage yet).
- SOP generation is deterministic/template-based (no LLM yet).
- UI (both desktop and /sop-viewer) is functional for demo/validation, not polished or production-ready.
- No real customer deployment hardening, scaling, or security review yet.
- Client DB schema applied via `db push` for local dev (proper migrations per client would be used in production).
- No full RBAC UI or advanced permission management (lean role/permission checks only).

## Next Recommended Slice

**Demo Hardening + SOP Quality v0**

Suggested scope (keep lean, no new capture):

- Improve SOP formatting and readability (better markdown-like structure, consistent sections).
- Add copy/export to Markdown (from SOP viewer and/or API).
- Improve SOP viewer layout slightly (better readability, status badges, simple edit form — still no polish).
- Add a sample workflow/demo seed path (one-click "load demo session" that creates a full end-to-end example for reviewers).
- Keep desktop capture manual for now.
- Do not start real OS-level capture, screenshots, or hooks until SOP output quality is demonstrably strong and review flow is solid.

## Git Status

- `main` has been pushed (includes all slices up to Desktop Manual Capture v0).
- Tag `desktop-manual-capture-v0` has been created and pushed.
- Previous tags exist and are pushed: `foundation-db-backed-v0`, `sop-review-mvp-v0`.
- Working tree clean on main at time of this note.
- Feature work was done on `feature/client-data-plane-session-events` (merged via PR).

## Final Verdict

This release proves the first usable MVP spine: a controlled manual-capture SOP-generation prototype that goes from desktop manual input all the way to a reviewable SOP draft stored in an isolated client database, with the control plane remaining strictly metadata-only.

It is **not** yet real task mining, automated process discovery, or production software. It is a working, auditable, consent-based manual prototype that validates the core value chain and architecture constraints.

All operational data lives only in the resolved client DB. Human review is required. No keylogging, no hidden capture, no auto-publishing.

The foundation is solid for the next targeted improvements in SOP quality and demo experience.

---

*This document was created as documentation only. No product code, architecture, or existing docs were modified.*
