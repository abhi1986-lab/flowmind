import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { ClientResolverService } from './client-resolver.service';
import { ClientPrismaFactory } from '../../common/prisma/client-prisma.factory';
import type { JwtPayload, AccessScope } from '@flowmind/shared-types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  accessScope?: AccessScope;
  clientPrisma?: PrismaClient; // per-client data plane (sessions, events, etc.)
}

/**
 * ClientResolverGuard
 *
 * MUST run after authentication (AuthGuard).
 *
 * Responsibilities (per architecture):
 * 1. Resolve client from host/header using ClientResolverService.
 * 2. Validate that JWT payload.client_id EXACTLY matches the resolved client.
 *    -> If mismatch: hard reject (this is the primary isolation enforcement).
 * 3. Attach fully validated AccessScope to request (for services + repos).
 *
 * Every controller that touches client data should use:
 * @UseGuards(AuthGuard, ClientResolverGuard, PermissionGuard?)
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

    // Resolve the client the request is trying to reach
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
      const ControlPrismaService = controlMod.ControlPrismaService;
      const ClientResolverService = resolverMod.ClientResolverService;
      const ClientPrismaFactory = prismaMod.ClientPrismaFactory;
      const controlPrisma = new ControlPrismaService();
      clientResolver = new ClientResolverService(controlPrisma);
      prismaFactory = new ClientPrismaFactory();
    }
    const resolved = await clientResolver.resolveFromRequest(req);

    // THE CRITICAL CHECK - non-negotiable per constraints
    if (
      resolved.clientId !== user.client_id &&
      resolved.slug !== user.client_id
    ) {
      // Also allow slug match if JWT stores slug instead of uuid (we will standardize on uuid client_id in token)
      throw new ForbiddenException(
        `Client isolation violation: token client_id (${user.client_id}) does not match request client (${resolved.slug}).`,
      );
    }

    // Build and attach the scope (this is what all business logic uses)
    const scope = clientResolver.buildAccessScope({
      actorUserId: user.sub,
      clientId: resolved.clientId,
      slug: resolved.slug,
      role: user.role,
      permissions: user.permissions || [],
      route: resolved.route,
    });

    // Attach client data plane PrismaClient (key for Client Data Plane isolation + Session/Event backbone)
    req.clientPrisma = prismaFactory.getPrismaClient(
      resolved.route.dbConnectionRef,
    );
    req.accessScope = scope;

    return true;
  }
}
