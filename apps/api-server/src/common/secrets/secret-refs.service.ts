import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Resolves ClientRoute secret refs to runtime values.
 *
 * Control plane stores refs only (e.g. `client-a-db`, `client-a-ai`) — never
 * live Postgres URLs or AI API keys. Resolution order:
 *   1. SECRET_REFS_JSON map (optional JSON object of ref → value)
 *   2. Conventional env vars derived from the ref
 *      - `client-a-db` → CLIENT_A_DATABASE_URL
 *      - `client-a-ai` → CLIENT_A_AI_CONFIG (JSON) or shared AI_* / XAI_* env
 *   3. SECRET_REF_<NORMALIZED> fallback (e.g. SECRET_REF_CLIENT_A_DB)
 */
@Injectable()
export class SecretRefsService {
  /**
   * Resolve a DB connection ref to a Postgres URL.
   * Rejects values that look like inline connection strings so mis-seeded
   * control rows fail loudly instead of silently storing secrets.
   */
  resolveDbUrl(ref: string): string {
    const trimmed = (ref || '').trim();
    if (!trimmed) {
      throw new ServiceUnavailableException(
        'ClientRoute.db_connection_ref is empty; expected a secret ref.',
      );
    }
    if (looksLikeConnectionString(trimmed)) {
      throw new ServiceUnavailableException(
        `ClientRoute.db_connection_ref must be a secret ref (got a connection string). ` +
          `Store a ref like "client-a-db" and set CLIENT_A_DATABASE_URL in the environment.`,
      );
    }

    const value = this.resolveStringRef(trimmed, {
      preferredEnv: dbRefToEnvKey(trimmed),
    });
    if (!value) {
      throw new ServiceUnavailableException(
        `Secret ref '${trimmed}' could not be resolved. ` +
          `Set ${dbRefToEnvKey(trimmed)} (or SECRET_REFS_JSON["${trimmed}"]).`,
      );
    }
    return value;
  }

  /**
   * Resolve an AI config ref to a provider config object (may include apiKey from env).
   * Never reads API keys from the control DB — only from env / secrets map.
   */
  resolveAiConfig(ref?: string | null): Record<string, unknown> {
    const trimmed = (ref || '').trim();
    if (!trimmed) {
      return buildAiConfigFromSharedEnv();
    }

    // Reject inline JSON that embeds secrets (legacy seed shape).
    if (trimmed.startsWith('{')) {
      throw new ServiceUnavailableException(
        `ClientRoute.ai_config_ref must be a secret ref (got inline JSON). ` +
          `Store a ref like "client-a-ai" and set CLIENT_A_AI_CONFIG / AI_* env vars.`,
      );
    }

    const raw = this.resolveStringRef(trimmed, {
      preferredEnv: aiRefToEnvKey(trimmed),
      optional: true,
    });
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        throw new ServiceUnavailableException(
          `Secret ref '${trimmed}' resolved but is not valid JSON AI config.`,
        );
      }
    }

    // Ref present but no per-client JSON — fall back to shared AI_* env.
    return buildAiConfigFromSharedEnv();
  }

  private resolveStringRef(
    ref: string,
    opts: { preferredEnv: string; optional?: boolean },
  ): string | undefined {
    const map = loadSecretsMap();
    if (map[ref]) {
      return map[ref];
    }

    const fromPreferred = process.env[opts.preferredEnv]?.trim();
    if (fromPreferred) {
      return fromPreferred;
    }

    const fallbackKey = `SECRET_REF_${ref.replace(/-/g, '_').toUpperCase()}`;
    const fromFallback = process.env[fallbackKey]?.trim();
    if (fromFallback) {
      return fromFallback;
    }

    return undefined;
  }
}

function looksLikeConnectionString(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(value) || value.includes('://');
}

/** `client-a-db` → `CLIENT_A_DATABASE_URL` */
export function dbRefToEnvKey(ref: string): string {
  if (ref.endsWith('-db')) {
    const prefix = ref.slice(0, -3).replace(/-/g, '_').toUpperCase();
    return `${prefix}_DATABASE_URL`;
  }
  return `${ref.replace(/-/g, '_').toUpperCase()}_DATABASE_URL`;
}

/** `client-a-ai` → `CLIENT_A_AI_CONFIG` */
export function aiRefToEnvKey(ref: string): string {
  if (ref.endsWith('-ai')) {
    const prefix = ref.slice(0, -3).replace(/-/g, '_').toUpperCase();
    return `${prefix}_AI_CONFIG`;
  }
  return `${ref.replace(/-/g, '_').toUpperCase()}_AI_CONFIG`;
}

function loadSecretsMap(): Record<string, string> {
  const raw = process.env.SECRET_REFS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      return out;
    }
  } catch {
    throw new ServiceUnavailableException(
      'SECRET_REFS_JSON is set but is not valid JSON object.',
    );
  }
  return {};
}

/** Shared AI_* / XAI_* env → config object (keys never come from control DB). */
export function buildAiConfigFromSharedEnv(): Record<string, unknown> {
  const aiProvider = (process.env.AI_PROVIDER || 'stub').toLowerCase();
  const provider = ['grok', 'openai', 'ollama'].includes(aiProvider)
    ? aiProvider
    : 'stub';
  const aiModel =
    process.env.AI_MODEL ||
    (provider === 'grok'
      ? 'grok-beta'
      : provider === 'openai'
        ? 'gpt-4o-mini'
        : 'stub');

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  if (provider === 'grok') {
    apiKey = process.env.XAI_API_KEY || process.env.AI_API_KEY;
    baseURL = process.env.AI_BASE_URL;
  } else if (provider === 'openai' || provider === 'ollama') {
    apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (provider === 'ollama') {
      baseURL = process.env.AI_BASE_URL || 'http://localhost:11434/v1';
    } else {
      baseURL = process.env.AI_BASE_URL;
    }
  }

  return {
    provider,
    model: aiModel,
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  };
}
