# FlowMind AI - Foundation Status (2026-06-12)

This marks completion of the initial platform foundation sprint per the Product & Development Constraints Summary and the AI Coding Agent Instructions.

## What Was Built

**Monorepo + Infra**
- Root workspaces (npm), tsconfig.base, .gitignore, root README with all constraints.
- `infra/docker-compose.yml`: control postgres, client-a postgres, redis, minio + init, api, worker, web skeletons.
- Data dirs + .env.example.

**Control Plane (api-server)**
- NestJS 11 + TypeScript.
- Prisma for control plane only (clients, client_routes, client_licenses, platform_admins, platform_audit_logs).
- Manual initial migration + seed script (`npm run seed:control`).
- ControlPrismaService (global, isolated).

**Client Resolver (the most important isolation boundary)**
- ClientResolverService: extracts slug from subdomain (preferred) or X-Client-Id header (dev only when ALLOW_DEV_CLIENT_HEADER=true).
- Loads ClientRoute from control DB.
- ClientResolverGuard: after JWT auth, **hard rejects** if JWT.client_id does not match resolved client slug/id.
- Attaches validated AccessScope (clientId, db ref, bucket, ai config, actor, permissions) to every downstream request.

**Auth (MVP bootstrap)**
- JWT (via @nestjs/jwt).
- Demo login for acme client users: contributor@acme.test / demo123, reviewer@acme.test, admin@acme.test (and platform).
- Tokens carry `client_id` (uuid from control) + role + permissions.
- /auth/me protected.
- JwtAuthGuard + ClientResolverGuard chain demonstrated on /agent/* stubs.

**Agent API Shell (protected)**
- GET /agent/config
- POST /agent/sessions + /start /stop
- POST /agent/events/batch
All routes enforce the full guard chain and client isolation.

**Shared Types**
- @flowmind/shared-types: Role, Permission, EventType (only safe ones), CapturedEvent, SessionStatus, JwtPayload (with client_id), AccessScope, AuditAction, etc.

**Web + Desktop Shells**
- Next.js scaffold (apps/web) - minimal, to be expanded after ingestion.
- Electron shell (apps/desktop) with obvious visible recording state UI + strong comments on prohibitions. Ready for real capture implementation.

**Strict Constraint Adherence (verified in this foundation)**
- TypeScript only.
- No client operational data in control plane.
- Client resolver + JWT client_id match enforced before any client data access.
- No keylogging concepts in code or types (only KEY_ACTION safe categories + metadata notes).
- Desktop explicitly "observe/capture/protect/buffer/upload".
- AI not started (provider package is empty interface placeholder only).
- No auto-publish, no hidden recording.
- Audit points identified in types.
- MVP infra (no K8s).
- Development order followed: platform → auth/org → client resolver → (stubs for) desktop/ingestion.

## Next Steps (per Development Order Constraint)

1. Bring up docker (once daemon available): `npm run docker:up`, seed control.
2. Test login + protected /agent endpoints with curl or desktop shell (use X-Client-Id: acme or host acme.localhost).
3. Implement real per-client DB schema + ClientPrismaService factory (users, sessions, events, artifacts tables per DB design).
4. Desktop agent real implementation: login flow (store token in OS keychain/safeStorage), event capture (using uIOhook or native for safe signals only), screen capture on events, local encryption (crypto or electron safe storage + file), upload with pre-signed.
5. Event ingestion + session timeline viewer (first real milestone).
6. Then workflow processing, AI (stub first), SOP draft + review.

## How to Exercise the Foundation (when DBs running)

```bash
# After docker services healthy + seed
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"contributor@acme.test","password":"demo123"}'

# Use the returned accessToken
curl http://localhost:4000/agent/config \
  -H "Authorization: Bearer <token>" \
  -H "X-Client-Id: acme"
```

The resolver will validate, attach scope, and the stub will return client-scoped config.

All changes preserve the "Hybrid Shared-Application, Client-Isolated Data Architecture".

## Files of Note
- Root README.md (full constraints)
- apps/api-server/src/modules/client-resolver/...
- apps/api-server/src/modules/auth/...
- packages/shared-types/src/index.ts
- infra/docker-compose.yml
- FOUNDATION_STATUS.md (this)

Ready for the next phase.

## DB-Backed Foundation Validation (2026-06-12 follow-up)

Real Docker-backed control plane + client resolver validation completed.

### What was validated
- Full infra startup via compose (control postgres, client-a postgres, redis, minio).
- Control plane schema migration applied to real DB.
- seed:control succeeded and created real "acme" client + route record.
- Temporary acme short-circuit removed; resolver now does real DB lookup via ClientResolverService + ControlPrismaService (using @prisma/adapter-pg for modern client engine compatibility).
- All specified auth + agent config endpoints with correct isolation, auth, and resolution behavior (no shims).

### Commands run (key ones)
```bash
docker info
cd FlowmindAI && docker compose -f infra/docker-compose.yml up -d postgres-control postgres-client-a redis minio minio-init
cd FlowmindAI/apps/api-server && npx prisma generate
cd FlowmindAI && npm run db:control:migrate
cd FlowmindAI && npm run seed:control   # now uses tsx + adapter
# (edited seed-control.ts and control-prisma.service.ts for adapter + dotenv + tsx)
# (removed short-circuit block in client-resolver.service.ts)
cd FlowmindAI && npm run api:dev
# then the curl validations below
```

### Docker status
```
29.3.1 linux
```
Containers healthy, DBs listening on mapped ports 5432/5433.

### Migration output
```
1 migration found in prisma/migrations
Applying migration `20250612000000_init_control`
All migrations have been successfully applied.
```

### Seed output
```
Seeding FlowMind control plane...
Created/ensured client: acme d7a3ea06-a17c-4190-864c-4a7259c92e20
Client route configured for acme -> client-a data plane.
Platform admin seeded: platform@flowmind.internal / ChangeMe123! (change immediately)
Control plane seed complete.
```

### DB record confirmation (via psql in container)
```
 id                  |       name       | slug | status 
 d7a3ea06-a17c-4190-864c-4a7259c92e20 | Acme Corporation | acme | active

 id                  |              client_id               | db_connection_ref ... | s3_bucket_ref
 ... | d7a3ea06-... | postgresql://client_a:... | client-a-artifacts
```

### Exact curl outputs (from clean `npm run api:dev` server)
**GET /health**
```
{"status":"ok","service":"flowmind-api","timestamp":"..."}
CODE:200
```

**POST /auth/login contributor@acme.test / demo123**
```
{"accessToken":"eyJ... (contains real client_id d7a3ea06-...)","user":{... "clientId":"d7a3ea06-a17c-4190-864c-4a7259c92e20" ...}}
CODE:201
```

**GET /agent/config (valid JWT + X-Client-Id: acme)**
```
{"clientId":"d7a3ea06-a17c-4190-864c-4a7259c92e20", ... "message":"Agent config (stub)..." }
CODE:200
```

**GET /agent/config (mismatched JWT client_id + X-Client-Id: acme)**
```
{"message":"Client isolation violation: token client_id (wrong-client-id-123) does not match request client (acme).","error":"Forbidden","statusCode":403}
CODE:403
```

**GET /agent/config (no JWT)**
```
{"message":"Missing or invalid Authorization header","error":"Unauthorized","statusCode":401}
CODE:401
```

**GET /agent/config (valid JWT, no X-Client-Id, no subdomain)**
```
{"message":"Unable to resolve client. Use a client subdomain (e.g. acme.localhost) or X-Client-Id header in dev.","error":"Bad Request","statusCode":400}
CODE:400
```

### Confirmation temporary acme short-circuit removed
Yes. The entire `if (slug === 'acme') { return fake... }` block was deleted from client-resolver.service.ts. Resolver now always performs real `findUnique` against control DB (via the adapter-backed ControlPrismaService).

### Confirmation control plane has no sessions/events/screenshots/SOP tables
Confirmed by schema (only clients, client_routes, client_licenses, platform_admins, platform_audit_logs). Operational data lives exclusively in per-client DBs (e.g. client_a_db). No operational tables were ever added to control schema.

### Final verdict
**DB-backed foundation passed.**

All infrastructure, migration, seeding, short-circuit removal, resolver, and the 6 required endpoint behaviors validated against a real running control DB record for "acme". Client isolation and guard enforcement working as designed with live data.

## MVP SOP Generation Slice (lean focus on Session → Events → Timeline → SOP Draft)

Per the important product correction: core MVP is **not** full task mining but a clear path to human-reviewable SOPs from captured sessions.

Value chain implemented: **Session → Events (safe) → Timeline (grouped) → SOP Draft (template) → DRAFT (human review required)**.

### Strict Scope Adhered To
- Only Client Data Plane + Session/Event Backbone + minimal Timeline + template SOP.
- No desktop capture, no LLM (deterministic template generator only), no auto-publish/approve, no complex analytics/automation discovery, no billing/SSO/etc.
- Client isolation via resolver + client-specific Prisma (adapter) — all operational data (sessions, events, workflows, sop_documents) only in client DB.
- Control plane untouched for operational data.

### Implementation Highlights (small commits)
- Extended client schema with Workflow (timeline output) and SopDocument (with status DRAFT/IN_REVIEW/APPROVED/REJECTED).
- TimelineBuilder: deterministic grouping of events into ordered steps (app/window changes as major, actions grouped).
- SopDraftGenerator: pure template filling — title, purpose, scope, prerequisites, procedure (from steps), decision points (heuristic), exceptions, checklist.
- Endpoints added behind existing guards:
  - POST /agent/sessions/:id/build-timeline (stores Workflow draft)
  - POST /agent/sessions/:id/generate-sop-draft (stores SopDocument as DRAFT; auto-builds timeline if needed for lean flow)
- Event batch explicitly rejects typedText/raw keystrokes (enforced at ingestion).
- Session backbone (create/start/batch/stop) already wired from prior slice, now exercised end-to-end for SOP path.

### Validation Executed (exact per query)
1. Login (demo user) → JWT.
2. Create session → real ID from client DB.
3. Upload 4 safe sample events (APP_CHANGED, MOUSE_CLICK, KEY_ACTION nav, USER_NOTE — no forbidden fields) → accepted.
4. Stop session.
5. Build timeline → grouped steps, stored Workflow draft in client DB.
6. Generate SOP draft → full template content, stored as DRAFT SopDocument linked to workflow.
7. Queries:
   - **Client DB (postgres-client-a)**: Session (STOPPED with timestamps), 4 Events, 1 Workflow (with steps JSON), 1 SopDocument (DRAFT + full sections: title/purpose/scope/procedure/decisionPoints/exceptions/checklist).
   - **Control DB (postgres-control)**: Only client registry/routing (acme record). Queries for "sessions"/"events"/"sop_documents" fail with "relation does not exist" — proving **zero operational data** in control plane.

All via real DB connections from resolver (no short-circuit).

### Checks
- Baseline (before code): typecheck/lint/build passed.
- After full slice: typecheck/lint/build passed (re-ran).
- Working tree managed with small logical commits on feature/client-data-plane-session-events.
- Tag foundation-db-backed-v0 on baseline (pushed).

This completes the minimum backend flow for "create an SOP from a workflow session" with human review gate. Ready for desktop integration in future constrained work.

Next recommended (if continuing lean): desktop agent to feed real events into these endpoints, or simple SOP review/approve endpoints with status transitions. 

**Current branch:** feature/client-data-plane-session-events
**Tag:** foundation-db-backed-v0 (on baseline)
**Status:** MVP SOP path validated end-to-end with proper isolation.

Implemented the next foundation slice per development order and constraints.

### Branch & Process
- Created from clean baseline (after tagging foundation-db-backed-v0 on main).
- Switched to feature/client-data-plane-session-events.
- First actions (per rules): pulled/verified latest from origin, ran `npm run typecheck`, `npm run lint`, `npm run build` — all passed cleanly. Foundation confirmed intact before any new code.
- Small logical commits only.
- Strict scope followed: only Client Data Plane + Session/Event Backbone. No desktop, AI, SOP, dashboard.

### Small Logical Commits
1. feat(client-data-plane): add session, event, artifact, user, capture_policy models to Prisma schema
2. feat(client-data-plane): add ClientPrismaFactory for per-client DB connections using adapter
3. feat(client-data-plane): wire ClientPrismaFactory into ClientResolverGuard (attaches req.clientPrisma after isolation check)
4. feat(session-event-backbone): implement real persistence in agent endpoints using client DB (create/update sessions + events via the factory-provided prisma)

### Key Implementation
- Client models added to the single schema (used exclusively when PrismaClient is instantiated against a client DB url from client_routes; control DB unaffected).
- ClientPrismaFactory (in global PrismaModule): creates/caches PrismaClient + @prisma/adapter-pg + Pool for the exact dbConnectionRef of the resolved client. This + the guard is the runtime enforcement of "Client Data Plane" isolation.
- Guard enhancement: after the hard client_id match check, attaches the correct clientPrisma to the typed AuthenticatedRequest (in addition to accessScope).
- Real (non-stub) logic in AgentSessionsController (still fully protected by JwtAuthGuard + ClientResolverGuard):
  - POST /agent/sessions → user upsert (demo) + session.create in the client's DB; returns real DB id.
  - POST /agent/sessions/:id/start → session.update status + startedAt in client DB.
  - POST /agent/sessions/:id/stop → session.update status + endedAt in client DB.
  - POST /agent/events/batch → createMany events linked to the sessionId in client DB.
- /agent/config left as stub (policy can be next within this slice if desired).
- Client DB tables applied via `prisma db push` against the client-a connection string (for local dev validation; production would use proper migrations per client).
- Connection string in the seeded client_route was adjusted (host-mapped port) so the host-run api-server can reach the Dockerized client-a DB.
- All DB operations use the live route record from control DB (real findUnique in resolver for 'acme' from X-Client-Id or host).

### Validation (post-impl, on feature branch)
- Re-ran typecheck / lint / build after code: clean (baseline + new slice passes; no lint/type regressions).
- Full live curl sequence (real token from /login now carries the actual DB client_id; all against the running server on the feature branch):
  - Login: 201 (token with real clientId d7a3ea06-... from control record).
  - Config (valid JWT + X-Client-Id: acme): 200.
  - Create session: 200, real sessionId returned from client DB (e.g. e6dc6b59-...).
  - Start: 201, DB record updated.
  - Batch 1 event: 201, event persisted in client DB linked to session.
  - Stop: 201, DB record updated.
  - Mismatch (wrong client_id in JWT + correct header): 403 "Client isolation violation..." (real DB lookup + guard check).
  - No JWT: 401.
  - No X-Client-Id (dev mode): 400 "Unable to resolve client...".
- Guard and resolver isolation fully exercised with live data. No bypass.

### Key Commands (this slice)
```bash
# (git fetch/verify + tag + branch creation + baseline checks done first)
cd FlowmindAI/apps/api-server && npx prisma generate
# (schema edit + commit)
cd FlowmindAI && git commit -m "feat(client-data-plane): add ... models..."
# (factory file + module + commit)
# (guard wire + commit)
# (controller real impl + commit)
docker exec fm-postgres-control psql ... UPDATE client_routes SET db_connection_ref=... (host url)
npm run api:dev
# (validation curls as listed above)
npm run typecheck && npm run lint && npm run build
```

### Confirmation of Rules Followed
- No new product features outside the declared slice.
- No desktop capture, AI, SOP, dashboard.
- No history rewrite, no deletion of existing files.
- Architecture preserved (control = routing/metadata only; everything client operational goes through client resolver + per-client prisma).
- Small commits, checks before/after code, FOUNDATION_STATUS updated (this section).
- Current state on feature branch is the validated extension of the tagged foundation baseline.

This slice is complete and ready for the next constrained piece (e.g. desktop agent consuming these endpoints, or capture policy, or client user provisioning). All per the original product constraints and development order.
