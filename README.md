# FlowMind AI

**Operational Workflow Intelligence Platform**

FlowMind AI captures real operational workflows (with explicit user consent) and converts them into reusable organizational knowledge: SOPs, workflow maps, training guides, onboarding material, process intelligence, and searchable memory.

**This product is NOT employee surveillance, NOT hidden monitoring, NOT productivity spying.**

Recording is always:
- Visible
- Intentional
- User-controlled
- Auditable

## Non-Negotiable Constraints (MVP)

- **TypeScript only** for product code (no Python, Go, Java, Rust services in MVP).
- **Hybrid Shared-Application / Client-Isolated Data Architecture**:
  - Shared NestJS application layer.
  - **Per-client isolated data plane**: own PostgreSQL DB, own S3 bucket/namespace, own pgvector namespace (via pgvector in client DB for MVP), own LLM config.
  - Control plane stores **only** routing, licensing, platform metadata. **Never** workflow events, screenshots, SOP content, or client operational data.
- **Client Resolver** (critical boundary): Subdomain (e.g. `client-a.flowmind.ai`) **must** match `JWT.client_id`. Reject mismatch. Support `X-Client-Id` header + `localhost` for local dev.
- **Desktop Agent (Electron + TS)**: Lightweight. `Observe → Capture → Protect → Buffer → Upload`. No local LLM, no heavy OCR, no keylogging, no automation replay.
- **Capture model**: Hybrid Event-Driven Screen-State Capture. Meaningful events (app change, window change, click, TAB/ENTER/ESC navigation category, significant visual delta, user note, session start/stop). Time-based only as fallback.
- **Privacy/Keylogging**: No full keystrokes, passwords, form values, or raw key stream. Allowed: safe signals like `KEY_ACTION: TAB_NAVIGATION`.
- **AI**: Provider-agnostic (OpenAI, Claude, Gemini, Azure, Ollama, self-hosted, ...). AI produces **drafts only**. Humans review/approve. No auto-publish, no autonomous execution.
- **Storage**: PostgreSQL for structured (users, sessions, events, SOPs, audit). S3-compatible for screenshots/artifacts (per-client buckets). **No binaries in Postgres**.
- **MVP stack**: Docker Compose + Postgres (control + client DBs) + Redis + MinIO + NestJS (api + worker) + Next.js + Electron. No K8s, no Terraform yet.
- **Vector**: pgvector inside client PostgreSQL DB for MVP. No dedicated vector DB.
- **Security mandatory**: HTTPS/TLS, JWT + RBAC, encrypted local desktop buffer, encrypted at rest in object/DB where applicable, OS keychain for tokens, full audit logging for sensitive actions.
- **Audit**: Login, session lifecycle, uploads, SOP generate/approve/reject, user/role changes, exports, deletes.
- **Development order** (do not deviate):
  1. Platform foundation, auth, org/client setup.
  2. Client resolver + DB-per-client routing.
  3. Desktop agent MVP.
  4. Event/artifact ingestion.
  5. Session timeline.
  6. Workflow processing + AI (drafts only).
  7. Review/approve + library.
  8. Audit + policy.
- **First milestone**: Record a workflow (visible) → clean timeline visible in dashboard.
- **Second milestone**: Generate human-reviewable SOP draft from captured workflow.

See `docs-pack/` (original detailed design docs) and this README for full rules.

## Quick Start (Local Dev - Docker Compose)

1. `npm install`
2. `npm run docker:up`
   - Brings up: control-plane postgres, example client postgres, redis, minio, api, worker, web (Next).
3. Seed control plane (once DBs ready): `npm run seed:control`
4. Desktop agent: (see apps/desktop/README.md once implemented)
5. Dashboard: http://localhost:3000 (or client sub)
6. API: http://localhost:4000

For local multi-client testing without real DNS:
- Use header `X-Client-Id: client_a` during dev (resolver supports).
- Or edit /etc/hosts for `127.0.0.1 client-a.localhost` and run with appropriate port mapping.

**Never** commit secrets, client DB connection strings, or MinIO keys.

## Project Layout

```
.
├── apps/
│   ├── api-server/     # NestJS shared application layer + control plane access
│   ├── worker/         # BullMQ background processors (timeline, AI jobs, etc.)
│   ├── web/            # Next.js React dashboard (admin, reviewer, etc.)
│   └── desktop/        # Electron + TS desktop workflow agent
├── packages/
│   ├── shared-types/   # Shared TS interfaces/DTOs/event schemas (used by all)
│   ├── shared/         # Common utilities, constants, error types
│   └── ai-providers/   # Pluggable AIProvider interface + concrete adapters (MVP stubs)
├── infra/
│   └── docker-compose.yml
├── scripts/
├── docs/               # This README + any generated; original pack in docs-pack/
└── package.json
```

## Key Rules Enforcement (for all contributors / AI agents)

From AI Coding Agent Instructions + Constraints Summary:

- Every client-data path: AuthGuard + ClientResolverGuard + PermissionGuard.
- Repositories receive AccessScope (never raw Prisma without client scope).
- Write audit logs for sensitive actions.
- Desktop: only safe key categories; visible indicator always when capturing; user-initiated only.
- All AI output = draft + review task. Human is the approver.
- Client data never crosses isolation boundary.
- If in doubt: re-read the constraints summary and AI_Coding_Agent_Instructions.docx.

## Current Status

This is early MVP foundation work in progress. Follow the exact development order.

See original detailed pack in `docs-pack/`:
- 01_MVP_Scope_Document.docx
- 04_Database_Design_Document.docx
- 05_API_Design_Document.docx
- 07_Backend_LLD.docx
- 10_Infrastructure_and_Deployment_Design.docx
- 13_Development_Roadmap_and_Sprint_Plan.docx
- 14_AI_Coding_Agent_Instructions.docx
(and others).

MVP success = one clean end-to-end: visible record → timeline → SOP draft → human approve → library entry.

Built with strict adherence to the product constraints.
