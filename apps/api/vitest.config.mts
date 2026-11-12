import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.spec.ts'],
    // security.spec.ts talks to a real Postgres over the network.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    environment: 'node',
    // The demo database is a free-tier Postgres with ~10 connections; running
    // every DB suite in parallel exhausts the pool and fails a random file.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
