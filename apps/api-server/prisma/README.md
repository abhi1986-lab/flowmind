# FlowMind Prisma schemas (split control vs client data plane)

Architecture fix #1: operational models must **never** live in the same Prisma
schema as control-plane models. Migrating the control DB with a unified schema
risks creating `sessions` / `events` / `workflows` / `sop_documents` tables in
the control plane.

## Layout

| Path | Purpose |
|------|---------|
| `control/schema.prisma` | Control plane only: clients, routes, licenses, platform admins, audit |
| `control/migrations/` | Migrations applied to `CONTROL_DATABASE_URL` / `DATABASE_URL` |
| `client/schema.prisma` | Client data plane only: users, sessions, events, artifacts, workflows, SOPs, capture policies |
| `client/migrations/` | Optional migrations for per-client DBs (dev still uses `db push`) |

## Generate (both required before typecheck/build)

```bash
npx prisma generate --schema=prisma/control/schema.prisma
npx prisma generate --schema=prisma/client/schema.prisma
```

- Control client → `@prisma/client` (default output)
- Client data client → `@prisma/client-data` (custom output)

## Migrate / push

```bash
# Control plane (ZERO ops tables)
DATABASE_URL=$CONTROL_DATABASE_URL npx prisma migrate deploy --schema=prisma/control/schema.prisma

# Client data plane (ops only; per-client URL)
npx prisma db push --schema=prisma/client/schema.prisma --url "$CLIENT_DATABASE_URL"
```

Root shortcuts: `npm run db:control:generate`, `db:client:generate`, `db:generate`,
`db:control:migrate`, `db:client:push`.
