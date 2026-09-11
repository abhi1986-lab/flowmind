import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ClientResolverGuard } from './client-resolver.guard';
import { ClientResolverService } from './client-resolver.service';
import { ClientPrismaFactory } from '../../common/prisma/client-prisma.factory';

describe('ClientResolverGuard', () => {
  const mockResolver = {
    resolveFromRequest: jest.fn(),
    buildAccessScope: jest.fn(),
  };
  const mockFactory = {
    getPrismaClient: jest.fn().mockReturnValue({ tag: 'client-prisma' }),
  };
  const reflector = {} as any;

  let guard: ClientResolverGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ClientResolverGuard(
      mockResolver as unknown as ClientResolverService,
      reflector,
      mockFactory as unknown as ClientPrismaFactory,
    );
  });

  const ctx = (req: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    }) as any;

  it('rejects when user/client_id missing', async () => {
    await expect(guard.canActivate(ctx({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects client_id mismatch (isolation hard check)', async () => {
    mockResolver.resolveFromRequest.mockResolvedValue({
      clientId: 'live-uuid',
      slug: 'acme',
      route: { dbConnectionRef: 'client-a-db' },
    });
    const req = {
      user: { sub: 'u1', client_id: 'other-uuid', role: 'CONTRIBUTOR', permissions: [] },
      headers: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches scope + clientPrisma using resolved DB URL (not raw ref)', async () => {
    mockResolver.resolveFromRequest.mockResolvedValue({
      clientId: 'live-uuid',
      slug: 'acme',
      route: {
        dbConnectionRef: 'client-a-db',
        s3BucketRef: 'b',
        vectorNamespace: 'ns',
        aiConfigRef: 'client-a-ai',
      },
    });
    mockResolver.buildAccessScope.mockReturnValue({
      actorUserId: 'u1',
      clientId: 'live-uuid',
      clientDbUrl: 'postgresql://resolved/db',
      storageBucket: 'b',
      vectorNamespace: 'ns',
      aiConfig: { provider: 'stub' },
    });

    const req: any = {
      user: {
        sub: 'u1',
        client_id: 'live-uuid',
        role: 'CONTRIBUTOR',
        permissions: [],
      },
      headers: {},
    };

    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(mockFactory.getPrismaClient).toHaveBeenCalledWith(
      'postgresql://resolved/db',
    );
    expect(mockFactory.getPrismaClient).not.toHaveBeenCalledWith('client-a-db');
    expect(req.clientPrisma).toEqual({ tag: 'client-prisma' });
    expect(req.accessScope.clientDbUrl).toBe('postgresql://resolved/db');
  });
});
