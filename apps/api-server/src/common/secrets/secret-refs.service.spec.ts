import {
  SecretRefsService,
  dbRefToEnvKey,
  aiRefToEnvKey,
} from './secret-refs.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('SecretRefsService', () => {
  const prevDb = process.env.CLIENT_A_DATABASE_URL;
  const prevMap = process.env.SECRET_REFS_JSON;
  const prevAi = process.env.CLIENT_A_AI_CONFIG;
  const prevProvider = process.env.AI_PROVIDER;
  let service: SecretRefsService;

  beforeEach(() => {
    service = new SecretRefsService();
    process.env.CLIENT_A_DATABASE_URL =
      'postgresql://client_a:client_a_dev@localhost:5433/client_a_db';
    delete process.env.SECRET_REFS_JSON;
    delete process.env.CLIENT_A_AI_CONFIG;
    process.env.AI_PROVIDER = 'stub';
  });

  afterEach(() => {
    if (prevDb === undefined) delete process.env.CLIENT_A_DATABASE_URL;
    else process.env.CLIENT_A_DATABASE_URL = prevDb;
    if (prevMap === undefined) delete process.env.SECRET_REFS_JSON;
    else process.env.SECRET_REFS_JSON = prevMap;
    if (prevAi === undefined) delete process.env.CLIENT_A_AI_CONFIG;
    else process.env.CLIENT_A_AI_CONFIG = prevAi;
    if (prevProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevProvider;
  });

  it('maps client-a-db → CLIENT_A_DATABASE_URL', () => {
    expect(dbRefToEnvKey('client-a-db')).toBe('CLIENT_A_DATABASE_URL');
    expect(aiRefToEnvKey('client-a-ai')).toBe('CLIENT_A_AI_CONFIG');
  });

  it('resolves db ref from env', () => {
    expect(service.resolveDbUrl('client-a-db')).toMatch(/^postgresql:\/\//);
  });

  it('rejects inline connection strings', () => {
    expect(() =>
      service.resolveDbUrl('postgresql://x:y@host/db'),
    ).toThrow(ServiceUnavailableException);
  });

  it('rejects inline AI JSON with secrets', () => {
    expect(() =>
      service.resolveAiConfig('{"provider":"grok","apiKey":"x"}'),
    ).toThrow(ServiceUnavailableException);
  });

  it('resolves AI from shared env when per-client JSON absent', () => {
    const cfg = service.resolveAiConfig('client-a-ai');
    expect(cfg.provider).toBe('stub');
  });

  it('resolves from SECRET_REFS_JSON when set', () => {
    process.env.SECRET_REFS_JSON = JSON.stringify({
      'client-a-db': 'postgresql://from-map/db',
    });
    expect(service.resolveDbUrl('client-a-db')).toBe('postgresql://from-map/db');
  });
});
