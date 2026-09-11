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
   * Gate 0.4: JWT client_id ALWAYS comes from the live control-plane Client row
   * (no hardcoded UUID that can drift from / bypass resolver match).
   */
  async login(email: string, password: string, _clientSlugFromBody?: string) {
    void _clientSlugFromBody;

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
      },
    };

    const demo = demoUsers[email.toLowerCase()];
    if (!demo || password !== demo.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const clientSlug = demo.clientSlug;

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
      sub: `demo-user-${email}`,
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
