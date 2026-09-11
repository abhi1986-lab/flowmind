import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ControlPrismaService } from '../../common/prisma/control-prisma.service';
import { JwtPayload, Role, PERMISSIONS } from '@flowmind/shared-types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(ControlPrismaService)
    private readonly controlPrisma: ControlPrismaService,
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
   *
   * Gate 0.4: JWT client_id ALWAYS comes from the live control-plane Client row
   * (no hardcoded UUID that can drift from / bypass resolver match).
   */
  async login(email: string, password: string, _clientSlugFromBody?: string) {
    void _clientSlugFromBody; // mark as used for lint (future real lookup uses it)

    // For simplicity in MVP foundation, hardcode the acme *demo users* only.
    // Client UUID is looked up from control DB — never hardcoded.
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

    // Live control-plane lookup — JWT client_id must match what ClientResolverGuard expects.
    const client = await this.controlPrisma.client.findUnique({
      where: { slug: clientSlug },
    });
    if (!client || client.status !== 'active') {
      throw new UnauthorizedException(
        `Client '${clientSlug}' is not available for login.`,
      );
    }

    const permissions = PERMISSIONS[demo.role] || [];

    const payload: JwtPayload = {
      sub: `demo-user-${email}`, // In real: the real user UUID from client DB
      client_id: client.id,
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
        clientId: client.id,
        clientSlug: client.slug,
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
