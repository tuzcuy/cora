import { test, expect, devices, type Page } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * Mobile pass: every main screen has to be usable on a phone — navigation
 * reachable, no horizontal page overflow, and the core actions still visible.
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-mobile.json';

test.use({ ...devices['Pixel 7'] });

/** The page itself must never scroll sideways; wide tables scroll inside. */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  // <main> is the scroll container, so checking the document alone misses a
  // card that stretches the column.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector('main');
    return {
      doc: { scroll: doc.scrollWidth, client: doc.clientWidth },
      main: main ? { scroll: main.scrollWidth, client: main.clientWidth } : null,
    };
  });
  expect(overflow.doc.scroll, `${label}: sayfa yatay taşıyor`).toBeLessThanOrEqual(overflow.doc.client + 2);
  if (overflow.main) {
    expect(overflow.main.scroll, `${label}: içerik yatay taşıyor`).toBeLessThanOrEqual(overflow.main.client + 2);
  }
}

test.describe.configure({ mode: 'serial' });

test('mobil oturum', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Mobil kullanım', () => {
  test.use({ storageState: AUTH_STATE });

  test('menü hamburgerden açılıyor ve gezinme çalışıyor', async ({ page }) => {
    test.slow();
    await page.goto('/dashboard/');
    await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page, 'Panel');
    await page.screenshot({ path: `${SHOTS}/mobile-01-dashboard.png`, fullPage: true });

    await page.getByTestId('open-nav').click();
    const drawer = page.getByTestId('mobile-nav');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/mobile-02-menu.png` });

    await drawer.getByRole('link', { name: 'Ürünler' }).click();
    await page.waitForURL(/\/products/);
    await expect(page.getByRole('heading', { name: 'Ürünler' })).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page, 'Ürünler');
  });

  test('ana ekranlar telefonda yatay taşmadan açılıyor', async ({ page }) => {
    test.slow();
    const screens: [string, string][] = [
      ['/quotes/', 'Teklifler'],
      ['/orders/', 'Siparişler'],
      ['/partners/', 'Cariler'],
      ['/stock/', 'Stok'],
      ['/warehouse/', 'Depo'],
      ['/shipments/', 'Sevkiyat'],
      ['/edocs/', 'e-Belgeler'],
      ['/pricing/', 'Fiyat listeleri'],
      ['/reports/', 'Raporlar'],
      ['/settings/', 'Ayarlar'],
    ];
    for (const [path, heading] of screens) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: false }).first()).toBeVisible({ timeout: 60_000 });
      await expectNoHorizontalOverflow(page, heading);
    }
    await page.screenshot({ path: `${SHOTS}/mobile-03-stock.png`, fullPage: true });
  });

  test('teklif editörü telefonda kullanılabiliyor', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/new/');
    await expect(page.getByTestId('document-editor')).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page, 'Teklif editörü');

    await page.getByTestId('partner-search').fill('otel');
    await expect(page.locator('ul[role="listbox"] li[role="option"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('partner-search').press('Enter');

    await page.getByTestId('line-search').fill('bardak');
    await expect(page.getByTestId('line-search-results').locator('li[role="option"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('line-search').press('Enter');
    await expect(page.locator('[data-testid="lines-table"] tbody tr[data-row]')).toHaveCount(1);

    // the totals panel stacks under the lines instead of disappearing
    await expect(page.getByTestId('totals')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'Teklif editörü (satırlı)');
    await page.screenshot({ path: `${SHOTS}/mobile-04-quote-editor.png`, fullPage: true });
  });

  test('depo toplama paneli telefonda açılıyor', async ({ page }) => {
    test.slow();
    await page.goto('/warehouse/');
    await expect(page.getByRole('heading', { name: 'Depo' })).toBeVisible({ timeout: 60_000 });
    const card = page.getByTestId('board-card').first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await expect(page.getByTestId('picking-panel')).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page, 'Toplama paneli');
      await page.screenshot({ path: `${SHOTS}/mobile-05-picking.png`, fullPage: true });
    }
  });
});
