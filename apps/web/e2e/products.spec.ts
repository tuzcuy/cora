import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * Products module end-to-end: login -> list -> search -> brand facet -> detail.
 *
 * Runs against whatever E2E_BASE_URL points at, so the same spec covers local
 * and the live site:
 *   E2E_BASE_URL=https://cora.example.com E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */

test.describe('Ürünler modülü', () => {
  test('giriş → ürünler → arama → marka filtresi → detay', async ({ page }) => {
    test.slow(); // free-tier API can cold-start

    await login(page);
    await page.screenshot({ path: `${SHOTS}/prod-10-dashboard.png`, fullPage: true });

    // --- list -------------------------------------------------------------
    await page.goto('/products/');
    await expect(page.getByRole('heading', { name: 'Ürünler' })).toBeVisible();

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const totalText = await page.getByText(/ürün$/).first().textContent();
    expect(totalText).toMatch(/\d/);
    await page.screenshot({ path: `${SHOTS}/prod-11-products-list.png`, fullPage: true });

    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(0);

    // --- search "bardak" --------------------------------------------------
    await page.getByLabel('Ürün ara').fill('bardak');
    // Debounce is 250ms; wait for the count line to settle.
    await expect(page.getByText(/güncelleniyor/)).toBeHidden({ timeout: 30_000 });
    await expect(rows.first()).toBeVisible();

    // Every visible row should be a glass of some kind.
    const names = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /barda[kğ]/i.test(n)).length).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/prod-12-search-bardak.png`, fullPage: true });

    // --- brand facet ------------------------------------------------------
    const brandButton = page
      .locator('aside')
      .getByRole('button')
      .filter({ hasNotText: 'Stokta olanlar' })
      .filter({ hasNotText: 'Filtreyi kaldır' })
      .first();
    const brandLabel = (await brandButton.innerText()).split('\n')[0]!.trim();
    await brandButton.click();
    await expect(page.getByText(/güncelleniyor/)).toBeHidden({ timeout: 30_000 });
    await expect(rows.first()).toBeVisible();

    const brands = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
    expect(new Set(brands.map((b) => b.trim())).size).toBe(1);
    expect(brands[0]!.trim()).toBe(brandLabel);
    await page.screenshot({ path: `${SHOTS}/prod-13-brand-filter.png`, fullPage: true });

    // --- detail -----------------------------------------------------------
    const firstCode = (await page.locator('tbody tr td:nth-child(1)').first().innerText()).trim();
    await rows.first().click();
    await page.waitForURL(/\/products\/\?id=/);
    // The code appears twice on the detail page (subtitle + info table), so
    // scope to the first match instead of tripping strict mode.
    await expect(page.getByText(firstCode).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Depo stoğu' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ürün bilgileri' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/prod-14-product-detail.png`, fullPage: true });

    // back to the list
    await page.getByRole('button', { name: '← Ürünler' }).click();
    await expect(page.getByRole('heading', { name: 'Ürünler' })).toBeVisible();
  });

  test('klavye: ↓ ile satır seçilir, Enter detayı açar', async ({ page }) => {
    test.slow();
    await login(page);
    await page.goto('/products/');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });

    await page.locator('[aria-label="Ürün listesi"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/products\/\?id=/);
    await expect(page.getByRole('heading', { name: 'Ürün bilgileri' })).toBeVisible();
  });
});
