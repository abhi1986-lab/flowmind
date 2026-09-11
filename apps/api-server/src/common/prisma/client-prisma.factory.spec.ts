jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@prisma/client-data', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({ id: 'mock-client' })),
}));

import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client-data';
import { ClientPrismaFactory } from './client-prisma.factory';

describe('ClientPrismaFactory', () => {
  it('creates and caches PrismaClient by resolved URL', () => {
    const factory = new ClientPrismaFactory();
    const a = factory.getPrismaClient('postgresql://a/db');
    const b = factory.getPrismaClient('postgresql://a/db');
    const c = factory.getPrismaClient('postgresql://b/db');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(Pool).toHaveBeenCalled();
    expect(PrismaClient).toHaveBeenCalledTimes(2);
  });
});
