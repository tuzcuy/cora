import { describe, it, expect } from 'vitest';
import { validateEnv } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://cora:pw@localhost:5432/cora_dev',
  JWT_ACCESS_SECRET: '0123456789abcdef',
  JWT_REFRESH_SECRET: '0123456789abcdef',
};

describe('validateEnv', () => {
  it('accepts valid env and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SECURE).toBe(false);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
  });

  it('coerces API_PORT and boolean-ish COOKIE_SECURE', () => {
    const env = validateEnv({ ...base, API_PORT: '4000', COOKIE_SECURE: 'true' });
    expect(env.API_PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      validateEnv({
        JWT_ACCESS_SECRET: base.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: base.JWT_REFRESH_SECRET,
      }),
    ).toThrow(/ortam değişkenleri/i);
  });

  it('throws on a too-short JWT secret', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow();
  });
});
