import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientResolverService } from '../client-resolver/client-resolver.service';
import { JwtPayload, Role, PERMISSIONS } from '@flowmind/shared-types';
import { Request } from 'express';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly clientResolver: ClientResolverService,
  ) {}

  /**
   * MVP Login
   *
   * For foundation: supports the seeded "acme" client with a demo contributor.
   * Real implementation (next phase):
   *   - Use resolved client route to open per-client PrismaClient
   *   - Lookup user by email inside client DB
   *   - Verify password hash stored in client DB
   *   - Return token with that user's actual role/permissions from client DB
   *
   * Login can be called with client context already resolved from subdomain/header.
   */
  async login(email: string, password: string, _clientSlugFromBody?: string) {
    void _clientSlugFromBody; // mark as used for lint (future real lookup uses it)
    // We use a dummy request-like object so resolver can extract slug from header or we pass it
    // In practice, the HTTP request context is used by the resolver in guard, but for login we allow explicit or dev header.

    // For simplicity in MVP foundation, hardcode the acme client for demo users.
    // Any real user provisioning happens inside the client DB.
    const demoUsers: Record<
      string,
      { password: string; role: Role; clientSlug: string }
    > = {
      'contributor@acme.test': {
        password: 'demo123',
        role: 'CONTRIBUTOR',
        clientSlug: 'acme',
      },
      'reviewer@acme.test': {
        password: 'demo123',
        role: 'REVIEWER',
        clientSlug: 'acme',
      },
      'admin@acme.test': {
        password: 'demo123',
        role: 'CLIENT_ADMIN',
        clientSlug: 'acme',
      },
      'platform@flowmind.internal': {
        password: 'ChangeMe123!',
        role: 'CLIENT_ADMIN',
        clientSlug: 'acme',
      }, // demo only
    };

    const demo = demoUsers[email.toLowerCase()];
    if (!demo || password !== demo.password) {
      // In real: would also try client DB lookup here
      throw new UnauthorizedException('Invalid credentials');
    }

    const clientSlug = demo.clientSlug;

    // We still want to go through resolver to prove the route exists and get metadata (even for login)
    // Simulate minimal request for resolver
    const fakeReq = {
      headers: {
        host: `${clientSlug}.localhost`,
        'x-client-id': clientSlug,
      },
    } as unknown as Request;

    const resolved = await this.clientResolver.resolveFromRequest(fakeReq);

    if (resolved.slug !== clientSlug) {
      throw new UnauthorizedException('Client routing mismatch during login');
    }

    const permissions = PERMISSIONS[demo.role] || [];

    const payload: JwtPayload = {
      sub: `demo-user-${email}`, // In real: the real user UUID from client DB
      client_id: resolved.clientId,
      email,
      role: demo.role,
      permissions,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: payload.sub,
        email,
        role: demo.role,
        clientId: resolved.clientId,
        clientSlug: resolved.slug,
        permissions,
      },
    };
  }

  /**
   * For /auth/me - returns the claims from validated token.
   */
  getProfile(user: JwtPayload) {
    return {
      id: user.sub,
      email: user.email,
      role: user.role,
      clientId: user.client_id,
      permissions: user.permissions,
    };
  }
}
