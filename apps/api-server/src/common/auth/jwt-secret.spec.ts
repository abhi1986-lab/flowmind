import { getJwtSecret, JWT_DEV_FALLBACK_SECRET } from './jwt-secret';

describe('getJwtSecret', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  it('returns JWT_SECRET from env when set', () => {
    process.env.JWT_SECRET = 'from-env';
    process.env.NODE_ENV = 'production';
    expect(getJwtSecret()).toBe('from-env');
  });

  it('allows development fallback when unset', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'development';
    expect(getJwtSecret()).toBe(JWT_DEV_FALLBACK_SECRET);
  });

  it('fails fast in production when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is required/);
  });
});
