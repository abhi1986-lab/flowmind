import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Singleton Prisma client for the shared CONTROL PLANE only.
 * Never use for client operational data.
 */
@Injectable()
export class ControlPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url =
      process.env.CONTROL_DATABASE_URL ||
      process.env.DATABASE_URL ||
      'postgresql://flowmind:flowmind_dev@localhost:5432/flowmind_control';

    // Use official Prisma driver adapter for direct Postgres (satisfies modern Prisma client engine "adapter" requirement cleanly, no accelerateUrl).
    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);

    super({ adapter, log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'] });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
