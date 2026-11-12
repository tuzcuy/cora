import { test, expect, type Page } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * P04 live proof: quote editor → 3 ways of adding lines → qty/discount →
 * totals → save → approve → convert to order → document flow chain, plus a
 * keyboard-only quote.
 *
 *   E2E_BASE_URL=https://cora.example.com E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-editor.json';

/** Pick the first customer matching `q` in the header picker. */
async function pickCustomer(page: Page, q: string) {
  const search = page.getByTestId('partner-search');
  await search.fill(q);
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
  await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Değiştir', exact: true })).toBeVisible();
}

const rows = (page: Page) => page.locator('[data-testid="lines-table"] tbody tr[data-row]');

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Teklif editörü', () => {
  test.use({ storageState: AUTH_STATE });
  let quoteUrl = '';

  test('müşteri → 3 yöntemle ürün → miktar/iskonto → kaydet → onayla → siparişe dönüştür → akış', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/');
    await expect(page.getByRole('heading', { name: 'Teklifler' })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('new-document').click();
    await page.waitForURL(/\/quotes\/new/);
    await expect(page.getByTestId('document-editor')).toBeVisible();

    await pickCustomer(page, 'otel');

    // 1) inline search + Enter
    const search = page.getByTestId('line-search');
    await search.fill('bardak');
    await expect(page.getByTestId('line-search-results').getByRole('option').first()).toBeVisible({ timeout: 30_000 });
    await search.press('Enter');
    await expect(rows(page)).toHaveCount(1);

    // 2) F2 product browser, multi-select
    await page.keyboard.press('F2');
    const browser = page.getByTestId('browser-search');
    await expect(browser).toBeVisible();
    await browser.fill('tabak');
    await expect(page.getByRole('dialog').locator('tbody input[type=checkbox]').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('dialog').locator('tbody tr').first().locator('input[type=checkbox]').check({ force: true });
    await page.getByRole('dialog').locator('tbody tr').nth(1).locator('input[type=checkbox]').check({ force: true });
    await page.getByTestId('browser-add').click();
    await expect(rows(page)).toHaveCount(3);

    // 3) paste a product code — the salesperson's Excel copy/paste path.
    // The code is read off row 1 so the test does not depend on a search term.
    const code = (await rows(page).first().locator('.font-mono').first().innerText()).trim();
    await search.fill('');
    await search.evaluate((el, c) => {
      const dt = new DataTransfer();
      dt.setData('text', c);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, code);
    await expect(rows(page)).toHaveCount(4, { timeout: 30_000 });
    await expect(rows(page).nth(3)).toContainText(code);

    // qty + discount → live totals
    await page.getByTestId('qty-1').fill('2');
    await page.getByTestId('disc-0').fill('10');
    await expect(page.getByTestId('dirty')).toBeVisible();
    const total = await page.getByTestId('grand-total').innerText();
    expect(total).not.toMatch(/^₺?0[,.]00/);

    await page.screenshot({ path: `${SHOTS}/p04-01-editor.png`, fullPage: true });

    // Ctrl+S → created, URL gains ?id=
    await page.keyboard.press('Control+s');
    await page.waitForURL(/\/quotes\/\?id=/, { timeout: 60_000 });
    quoteUrl = page.url();
    await expect(page.getByTestId('dirty')).toHaveCount(0);
    await expect(page.locator('[data-step="DRAFT"][data-state="current"]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/TEK/);

    // approve (may route to manager approval — admin holds that permission)
    const approve = page.getByTestId('transition-APPROVED');
    await expect(approve).toBeVisible({ timeout: 30_000 });
    if (!(await approve.isEnabled())) {
      // stock blocker: drop every quantity to 1 and retry
      for (let i = 0; i < 4; i++) await page.getByTestId(`qty-${i}`).fill('1');
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('dirty')).toHaveCount(0);
    }
    await approve.click();
    const confirm = page.getByTestId('transition-confirm');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByTestId('document-editor')).toHaveAttribute('data-status', /APPROVED|APPROVAL_PENDING/, { timeout: 30_000 });
    if ((await page.getByTestId('document-editor').getAttribute('data-status')) === 'APPROVAL_PENDING') {
      await page.getByTestId('transition-APPROVED').click();
      await expect(page.getByTestId('document-editor')).toHaveAttribute('data-status', 'APPROVED', { timeout: 30_000 });
    }
    await expect(page.locator('[data-step="APPROVED"][data-state="current"]')).toBeVisible();
    await page.locator('[data-step="APPROVED"]').click(); // history popover
    await expect(page.getByRole('dialog', { name: /geçmişi/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p04-02-approved.png`, fullPage: true });

    // quote approval already created the linked order (CREATE_ORDER effect) — flow tab shows it
    await page.getByTestId('tab-flow').click();
    await expect(page.getByTestId('flow')).toContainText(/SIP/);
    await page.screenshot({ path: `${SHOTS}/p04-03-flow.png`, fullPage: true });
  });

  test('bağlı sipariş: kaynak teklif akışta görünür', async ({ page }) => {
    test.slow();
    await page.goto(quoteUrl);
    await page.getByTestId('tab-flow').click();
    const orderLink = page.getByTestId('flow').locator('a[href*="/orders/"]').first();
    await expect(orderLink).toBeVisible({ timeout: 30_000 });
    await orderLink.click();
    await page.waitForURL(/\/orders\/\?id=/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/SIP/);
    await page.getByTestId('tab-flow').click();
    await expect(page.getByTestId('flow')).toContainText(/TEK/);
    await page.screenshot({ path: `${SHOTS}/p04-04-order-flow.png`, fullPage: true });
  });

  test('sadece klavyeyle teklif: müşteri, 3 satır, kaydet, ? yardım', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/new/');
    await expect(page.getByTestId('partner-search')).toBeFocused({ timeout: 60_000 });
    await page.keyboard.type('otel');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Değiştir', exact: true })).toBeVisible();

    for (const term of ['bardak', 'tabak']) {
      await page.keyboard.press('Control+Enter'); // focus the line search
      await expect(page.getByTestId('line-search')).toBeFocused();
      await page.keyboard.type(term);
      await expect(page.getByTestId('line-search-results').getByRole('option').first()).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press('Enter');
    }
    await expect(rows(page)).toHaveCount(2);

    await page.keyboard.press('F2');
    await expect(page.getByTestId('browser-search')).toBeFocused();
    await page.keyboard.type('kupa');
    await expect(page.getByRole('dialog').locator('tbody input[type=checkbox]').first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Enter'); // adds the focused row
    await expect(rows(page)).toHaveCount(3);

    await page.keyboard.press('Control+s');
    await page.waitForURL(/\/quotes\/\?id=/, { timeout: 60_000 });
    await expect(page.getByTestId('dirty')).toHaveCount(0);

    // Tab out of the text fields first — `?` must stay typeable inside inputs.
    for (let i = 0; i < 20; i++) {
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Klavye kısayolları' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p04-05-keyboard-help.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Klavye kısayolları' })).toBeHidden();
    await expect(page.getByTestId('document-editor')).toBeVisible(); // Esc closed the help, not the editor
  });
  test('liste: eylem sütunu ve çoklu seçim toplu durum çubuğu', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });

    // row actions
    await expect(rows.first().getByRole('button', { name: 'Kopyala' })).toBeVisible();

    // multi-select → bulk bar with state-machine targets (nothing is applied here:
    // the demo data must stay as seeded)
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    const bar = page.getByTestId('bulk-bar');
    await expect(bar).toContainText('2 seçili');
    await expect(bar.getByLabel('Toplu durum')).toBeVisible();
    await expect(bar.getByLabel('Toplu durum').locator('option')).toContainText(['Durum seç…', 'Gönderildi', 'Onayla', 'Süresi Doldu', 'İptal']);
    await page.screenshot({ path: `${SHOTS}/p04-06-list-bulk.png`, fullPage: true });
    await bar.getByRole('button', { name: 'Temizle' }).click();
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  });
});
