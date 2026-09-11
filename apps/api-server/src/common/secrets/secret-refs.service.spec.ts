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
  const prevXai = process.env.XAI_API_KEY;
  const prevOpenai = process.env.OPENAI_API_KEY;
  const prevModel = process.env.AI_MODEL;
  const prevBase = process.env.AI_BASE_URL;
  const prevSecretRef = process.env.SECRET_REF_CLIENT_A_DB;
  let service: SecretRefsService;

  beforeEach(() => {
    service = new SecretRefsService();
    process.env.CLIENT_A_DATABASE_URL =
      'postgresql://client_a:client_a_dev@localhost:5433/client_a_db';
    delete process.env.SECRET_REFS_JSON;
    delete process.env.CLIENT_A_AI_CONFIG;
    delete process.env.SECRET_REF_CLIENT_A_DB;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
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
    if (prevXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevXai;
    if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenai;
    if (prevModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevModel;
    if (prevBase === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = prevBase;
    if (prevSecretRef === undefined) delete process.env.SECRET_REF_CLIENT_A_DB;
    else process.env.SECRET_REF_CLIENT_A_DB = prevSecretRef;
  });

  it('maps client-a-db → CLIENT_A_DATABASE_URL', () => {
    expect(dbRefToEnvKey('client-a-db')).toBe('CLIENT_A_DATABASE_URL');
    expect(aiRefToEnvKey('client-a-ai')).toBe('CLIENT_A_AI_CONFIG');
    expect(dbRefToEnvKey('acme')).toBe('ACME_DATABASE_URL');
    expect(aiRefToEnvKey('acme')).toBe('ACME_AI_CONFIG');
  });

  it('resolves db ref from env', () => {
    expect(service.resolveDbUrl('client-a-db')).toMatch(/^postgresql:\/\//);
  });

  it('rejects empty db ref', () => {
    expect(() => service.resolveDbUrl('')).toThrow(ServiceUnavailableException);
  });

  it('rejects inline connection strings', () => {
    expect(() =>
      service.resolveDbUrl('postgresql://x:y@host/db'),
    ).toThrow(ServiceUnavailableException);
  });

  it('throws when db ref cannot be resolved', () => {
    delete process.env.CLIENT_A_DATABASE_URL;
    expect(() => service.resolveDbUrl('client-a-db')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('resolves via SECRET_REF_ fallback', () => {
    delete process.env.CLIENT_A_DATABASE_URL;
    process.env.SECRET_REF_CLIENT_A_DB = 'postgresql://fallback/db';
    expect(service.resolveDbUrl('client-a-db')).toBe('postgresql://fallback/db');
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

  it('returns shared env AI config when ref empty', () => {
    expect(service.resolveAiConfig(null).provider).toBe('stub');
    expect(service.resolveAiConfig(undefined).provider).toBe('stub');
  });

  it('parses CLIENT_A_AI_CONFIG JSON', () => {
    process.env.CLIENT_A_AI_CONFIG = JSON.stringify({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(service.resolveAiConfig('client-a-ai')).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
  });

  it('throws on invalid CLIENT_A_AI_CONFIG JSON', () => {
    process.env.CLIENT_A_AI_CONFIG = 'not-json';
    expect(() => service.resolveAiConfig('client-a-ai')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('resolves from SECRET_REFS_JSON when set', () => {
    process.env.SECRET_REFS_JSON = JSON.stringify({
      'client-a-db': 'postgresql://from-map/db',
    });
    expect(service.resolveDbUrl('client-a-db')).toBe('postgresql://from-map/db');
  });

  it('throws on invalid SECRET_REFS_JSON', () => {
    process.env.SECRET_REFS_JSON = '{bad';
    expect(() => service.resolveDbUrl('client-a-db')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('builds grok config from XAI_API_KEY', () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'xai-test';
    process.env.AI_BASE_URL = 'https://api.x.ai/v1';
    const cfg = service.resolveAiConfig('client-a-ai');
    expect(cfg).toMatchObject({
      provider: 'grok',
      apiKey: 'xai-test',
      baseURL: 'https://api.x.ai/v1',
    });
  });

  it('builds ollama config with default base URL', () => {
    process.env.AI_PROVIDER = 'ollama';
    const cfg = service.resolveAiConfig('client-a-ai');
    expect(cfg.provider).toBe('ollama');
    expect(cfg.baseURL).toBe('http://localhost:11434/v1');
  });
});
