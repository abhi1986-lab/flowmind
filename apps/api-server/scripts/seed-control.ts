/**
 * Seed script for FlowMind AI Control Plane (MVP)
 * Run after control DB is up: npx tsx scripts/seed-control.ts   (or ts-node)
 *
 * Creates:
 *  - Example client "Acme Corp" with slug "acme"
 *  - ClientRoute with *secret refs* (not live Postgres URLs / AI keys)
 *  - Basic license
 *  - One platform admin (email: platform@flowmind.internal / pass: ChangeMe123!)
 *
 * Secret refs (Gate 0.2):
 *  - db_connection_ref = "client-a-db" → resolved at runtime via CLIENT_A_DATABASE_URL
 *  - ai_config_ref     = "client-a-ai" → resolved via CLIENT_A_AI_CONFIG or shared AI_* env
 *  - s3_bucket_ref / vector_namespace remain non-secret routing refs
 *
 * NOTE: Real client users (admins, reviewers, contributors) live inside the per-client database,
 * not here. This seed only populates routing + platform control data.
 */

import 'dotenv/config'; // load .env so DATABASE_URL is available when running the script directly
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.CONTROL_DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL or CONTROL_DATABASE_URL must be set for control plane seed');
}
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter, log: ['error'] });
// In docker the CONTROL_DATABASE_URL or DATABASE_URL will be set
// Locally we rely on .env / prisma.config.ts
// Using @prisma/adapter-pg for clean direct Postgres support with the modern Prisma client engine (no accelerateUrl hack).

async function main() {
  console.log('Seeding FlowMind control plane...');

  // Example client
  const client = await prisma.client.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      name: 'Acme Corporation',
      slug: 'acme',
      status: 'active',
      plan: 'mvp',
    },
  });
  console.log('Created/ensured client:', client.slug, client.id);

  // Route for the client — SECRET REFS ONLY (Gate 0.2).
  // Runtime resolves:
  //   client-a-db → CLIENT_A_DATABASE_URL (or SECRET_REFS_JSON)
  //   client-a-ai → CLIENT_A_AI_CONFIG JSON or shared AI_PROVIDER / XAI_API_KEY / ...
  await prisma.clientRoute.upsert({
    where: { clientId: client.id },
    update: {
      dbConnectionRef: 'client-a-db',
      s3BucketRef: 'client-a-artifacts',
      vectorNamespace: 'client_a',
      aiConfigRef: 'client-a-ai',
    },
    create: {
      clientId: client.id,
      dbConnectionRef: 'client-a-db',
      s3BucketRef: 'client-a-artifacts',
      vectorNamespace: 'client_a',
      aiConfigRef: 'client-a-ai',
    },
  });
  console.log('Client route configured for acme → refs client-a-db / client-a-ai (no live secrets in control DB).');
  console.log('  Resolve DB:  set CLIENT_A_DATABASE_URL (see infra/.env.example)');
  console.log('  Resolve AI:  set CLIENT_A_AI_CONFIG and/or AI_PROVIDER + provider API key env');

  // License (use find/create to avoid unique input typing for upsert in this Prisma version)
  const existingLicense = await prisma.clientLicense.findFirst({
    where: { clientId: client.id },
  });
  if (!existingLicense) {
    await prisma.clientLicense.create({
      data: {
        clientId: client.id,
        status: 'active',
        maxUsers: 100,
        maxWorkstations: 30,
      },
    });
  }

  // Platform admin (for future platform ops UI if built)
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);

  await prisma.platformAdmin.upsert({
    where: { email: 'platform@flowmind.internal' },
    update: {},
    create: {
      email: 'platform@flowmind.internal',
      name: 'Platform Admin',
      role: 'platform_admin',
      status: 'active',
      passwordHash,
    },
  });
  console.log('Platform admin seeded: platform@flowmind.internal / ChangeMe123! (change immediately)');

  console.log('\nControl plane seed complete.');
  console.log('Next: Bring up full stack. The client resolver will now be able to route "acme" requests.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
