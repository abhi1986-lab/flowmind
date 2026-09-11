import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ControlPrismaService } from '../../common/prisma/control-prisma.service';
import { JwtPayload } from '@flowmind/shared-types';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock.jwt.token'),
  };

  const mockControlPrisma = {
    client: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'live-client-uuid-from-control',
        slug: 'acme',
        status: 'active',
      }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockControlPrisma.client.findUnique.mockResolvedValue({
      id: 'live-client-uuid-from-control',
      slug: 'acme',
      status: 'active',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ControlPrismaService, useValue: mockControlPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('should return an access token and user info for valid credentials', async () => {
      const result = await service.login('admin@acme.test', 'demo123');

      expect(result).toHaveProperty('accessToken', 'mock.jwt.token');
      expect(result.user).toMatchObject({
        email: 'admin@acme.test',
        role: 'CLIENT_ADMIN',
        clientSlug: 'acme',
        clientId: 'live-client-uuid-from-control',
      });
      expect(jwtService.signAsync).toHaveBeenCalled();
      expect(mockControlPrisma.client.findUnique).toHaveBeenCalledWith({
        where: { slug: 'acme' },
      });
    });

    it('should put live control client UUID in JWT payload (no hardcoded bypass)', async () => {
      await service.login('contributor@acme.test', 'demo123');
      const payload = mockJwtService.signAsync.mock.calls[0][0];
      expect(payload.client_id).toBe('live-client-uuid-from-control');
      expect(payload.client_id).not.toBe('82b84d1d-1708-42cf-b9af-d175c1acc84d');
    });

    it('should login with valid contributor credentials', async () => {
      const result = await service.login('contributor@acme.test', 'demo123');
      expect(result.accessToken).toBe('mock.jwt.token');
      expect(result.user.email).toBe('contributor@acme.test');
      expect(result.user.role).toBe('CONTRIBUTOR');
      expect(result.user.clientId).toBe('live-client-uuid-from-control');
    });

    it('should login with valid platform admin', async () => {
      const result = await service.login('platform@flowmind.internal', 'ChangeMe123!');
      expect(result.user.role).toBe('CLIENT_ADMIN');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      await expect(service.login('admin@acme.test', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      await expect(service.login('nonexistent@test.com', 'demo123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      await expect(
        service.login('contributor@acme.test', 'wrongpassword')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for unknown user', async () => {
      await expect(
        service.login('unknown@user.com', 'demo123')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw when control client is missing or inactive', async () => {
      mockControlPrisma.client.findUnique.mockResolvedValue(null);
      await expect(service.login('admin@acme.test', 'demo123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should include permissions in the response', async () => {
      const result = await service.login('admin@acme.test', 'demo123');
      expect(result.user.permissions).toBeDefined();
      expect(Array.isArray(result.user.permissions)).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('should return profile info from payload', () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@test.com',
        role: 'CONTRIBUTOR',
        client_id: 'client-123',
        permissions: ['CAP_SESSIONS_VIEW'] as any,
      };

      const result = service.getProfile(payload);

      expect(result).toEqual({
        id: 'user-123',
        email: 'test@test.com',
        role: 'CONTRIBUTOR',
        clientId: 'client-123',
        permissions: ['CAP_SESSIONS_VIEW'],
      });
    });
  });
});
