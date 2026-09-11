import { JwtAuthGuard } from './jwt-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JWT_DEV_FALLBACK_SECRET } from '../../common/auth/jwt-secret';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    guard = new JwtAuthGuard();
  });

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  const mockContext = (authHeader?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: authHeader,
          },
        }),
      }),
    } as any;
  };

  it('should throw if no authorization header', () => {
    const context = mockContext();
    try {
      guard.canActivate(context);
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
    }
  });

  it('should throw if token is invalid', () => {
    const context = mockContext('Bearer badtoken');
    try {
      guard.canActivate(context);
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnauthorizedException);
    }
  });

  it('should return true and attach user for valid token', () => {
    const payload = { sub: 'user1', client_id: 'client1' };
    const validToken = jwt.sign(payload, JWT_DEV_FALLBACK_SECRET);

    const context = mockContext(`Bearer ${validToken}`);
    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should verify with JWT_SECRET from env when set', () => {
    process.env.JWT_SECRET = 'test-env-secret';
    const payload = { sub: 'user1', client_id: 'client1' };
    const validToken = jwt.sign(payload, 'test-env-secret');
    const context = mockContext(`Bearer ${validToken}`);
    expect(guard.canActivate(context)).toBe(true);
  });
});
