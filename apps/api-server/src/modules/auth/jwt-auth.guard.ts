import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../client-resolver/client-resolver.guard';
import type { JwtPayload } from '@flowmind/shared-types';

// Use jsonwebtoken directly to avoid Nest JwtService DI issues when running via tsx in this monorepo setup.
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.substring(7);

    try {
      const payload = jwt.verify(token, 'dev-super-secret-change-in-real-env') as JwtPayload;
      req.user = payload;
      return true;
    } catch (err) {
      console.error('[JwtAuthGuard] verify failed:', (err as Error)?.message || err);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
