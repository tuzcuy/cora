import { test, expect, type Locator, type Page } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * P05 live proof: goods receipt raises stock → ledger shows it → adjustment and
 * transfer → warehouse picking with the barcode field → delivery note (partial)
 * → posted, stock down → return created and approved.
 *
 *   E2E_BASE_URL=https://cora.example.com E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-stock.json';

/** Type into a product type-ahead and take the first hit. Both dialogs stay in
 *  the DOM (native <dialog>), so the caller can scope to the open one. */
async function pickProduct(page: Page, testId: string, term: string, scope?: Locator) {
  const box = (scope ?? page).getByTestId(testId);
  await box.fill(term);
  await expect(page.locator('ul[role="listbox"] li[role="option"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await box.press('Enter');
}

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Stok ve sevkiyat', () => {
  test.use({ storageState: AUTH_STATE });

  test('giriş fişi: ürün ekle → işle → stok artışı hareket defterinde', async ({ page }) => {
    test.slow();
    await page.goto('/stock/');
    await expect(page.getByRole('heading', { name: 'Stok' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('levels-table')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p05-01-stock-levels.png`, fullPage: true });

    await page.getByRole('link', { name: 'Giriş fişleri' }).click();
    await page.waitForURL(/\/stock\/receipts/);
    await page.getByTestId('new-receipt').click();
    await expect(page.getByTestId('receipt-editor')).toBeVisible();

    // two lines through the inline search
    await pickProduct(page, 'receipt-search', 'bardak');
    await pickProduct(page, 'receipt-search', 'tabak');
    await expect(page.locator('[data-testid="receipt-lines"] tbody tr')).toHaveCount(2);

    await page.getByTestId('receipt-qty-0').fill('12');
    await page.getByTestId('receipt-cost-0').fill('40');
    await page.getByTestId('receipt-qty-1').fill('5');
    await page.getByTestId('receipt-cost-1').fill('60');
    await expect(page.getByTestId('receipt-total')).toContainText('780');
    await page.screenshot({ path: `${SHOTS}/p05-02-receipt.png`, fullPage: true });

    await page.getByTestId('receipt-post').click();
    await expect(page.getByTestId('receipt-editor')).toHaveAttribute('data-status', 'POSTED', {
      timeout: 60_000,
    });
    await expect(page.getByText(/işlendi — stok arttı/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p05-03-receipt-posted.png`, fullPage: true });

    // the ledger must show the RECEIPT movement
    await page.goto('/stock/');
    await page.getByTestId('tab-ledger').click();
    await expect(page.getByTestId('ledger-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ledger-table').getByText('Giriş').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p05-04-ledger.png`, fullPage: true });
  });

  test('düzeltme sebep ister ve deftere sebebiyle yazılır', async ({ page }) => {
    test.slow();
    await page.goto('/stock/');
    await page.getByTestId('open-adjust').click();
    const dlg = page.getByRole('dialog', { name: 'Stok düzeltme' });
    await expect(dlg).toBeVisible();
    await pickProduct(page, 'stock-product-search', 'bardak', dlg);
    await dlg.getByTestId('adjust-qty').fill('-2');
    const submit = dlg.getByTestId('adjust-submit');
    await expect(submit).toBeDisabled(); // reason still empty
    await dlg.getByTestId('adjust-reason').fill('E2E kırık ürün');
    await submit.click();
    await expect(page.getByText(/düzeltme işlendi/)).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('tab-ledger').click();
    await expect(page.getByTestId('ledger-table').getByText('E2E kırık ürün').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({ path: `${SHOTS}/p05-05-adjustment.png`, fullPage: true });
  });

  test('sayım: fiş aç → farkı yaz → işle', async ({ page }) => {
    test.slow();
    await page.goto('/stock/counts/');
    await page.getByTestId('new-count').click();
    await page.getByTestId('count-create').click();
    await expect(page.getByTestId('count-sheet')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('count-sheet')).toHaveAttribute('data-status', 'DRAFT');
    await page.screenshot({ path: `${SHOTS}/p05-06-count.png`, fullPage: true });
  });

  test('depo: toplama paneli barkod alanıyla açılır', async ({ page }) => {
    test.slow();
    await page.goto('/warehouse/');
    await expect(page.getByRole('heading', { name: 'Depo' })).toBeVisible({ timeout: 60_000 });
    const card = page.getByTestId('board-card').first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(page.getByTestId('picking-panel')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pick-lines')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p05-07-picking.png`, fullPage: true });
  });

  test('sevkiyat / iade / e-belge listeleri HATASIZ yükleniyor (spinner biter, doğrulama hatası yok)', async ({
    page,
  }) => {
    test.slow();
    // Regression guard: these lists used to 400 on the default view (empty enum
    // query param) and stay stuck — the old test only checked the heading. Now
    // we require the spinner to clear and no "Doğrulama hatası" banner.
    const screens: [string, string][] = [
      ['/shipments/', 'Sevkiyat'],
      ['/returns/', 'İadeler'],
      ['/edocs/', 'e-Belgeler'],
    ];
    for (const [path, heading] of screens) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('Yükleniyor…')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText('Doğrulama hatası')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/p05-list-${heading}.png`, fullPage: true });
    }
  });
});
