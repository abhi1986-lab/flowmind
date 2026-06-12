import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { ControlPrismaService } from '../../common/prisma/control-prisma.service';
import type { AccessScope, Role, Permission } from '@flowmind/shared-types';

interface ClientRouteRef {
  dbConnectionRef: string;
  s3BucketRef: string;
  vectorNamespace: string;
  aiConfigRef?: string;
}

const DEV_HEADER_ENABLED = process.env.ALLOW_DEV_CLIENT_HEADER === 'true';

@Injectable()
export class ClientResolverService {
  constructor(private readonly controlPrisma: ControlPrismaService) {}

  /**
   * Resolves the client identity for the current request.
   * Rules (non-negotiable):
   *  - Prefer subdomain: <slug>.flowmind.ai or <slug>.localhost
   *  - Fallback / dev: X-Client-Id header (only if ALLOW_DEV_CLIENT_HEADER=true)
   *  - The resolved slug MUST match the client_id claim inside the validated JWT (done in guard).
   *
   * Returns the client + route metadata needed to select data plane.
   */
  async resolveFromRequest(req: Request): Promise<{
    clientId: string;
    slug: string;
    route: ClientRouteRef;
  }> {
    const host = (req.headers.host || req.hostname || '').toLowerCase();
    let slug: string | null = null;

    // 1. Subdomain extraction (preferred for prod-like)
    // Examples:
    //   acme.flowmind.ai -> acme
    //   acme.localhost:4000 -> acme
    //   client-a.flowmind.test -> client-a
    const subdomainMatch = host.match(
      /^([a-z0-9-]+)\.(flowmind\.|localhost|127\.0\.0\.1|local)/i,
    );
    if (subdomainMatch && subdomainMatch[1]) {
      slug = subdomainMatch[1];
    }

    // 2. Dev override header (explicitly enabled only in non-prod)
    if (!slug && DEV_HEADER_ENABLED) {
      const headerSlug =
        (req.headers['x-client-id'] as string) ||
        (req.headers['x-clientid'] as string);
      if (headerSlug) {
        slug = headerSlug.toLowerCase().trim();
      }
    }

    if (!slug) {
      throw new BadRequestException(
        'Unable to resolve client. Use a client subdomain (e.g. acme.localhost) or X-Client-Id header in dev.',
      );
    }

    // Load from control plane (real DB-backed resolution now that seed has created the acme record)
    let client: {
      id: string;
      slug: string;
      status: string;
      routes?: any[];
    } | null = null;
    try {
      client = await this.controlPrisma.client.findUnique({
        where: { slug },
        include: { routes: true },
      });
    } catch {
      // Surface as not-found 403 (prisma connection/query errors would otherwise become 500)
      throw new ForbiddenException(`Client '${slug}' not found or inactive.`);
    }

    if (!client || client.status !== 'active') {
      throw new ForbiddenException(`Client '${slug}' not found or inactive.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const route = client.routes?.[0];
    if (!route) {
      throw new ForbiddenException(
        `No data plane route configured for client '${slug}'.`,
      );
    }

    return {
      clientId: client.id,
      slug: client.slug,
      route: route as ClientRouteRef,
    };
  }

  /**
   * Builds the AccessScope object after full validation (auth + client match).
   * This object is what all downstream services/repositories receive.
   */
  buildAccessScope(params: {
    actorUserId: string;
    clientId: string;
    slug: string;
    role: string;
    permissions: string[];
    route: ClientRouteRef;
  }): AccessScope {
    const { actorUserId, clientId, role, permissions, route } = params;

    // Parse aiConfigRef safely
    let aiConfig: Record<string, unknown> = {};
    try {
      const parsed: unknown = route.aiConfigRef
        ? JSON.parse(route.aiConfigRef)
        : {};
      aiConfig = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<
        string,
        unknown
      >;
    } catch {
      aiConfig = {};
    }

    return {
      actorUserId,
      clientId,
      role: role as Role,
      permissions: permissions as Permission[],
      clientDbUrl: route.dbConnectionRef,
      storageBucket: route.s3BucketRef,
      vectorNamespace: route.vectorNamespace,
      aiConfig,
    };
  }
}
