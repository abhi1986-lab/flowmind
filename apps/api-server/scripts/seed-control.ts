/**
 * Seed script for FlowMind AI Control Plane (MVP)
 * Run after control DB is up: npx tsx scripts/seed-control.ts   (or ts-node)
 *
 * Creates:
 *  - Example client "Acme Corp" with slug "acme"
 *  - ClientRoute with references to the docker compose client-a postgres and minio bucket
 *  - Basic license
 *  - One platform admin (email: platform@flowmind.internal / pass: ChangeMe123!)
 *
 * AI config is set from env (AI_PROVIDER=grok XAI_API_KEY=...) or defaults to stub.
 * Switch AI per-client by changing aiConfigRef JSON (grok | openai | ollama | stub).
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

  // Route for the client (matches docker-compose service names and ports internal to compose network)
  // AI config: switchable Grok / OpenAI / Ollama / stub (heuristic only)
  // Set env before seeding for easy config:
  //   AI_PROVIDER=grok XAI_API_KEY=xai-... npx tsx scripts/seed-control.ts
  //   AI_PROVIDER=openai OPENAI_API_KEY=sk-... ...
  //   AI_PROVIDER=ollama AI_MODEL=llama3 ... (uses http://localhost:11434/v1 by default)
  // Or edit aiConfigRef in DB after seed and restart api-server.
  const aiProvider = (process.env.AI_PROVIDER || 'stub').toLowerCase();
  const aiModel = process.env.AI_MODEL || (aiProvider === 'grok' ? 'grok-beta' : aiProvider === 'openai' ? 'gpt-4o-mini' : 'stub');
  let aiApiKey: string | undefined;
  let aiBaseURL: string | undefined;
  if (aiProvider === 'grok') {
    aiApiKey = process.env.XAI_API_KEY || process.env.AI_API_KEY;
    aiBaseURL = process.env.AI_BASE_URL; // optional override
  } else if (aiProvider === 'openai' || aiProvider === 'ollama') {
    aiApiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (aiProvider === 'ollama') {
      aiBaseURL = process.env.AI_BASE_URL || 'http://localhost:11434/v1';
    } else {
      aiBaseURL = process.env.AI_BASE_URL;
    }
  }

  const aiConfig = {
    provider: ['grok', 'openai', 'ollama'].includes(aiProvider) ? aiProvider : 'stub',
    model: aiModel,
    ...(aiApiKey ? { apiKey: aiApiKey } : {}),
    ...(aiBaseURL ? { baseURL: aiBaseURL } : {}),
  };

  await prisma.clientRoute.upsert({
    where: { clientId: client.id },
    update: {
      dbConnectionRef: 'postgresql://client_a:client_a_dev@postgres-client-a:5432/client_a_db',
      s3BucketRef: 'client-a-artifacts',
      vectorNamespace: 'client_a',
      aiConfigRef: JSON.stringify(aiConfig),
    },
    create: {
      clientId: client.id,
      dbConnectionRef: 'postgresql://client_a:client_a_dev@postgres-client-a:5432/client_a_db',
      s3BucketRef: 'client-a-artifacts',
      vectorNamespace: 'client_a',
      aiConfigRef: JSON.stringify(aiConfig),
    },
  });
  console.log('Client route configured for acme -> client-a data plane.');
  console.log('AI config (switchable):', JSON.stringify(aiConfig));
  if (aiConfig.provider === 'grok' || aiConfig.provider === 'openai') {
    console.log('  -> Automatic SOP polishing with AI ENABLED. Set AI_PROVIDER=stub to disable.');
  } else {
    console.log('  -> Using stub (heuristic polish). To enable Grok: AI_PROVIDER=grok XAI_API_KEY=...');
  }

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
