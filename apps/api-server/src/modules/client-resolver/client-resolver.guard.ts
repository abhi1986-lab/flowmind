import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ClientResolverService } from './client-resolver.service';
import type { JwtPayload, AccessScope } from '@flowmind/shared-types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  accessScope?: AccessScope;
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
    const resolved = await this.clientResolver.resolveFromRequest(req);

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
    const scope = this.clientResolver.buildAccessScope({
      actorUserId: user.sub,
      clientId: resolved.clientId,
      slug: resolved.slug,
      role: user.role,
      permissions: user.permissions || [],
      route: resolved.route,
    });

    req.accessScope = scope;

    return true;
  }
}
