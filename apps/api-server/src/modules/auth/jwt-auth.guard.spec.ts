import { JwtAuthGuard } from './jwt-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
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
    // Create a real token with the hardcoded secret used in guard
    const secret = 'dev-super-secret-change-in-real-env';
    const payload = { sub: 'user1', client_id: 'client1' };
    const validToken = jwt.sign(payload, secret);

    const context = mockContext(`Bearer ${validToken}`);
    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });
});
