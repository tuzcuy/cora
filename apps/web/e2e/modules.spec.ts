import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * Live smoke of every module screen. Run against the deployed site:
 *   E2E_BASE_URL=https://cora.example.com E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */

/**
 * The API rate-limits login to 5 attempts per minute per IP+email
 * (LoginThrottleGuard), so logging in once per test trips 429 on the sixth.
 * Sign in once, persist the refresh cookie, and let every other test resume
 * the session through the app's own silent refresh.
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth.json';

test.describe.configure({ mode: 'serial' });

test('oturum açılır ve saklanır', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
  await page.screenshot({ path: `${SHOTS}/mod-00-login.png`, fullPage: true });
});

test.describe('modüller', () => {
  test.use({ storageState: AUTH_STATE });

  test.beforeEach(async ({ page }) => {
    test.slow();
    await page.goto('/dashboard/');
    // AuthProvider refreshes silently from the cookie on load.
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

test('panel: KPI, 18 aylık ciro grafiği, en çok satanlar, temsilciler', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible();

  // KPIs must carry real numbers, not the old formatMoney(0) placeholders.
  await expect(page.getByText('Toplam ciro')).toBeVisible({ timeout: 30_000 });
  const total = await page.getByText('Toplam ciro').locator('xpath=following-sibling::p[1]').innerText();
  expect(total).toMatch(/\d/);
  expect(total).not.toMatch(/^₺0,00$/);

  await expect(page.getByRole('heading', { name: /Aylık ciro/ })).toBeVisible();
  // 18 bars, one per month.
  const bars = page.locator('[role="img"][aria-label*="sipariş"]');
  await expect(bars).toHaveCount(18);

  await expect(page.getByRole('heading', { name: 'En çok satan 10 ürün' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En yüksek cirolu 10 müşteri' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Satış temsilcisi performansı' })).toBeVisible();
  // the rep table grows with the tenant; assert it is populated, not a fixed count
  expect(await page.locator('table').last().locator('tbody tr').count()).toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOTS}/mod-01-dashboard.png`, fullPage: true });
});

test('cariler: liste, arama, bölge filtresi, detay', async ({ page }) => {
  await page.goto('/partners/');
  await expect(page.getByRole('heading', { name: 'Cariler' })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d+ müşteri/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-02-partners-list.png`, fullPage: true });

  // region facet
  const belek = page.locator('aside').getByRole('button', { name: /Belek/ });
  await belek.click();
  // keepPreviousData keeps the old rows on screen while the filtered query is in
  // flight, so wait for the region column to actually turn over before asserting.
  await expect(page.locator('tbody tr td:nth-child(3)').first()).toHaveText(/Belek/, { timeout: 30_000 });
  const regions = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
  expect(new Set(regions.map((r) => r.trim())).size).toBe(1);
  await page.screenshot({ path: `${SHOTS}/mod-03-partners-region.png`, fullPage: true });

  // detail
  await rows.first().click();
  await page.waitForURL(/\/partners\/\?id=/);
  await expect(page.getByRole('heading', { name: 'Cari bilgileri' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Son belgeler' })).toBeVisible();
  await expect(page.getByText('Toplam satış (net)')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-04-partner-detail.png`, fullPage: true });
});

test('teklifler: liste ve durum rozetleri', async ({ page }) => {
  await page.goto('/quotes/');
  await expect(page.getByRole('heading', { name: 'Teklifler' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d{1,3}(\.\d{3})* belge/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Onaylandı/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-05-quotes.png`, fullPage: true });
});

test('siparişler: liste, durum filtresi, belge detayı', async ({ page }) => {
  await page.goto('/orders/');
  await expect(page.getByRole('heading', { name: 'Siparişler' })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d{1,3}(\.\d{3})* belge/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-06-orders.png`, fullPage: true });

  await page.getByRole('button', { name: /Tamamlandı/ }).first().click();
  await expect(rows.first()).toBeVisible();

  await rows.first().click();
  await page.waitForURL(/\/orders\/\?id=/);
  // P04: `?id=` now opens the editor (read-only detail is gone).
  await expect(page.getByTestId('document-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lines-table')).toBeVisible();
  await expect(page.getByTestId('status-stepper')).toBeVisible();
  await expect(page.getByTestId('totals')).toBeVisible();
  // admin holds cost.view, so profit must be present
  await expect(page.getByText('Toplam kâr')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-07-document-detail.png`, fullPage: true });
});

test('depo: dört kolonlu pano', async ({ page }) => {
  await page.goto('/warehouse/');
  await expect(page.getByRole('heading', { name: 'Depo' })).toBeVisible();
  for (const col of ['Bekleyen', 'Hazırlanan', 'Hazır', 'Sevk edilen']) {
    await expect(page.getByRole('heading', { name: col, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await page.screenshot({ path: `${SHOTS}/mod-08-warehouse.png`, fullPage: true });
});

test('raporlar: dört kırılım', async ({ page }) => {
  await page.goto('/reports/');
  await expect(page.getByRole('heading', { name: 'Raporlar' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/mod-09-reports-month.png`, fullPage: true });

  for (const tab of ['Ürün', 'Müşteri', 'Temsilci']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  }
  await page.screenshot({ path: `${SHOTS}/mod-10-reports-rep.png`, fullPage: true });
});

test('ayarlar: oturum ve yetkiler', async ({ page }) => {
  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Ayarlar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yetkiler' })).toBeVisible({ timeout: 30_000 });
  // cost.view appears twice (permission chip + the explanatory note), so scope
  // to the chip inside the permissions card rather than tripping strict mode.
  await expect(page.locator('span.font-mono').filter({ hasText: 'cost.view' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mod-11-settings.png`, fullPage: true });
});

test('hiçbir sayfada "Yakında" kartı kalmadı', async ({ page }) => {
  for (const path of ['/dashboard/', '/products/', '/partners/', '/quotes/', '/orders/', '/warehouse/', '/reports/', '/shipments/', '/settings/']) {
    await page.goto(path);
    await expect(page.getByText('Yakında', { exact: true })).toHaveCount(0);
  }
});
});
