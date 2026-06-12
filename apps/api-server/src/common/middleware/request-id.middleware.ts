import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Ensures every request has a stable x-request-id for logs, errors, and audit.
 * Attaches it to res.locals and response header.
 */
export function RequestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const existing =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-requestid'] as string);
  const requestId = existing || randomUUID();

  // Attach for downstream (interceptors, services, filters)
  (req as Request & { requestId?: string }).requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}
