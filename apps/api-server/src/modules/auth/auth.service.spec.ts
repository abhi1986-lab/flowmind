import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ClientResolverService } from '../client-resolver/client-resolver.service';
import { JwtPayload } from '@flowmind/shared-types';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock-token'),
          },
        },
        {
          provide: ClientResolverService,
          useValue: {},
        },
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

      expect(result).toHaveProperty('accessToken', 'mock-token');
      expect(result.user).toMatchObject({
        email: 'admin@acme.test',
        role: 'CLIENT_ADMIN',
        clientSlug: 'acme',
      });
      expect(jwtService.signAsync).toHaveBeenCalled();
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
  });

  describe('getProfile', () => {
    it('should return profile info from payload', () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        email: 'test@test.com',
        role: 'CONTRIBUTOR',
        client_id: 'client-123',
        permissions: ['CAP_SESSIONS_VIEW'],
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
