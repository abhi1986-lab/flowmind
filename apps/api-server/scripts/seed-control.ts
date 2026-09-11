/**
 * Seed script for FlowMind AI Control Plane (MVP)
 *
 * Gate 0.2: ClientRoute stores SECRET REFS only:
 *  - db_connection_ref = "client-a-db" → CLIENT_A_DATABASE_URL at runtime
 *  - ai_config_ref     = "client-a-ai" → CLIENT_A_AI_CONFIG / AI_* env
 */

import 'dotenv/config';
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

async function main() {
  console.log('Seeding FlowMind control plane...');

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
