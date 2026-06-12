import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Per-client PrismaClient factory for the Client Data Plane.
 * Uses the dbConnectionRef from ClientRoute to connect to the correct isolated client DB.
 * Leverages the same adapter pattern as ControlPrismaService.
 * This is the core of "Client Data Plane" isolation.
 */
@Injectable()
export class ClientPrismaFactory {
  private readonly cache = new Map<string, PrismaClient>();

  getPrismaClient(dbUrl: string): PrismaClient {
    if (!this.cache.has(dbUrl)) {
      const pool = new Pool({ connectionString: dbUrl });
      const adapter = new PrismaPg(pool);
      const client = new PrismaClient({
        adapter,
        log:
          process.env.NODE_ENV === 'development'
            ? ['error', 'warn']
            : ['error'],
      });
      this.cache.set(dbUrl, client);
    }
    return this.cache.get(dbUrl)!;
  }
}
