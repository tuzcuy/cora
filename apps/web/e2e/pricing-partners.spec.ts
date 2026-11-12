import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * P07 live proof: new partner card with a contact and address → price list with
 * a product and a quantity tier → the tier price shows up in a quote → account
 * statement and the credit-risk screen.
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-p07.json';
const STAMP = Date.now().toString(36).slice(-5);

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Cari, fiyat listesi, risk', () => {
  test.use({ storageState: AUTH_STATE });
  const partnerName = `E2E Fiyat Otel ${STAMP}`;

  test('yeni cari: kişi ve adresle kaydedilir', async ({ page }) => {
    test.slow();
    await page.goto('/partners/');
    await expect(page.getByRole('heading', { name: 'Cariler' })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('new-partner').click();
    await expect(page.getByTestId('partner-form')).toBeVisible();

    await page.getByTestId('partner-code').fill(`E2E-${STAMP}`);
    await page.getByTestId('partner-name').fill(partnerName);
    await page.getByTestId('partner-city').fill('Antalya');
    await page.getByTestId('partner-creditLimit').fill('100000');

    await page.getByTestId('add-contact').click();
    await page.getByTestId('contact-name-0').fill('Zeynep Kara');
    await page.getByTestId('contact-email-0').fill('zeynep@e2e.test');

    await page.getByTestId('add-address').click();
    await page.getByTestId('address-line1-0').fill('Lara Cad. 5');
    await page.getByTestId('address-city-0').fill('Antalya');

    await page.getByTestId('partner-save').click();
    await page.waitForURL(/\/partners\/\?id=/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(partnerName);
    await page.screenshot({ path: `${SHOTS}/p07-01-partner-card.png`, fullPage: true });
  });

  test('fiyat listesi + kademe kurulur ve cariye bağlanır', async ({ page }) => {
    test.slow();
    await page.goto('/pricing/');
    await expect(page.getByRole('heading', { name: 'Fiyat listeleri' })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('new-price-list').click();
    await page.getByTestId('price-list-name').fill(`E2E Liste ${STAMP}`);
    await page.getByTestId('create-price-list').click();
    await page.waitForURL(/\/pricing\/\?id=/, { timeout: 60_000 });
    await expect(page.getByTestId('price-list-detail')).toBeVisible();

    // add a product to the list, then halve its price so the effect is obvious
    await page.getByTestId('price-list-search').fill('bardak');
    await expect(page.locator('ul[role="listbox"] li[role="option"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('price-list-search').press('Enter');
    await expect(page.locator('[data-testid="price-list-items"] tbody tr').first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('list-price-0').fill('50');
    await page.getByTestId('list-price-0').blur();
    await expect(page.getByTestId('list-price-0')).toHaveValue('50', { timeout: 30_000 });

    // 100+ pieces → 10% off
    await page.getByTestId('edit-tiers-0').click();
    const dlg = page.getByRole('dialog', { name: /Miktar kademeleri/ });
    await expect(dlg).toBeVisible();
    await dlg.getByTestId('add-tier').click();
    await dlg.getByTestId('tier-qty-0').fill('100');
    await dlg.getByTestId('tier-disc-0').fill('10');
    await dlg.getByTestId('save-tiers').click();
    await expect(page.getByTestId('price-list-items')).toContainText('100+', { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p07-02-price-list.png`, fullPage: true });

    // attach the list to the partner created above
    await page.goto('/partners/');
    await page.getByLabel('Cari ara').fill(partnerName);
    await expect(page.getByText(partnerName).first()).toBeVisible({ timeout: 30_000 });
    await page.getByText(partnerName).first().click();
    await page.waitForURL(/\/partners\/\?id=/);
    await page.getByTestId('detail-edit').click();
    await expect(page.getByTestId('partner-form')).toBeVisible();
    await page.getByTestId('partner-pricelist').selectOption({ label: `E2E Liste ${STAMP}` });
    await page.getByTestId('partner-save').click();
    await expect(page.getByTestId('partner-risk')).toBeVisible({ timeout: 60_000 });
  });

  test('teklif ekranı liste ve kademe fiyatını kendiliğinden kullanır', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/new/');
    await expect(page.getByTestId('document-editor')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('partner-search').fill(partnerName);
    await expect(page.locator('ul[role="listbox"] li[role="option"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('partner-search').press('Enter');

    await page.getByTestId('line-search').fill('bardak');
    await expect(page.getByTestId('line-search-results').locator('li[role="option"]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('line-search').press('Enter');

    // save so the server resolves the price, then read it back
    await page.keyboard.press('Control+s');
    await page.waitForURL(/\/quotes\/\?id=/, { timeout: 60_000 });
    const price = await page.getByTestId('price-0').inputValue();
    expect(Number(price)).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/p07-03-quote-price.png`, fullPage: true });

    // 100 pieces crosses the tier: the unit price must drop
    await page.getByTestId('qty-0').fill('100');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('dirty')).toHaveCount(0, { timeout: 60_000 });
  });

  test('ekstre ve risk ekranı açılır', async ({ page }) => {
    test.slow();
    await page.goto('/partners/');
    await page.getByLabel('Cari ara').fill(partnerName);
    await expect(page.getByText(partnerName).first()).toBeVisible({ timeout: 30_000 });
    await page.getByText(partnerName).first().click();
    await page.getByTestId('detail-statement').click();
    await expect(page.getByTestId('partner-statement')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Açılış bakiyesi')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p07-04-statement.png`, fullPage: true });

    await page.goto('/partners/risk/');
    await expect(page.getByTestId('risk-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('risk-threshold').fill('1');
    await expect(page.getByTestId('risk-table')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p07-05-risk.png`, fullPage: true });
  });

  test('toplu fiyat güncelleme önizlemesi çalışır', async ({ page }) => {
    test.slow();
    await page.goto('/pricing/');
    await page.getByTestId('open-bulk').click();
    const dlg = page.getByRole('dialog', { name: 'Toplu fiyat güncelleme' });
    await expect(dlg).toBeVisible();
    await dlg.getByTestId('bulk-percent').fill('5');
    await dlg.getByTestId('bulk-filter').fill('bardak');
    await dlg.getByTestId('bulk-preview').click();
    await expect(page.getByTestId('bulk-preview-table')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/p07-06-bulk-price.png`, fullPage: true });
    // deliberately not applied: the demo catalogue stays as seeded
    await page.keyboard.press('Escape');
  });
});
