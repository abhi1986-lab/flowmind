-- FlowMind AI Client Data Plane - Initial Migration
-- Operational tables ONLY. Apply to per-client DBs, never to control.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "role" TEXT NOT NULL DEFAULT 'CONTRIBUTOR',
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "capture_policies" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "screenshots_enabled" BOOLEAN NOT NULL DEFAULT true,
  "app_blocklist" JSONB NOT NULL DEFAULT '[]',
  "window_blocklist" JSONB NOT NULL DEFAULT '[]',
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ended_at" TIMESTAMPTZ,
  "source_agent_version" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "events" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "session_id" UUID NOT NULL REFERENCES "sessions"("id"),
  "sequence_no" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  "app_name" TEXT,
  "window_title" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "artifacts" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "session_id" UUID NOT NULL REFERENCES "sessions"("id"),
  "event_id" UUID REFERENCES "events"("id"),
  "storage_key" TEXT NOT NULL,
  "artifact_type" TEXT NOT NULL,
  "hash" TEXT,
  "size_bytes" INTEGER NOT NULL,
  "upload_status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "workflows" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "source_session_id" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "steps" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "sop_documents" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "workflow_id" UUID NOT NULL REFERENCES "workflows"("id"),
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "content" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "events_session_id_idx" ON "events"("session_id");
CREATE INDEX "artifacts_session_id_idx" ON "artifacts"("session_id");
CREATE INDEX "sop_documents_workflow_id_idx" ON "sop_documents"("workflow_id");
