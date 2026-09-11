import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaClient } from '@prisma/client-data';
import { ClientResolverService } from './client-resolver.service';
import { ClientPrismaFactory } from '../../common/prisma/client-prisma.factory';
import type { JwtPayload, AccessScope } from '@flowmind/shared-types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  accessScope?: AccessScope;
  /** Per-client data-plane Prisma (ops models only; from @prisma/client-data). */
  clientPrisma?: PrismaClient;
}

/**
 * ClientResolverGuard
 *
 * MUST run after authentication (AuthGuard).
 *
 * Responsibilities (per architecture):
 * 1. Resolve client from host/header using ClientResolverService.
 * 2. Validate that JWT payload.client_id EXACTLY matches the resolved client.
 * 3. Attach fully validated AccessScope to request.
 * 4. Resolve db_connection_ref → runtime URL via SecretRefsService, then open client Prisma.
 */
@Injectable()
export class ClientResolverGuard implements CanActivate {
  constructor(
    private readonly clientResolver: ClientResolverService,
    private readonly reflector: Reflector,
    private readonly clientPrismaFactory: ClientPrismaFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const user = req.user;
    if (!user || !user.sub || !user.client_id) {
      throw new UnauthorizedException(
        'Authenticated user with client claim required.',
      );
    }

    let clientResolver = this.clientResolver;
    let prismaFactory = this.clientPrismaFactory;
    if (!clientResolver || !prismaFactory) {
      // Runtime fallback for tsx direct run (DI not fully wired in some setups)
      // @ts-ignore
      const resolverMod = require('./client-resolver.service');
      // @ts-ignore
      const prismaMod = require('../../common/prisma/client-prisma.factory');
      // @ts-ignore
      const controlMod = require('../../common/prisma/control-prisma.service');
      // @ts-ignore
      const secretsMod = require('../../common/secrets/secret-refs.service');
      const ControlPrismaService = controlMod.ControlPrismaService;
      const ClientResolverService = resolverMod.ClientResolverService;
      const ClientPrismaFactory = prismaMod.ClientPrismaFactory;
      const SecretRefsService = secretsMod.SecretRefsService;
      const controlPrisma = new ControlPrismaService();
      const secretRefs = new SecretRefsService();
      clientResolver = new ClientResolverService(controlPrisma, secretRefs);
      prismaFactory = new ClientPrismaFactory();
    }
    const resolved = await clientResolver.resolveFromRequest(req);

    // THE CRITICAL CHECK - non-negotiable per constraints
    if (
      resolved.clientId !== user.client_id &&
      resolved.slug !== user.client_id
    ) {
      throw new ForbiddenException(
        `Client isolation violation: token client_id (${user.client_id}) does not match request client (${resolved.slug}).`,
      );
    }

    const scope = clientResolver.buildAccessScope({
      actorUserId: user.sub,
      clientId: resolved.clientId,
      slug: resolved.slug,
      role: user.role,
      permissions: user.permissions || [],
      route: resolved.route,
    });

    if (!scope.clientDbUrl) {
      throw new ForbiddenException(
        `Unable to resolve client DB URL for '${resolved.slug}'.`,
      );
    }
    req.clientPrisma = prismaFactory.getPrismaClient(scope.clientDbUrl);
    req.accessScope = scope;

    return true;
  }
}
