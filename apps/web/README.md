# FlowMind Web Dashboard (Next.js)

**Keep minimal until after desktop agent + event ingestion + timeline viewer are working.**

Current state: Default Next.js scaffold from platform foundation.

MVP must eventually support:
- Login (uses backend /auth/login, sends X-Client-Id or runs on client subdomain)
- List sessions for current client (via AccessScope validated APIs)
- Session detail + timeline (events + linked screenshots from client bucket)
- SOP draft review, edit, approve, reject
- Workflow library

All API calls from browser must carry Authorization: Bearer <token> and the client context must match the JWT.

See development order in root README.

To run locally: npm run dev (after full docker or standalone with API on 4000)
