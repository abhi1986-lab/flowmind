process.env.ALLOW_DEV_CLIENT_HEADER = 'true';

import { Test, TestingModule } from '@nestjs/testing';
import { ClientResolverService } from './client-resolver.service';
import { ControlPrismaService } from '../../common/prisma/control-prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('ClientResolverService', () => {
  let service: ClientResolverService;
  let controlPrisma: ControlPrismaService;

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
      ],
    }).compile();

    service = module.get<ClientResolverService>(ClientResolverService);
    controlPrisma = module.get<ControlPrismaService>(ControlPrismaService);
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
        routes: [{ id: 'route-1', dbConnectionRef: 'mock' }],
      });

      const result = await service.resolveFromRequest(req);
      expect(result.clientId).toBe('client-123');
      expect(result.slug).toBe('acme');
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
    it('should build access scope with parsed aiConfig', () => {
      const params = {
        actorUserId: 'user-1',
        clientId: 'client-123',
        slug: 'acme',
        role: 'CONTRIBUTOR',
        permissions: ['RECORD_WORKFLOW'],
        route: {
          dbConnectionRef: 'postgresql://...',
          s3BucketRef: 'bucket',
          vectorNamespace: 'ns',
          aiConfigRef: JSON.stringify({ provider: 'grok' }),
        },
      };

      const scope = service.buildAccessScope(params);
      expect(scope.actorUserId).toBe('user-1');
      expect(scope.clientId).toBe('client-123');
      expect(scope.aiConfig).toEqual({ provider: 'grok' });
    });

    it('should handle invalid aiConfigRef gracefully', () => {
      const params = {
        actorUserId: 'user-1',
        clientId: 'client-123',
        slug: 'acme',
        role: 'CONTRIBUTOR',
        permissions: [],
        route: {
          dbConnectionRef: '',
          s3BucketRef: '',
          vectorNamespace: '',
          aiConfigRef: 'not-valid-json',
        },
      };

      const scope = service.buildAccessScope(params);
      expect(scope.aiConfig).toEqual({});
    });
  });
});
