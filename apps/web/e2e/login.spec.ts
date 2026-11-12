import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD } from './helpers';


test('login → dashboard', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  await page.screenshot({ path: '../../docs/screenshots/01-login.png', fullPage: true });

  await page.getByLabel('E-posta').fill(EMAIL);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();

  await page.waitForURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible();
  await expect(page.getByText('Ürünler')).toBeVisible(); // sidebar nav rendered
  await page.screenshot({ path: '../../docs/screenshots/02-dashboard.png', fullPage: true });
});

test('unauthenticated dashboard redirects to login', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/dashboard');
  await page.waitForURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
});
