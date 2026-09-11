process.env.ALLOW_DEV_CLIENT_HEADER = 'true';
process.env.CLIENT_A_DATABASE_URL =
  process.env.CLIENT_A_DATABASE_URL ||
  'postgresql://client_a:client_a_dev@localhost:5433/client_a_db';

import { Test, TestingModule } from '@nestjs/testing';
import { ClientResolverService } from './client-resolver.service';
import { ControlPrismaService } from '../../common/prisma/control-prisma.service';
import { SecretRefsService } from '../../common/secrets/secret-refs.service';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

describe('ClientResolverService', () => {
  let service: ClientResolverService;

  const mockControlPrisma = {
    client: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientResolverService,
        { provide: ControlPrismaService, useValue: mockControlPrisma },
        SecretRefsService,
      ],
    }).compile();

    service = module.get<ClientResolverService>(ClientResolverService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveFromRequest', () => {
    const mockRequest = (headers: Record<string, string> = {}, hostname?: string) => ({
      headers,
      hostname,
    } as any);

    it('should resolve client from X-Client-Id header in dev mode', async () => {
      const req = mockRequest({ 'x-client-id': 'acme' });
      mockControlPrisma.client.findUnique.mockResolvedValue({
        id: 'client-123',
        slug: 'acme',
        status: 'active',
        routes: [{ id: 'route-1', dbConnectionRef: 'client-a-db' }],
      });

      const result = await service.resolveFromRequest(req);
      expect(result.clientId).toBe('client-123');
      expect(result.slug).toBe('acme');
      expect(result.route.dbConnectionRef).toBe('client-a-db');
      expect(mockControlPrisma.client.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acme' },
        include: { routes: true },
      });
    });

    it('should throw BadRequestException when no client can be resolved', async () => {
      const req = mockRequest({}); // no header, no subdomain
      await expect(service.resolveFromRequest(req)).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when client not found in DB', async () => {
      const req = mockRequest({ 'x-client-id': 'nonexistent' });
      mockControlPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.resolveFromRequest(req)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when client is not active', async () => {
      const req = mockRequest({ 'x-client-id': 'acme' });
      mockControlPrisma.client.findUnique.mockResolvedValue({
        id: 'client-123',
        slug: 'acme',
        status: 'suspended',
        routes: [{}],
      });
      await expect(service.resolveFromRequest(req)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when no route is configured', async () => {
      const req = mockRequest({ 'x-client-id': 'acme' });
      mockControlPrisma.client.findUnique.mockResolvedValue({
        id: 'client-123',
        slug: 'acme',
        status: 'active',
        routes: [],
      });
      await expect(service.resolveFromRequest(req)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('buildAccessScope', () => {
    it('should resolve db ref and ai ref via SecretRefsService', () => {
      const params = {
        actorUserId: 'user-1',
        clientId: 'client-123',
        slug: 'acme',
        role: 'CONTRIBUTOR',
        permissions: ['RECORD_WORKFLOW'],
        route: {
          dbConnectionRef: 'client-a-db',
          s3BucketRef: 'bucket',
          vectorNamespace: 'ns',
          aiConfigRef: 'client-a-ai',
        },
      };

      const scope = service.buildAccessScope(params);
      expect(scope.actorUserId).toBe('user-1');
      expect(scope.clientId).toBe('client-123');
      expect(scope.clientDbUrl).toMatch(/^postgresql:\/\//);
      expect(scope.storageBucket).toBe('bucket');
      expect(scope.aiConfig).toHaveProperty('provider');
    });

    it('should reject inline postgres URLs stored as db_connection_ref', () => {
      const params = {
        actorUserId: 'user-1',
        clientId: 'client-123',
        slug: 'acme',
        role: 'CONTRIBUTOR',
        permissions: [],
        route: {
          dbConnectionRef: 'postgresql://user:pass@host:5432/db',
          s3BucketRef: '',
          vectorNamespace: '',
          aiConfigRef: 'client-a-ai',
        },
      };

      expect(() => service.buildAccessScope(params)).toThrow(ServiceUnavailableException);
    });

    it('should reject inline JSON ai_config_ref (keys must not live in control DB)', () => {
      const params = {
        actorUserId: 'user-1',
        clientId: 'client-123',
        slug: 'acme',
        role: 'CONTRIBUTOR',
        permissions: [],
        route: {
          dbConnectionRef: 'client-a-db',
          s3BucketRef: '',
          vectorNamespace: '',
          aiConfigRef: JSON.stringify({ provider: 'grok', apiKey: 'xai-secret' }),
        },
      };

      expect(() => service.buildAccessScope(params)).toThrow(ServiceUnavailableException);
    });
  });
});
