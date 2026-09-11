-- FlowMind AI Control Plane - Initial Migration
-- Creates only the shared control plane tables.
-- Client operational data lives in separate per-client DBs.

-- Enable extension for uuid if needed (Postgres 13+ has gen_random_uuid, but uuid-ossp common)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Clients (tenants)
CREATE TABLE "clients" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "plan" TEXT NOT NULL DEFAULT 'mvp',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client routing / data plane pointers (THE critical isolation record)
CREATE TABLE "client_routes" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "client_id" UUID NOT NULL UNIQUE REFERENCES "clients"("id") ON DELETE CASCADE,
  "db_connection_ref" TEXT NOT NULL,
  "s3_bucket_ref" TEXT NOT NULL,
  "vector_namespace" TEXT NOT NULL,
  "ai_config_ref" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client licenses / limits
CREATE TABLE "client_licenses" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "client_id" UUID NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "max_users" INTEGER NOT NULL DEFAULT 50,
  "max_workstations" INTEGER NOT NULL DEFAULT 20,
  "expires_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Internal platform administrators (control plane users)
CREATE TABLE "platform_admins" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'platform_admin',
  "status" TEXT NOT NULL DEFAULT 'active',
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only control plane audit
CREATE TABLE "platform_audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "actor_id" UUID,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Basic indexes
CREATE INDEX "client_routes_client_id_idx" ON "client_routes"("client_id");
CREATE INDEX "client_licenses_client_id_idx" ON "client_licenses"("client_id");
CREATE INDEX "platform_audit_logs_created_at_idx" ON "platform_audit_logs"("created_at");
