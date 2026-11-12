import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. Assumes the stack is already running locally:
 *   API  http://localhost:3001  (pnpm --filter @cora/api start)
 *   WEB  http://localhost:3000  (pnpm --filter @cora/web start)
 * Credentials come from env (E2E_EMAIL / E2E_PASSWORD).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
