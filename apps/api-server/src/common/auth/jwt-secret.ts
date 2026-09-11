/**
 * JWT signing/verify secret.
 *
 * - Always prefer process.env.JWT_SECRET
 * - Development only: allow a well-known fallback (documented in .env.example)
 * - Non-development (production, staging, etc.): fail fast if missing
 */

const DEV_FALLBACK_SECRET = 'dev-super-secret-change-in-real-env';

export function getJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (isDevLikeEnv()) {
    console.warn(
      '[jwt] JWT_SECRET not set; using development fallback. Set JWT_SECRET before any non-dev deploy.',
    );
    return DEV_FALLBACK_SECRET;
  }

  throw new Error(
    'JWT_SECRET is required when NODE_ENV is not development. ' +
      'Set JWT_SECRET in the environment (see infra/.env.example).',
  );
}

export function isDevLikeEnv(): boolean {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'dev' || nodeEnv === '';
}

/** Exported for tests that need to mint tokens matching the guard. */
export const JWT_DEV_FALLBACK_SECRET = DEV_FALLBACK_SECRET;
