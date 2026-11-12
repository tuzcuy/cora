import { expect, type Page } from '@playwright/test';

export const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.local';
export const PASSWORD = process.env.E2E_PASSWORD ?? '';
export const SHOTS = process.env.E2E_SHOT_DIR ?? '../../docs/screenshots';

/**
 * Logs in, retrying once after the login rate limit window.
 *
 * The API allows five login attempts per minute per IP+email (P03). A full
 * suite run logs in once per spec file, which trips that limit and used to fail
 * whichever spec happened to be sixth. Waiting out the window is exactly what a
 * real user would do, so the test does the same instead of weakening the guard.
 */
export async function login(page: Page, attempt = 0): Promise<void> {
  await page.goto('/login/');
  // Wait for hydration before typing: the submit button is disabled until React
  // mounts (which also prevents a native pre-hydration submit leaking the
  // password into the URL). Filling before hydration would be reset by RHF.
  const submit = page.getByRole('button', { name: 'Giriş yap' });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel('E-posta').fill(EMAIL);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await submit.click();
  try {
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  } catch (e) {
    if (attempt >= 1) throw e;
    // 429 from the login throttle: wait out the window and try once more.
    await page.waitForTimeout(65_000);
    await login(page, attempt + 1);
    return;
  }
  await expect(page).toHaveURL(/\/dashboard/);
}
