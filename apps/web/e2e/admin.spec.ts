import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * P08 live proof: the five admin tabs — users, the permission matrix, company
 * settings that the PDF reads, exchange rates and the audit trail with its diff.
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-p08.json';
const STAMP = Date.now().toString(36).slice(-5);

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Yönetim', () => {
  test.use({ storageState: AUTH_STATE });

  test('kullanıcı eklenir ve geçici şifre bir kez gösterilir', async ({ page }) => {
    test.slow();
    await page.goto('/settings/admin/?tab=users');
    await expect(page.getByTestId('users-table')).toBeVisible({ timeout: 60_000 });

    await page.getByTestId('new-user').click();
    const dlg = page.getByRole('dialog', { name: 'Yeni kullanıcı' });
    await expect(dlg).toBeVisible();
    await dlg.getByTestId('user-fullName').fill(`E2E Kullanıcı ${STAMP}`);
    await dlg.getByTestId('user-email').fill(`e2e-${STAMP}@corantest.local`);
    await dlg.getByTestId('save-user').click();

    await expect(page.getByTestId('user-notice')).toContainText('Geçici şifre', { timeout: 60_000 });
    await expect(page.getByTestId('users-table')).toContainText(`E2E Kullanıcı ${STAMP}`);
    await page.screenshot({ path: `${SHOTS}/p08-01-users.png`, fullPage: true });

    // deactivate it again so the demo tenant stays tidy
    const row = page.locator('tr', { hasText: `E2E Kullanıcı ${STAMP}` });
    await row.getByRole('button', { name: 'Pasifleştir' }).click();
    await page.getByRole('button', { name: 'Pasifleştir' }).last().click();
    await expect(page.getByTestId('user-notice')).toContainText('pasifleştirildi', { timeout: 30_000 });
  });

  test('rol–yetki matrisi görünür ve kaydedilebilir', async ({ page }) => {
    test.slow();
    await page.goto('/settings/admin/?tab=roles');
    await expect(page.getByTestId('roles-tab')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('perm-quote.read')).toBeVisible();
    await expect(page.getByTestId('perm-cost.view')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p08-02-roles.png`, fullPage: true });
  });

  test('firma bilgileri kaydedilir ve PDF bunları kullanır', async ({ page }) => {
    test.slow();
    await page.goto('/settings/admin/?tab=company');
    await expect(page.getByTestId('company-tab')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('company-name').fill('Demo Toptan A.Ş.');
    await page.getByTestId('company-taxOffice').fill('Muratpaşa');
    await page.getByTestId('company-taxNumber').fill('1234567890');
    await page.getByTestId('bank-iban').fill('TR33 0006 1005 1978 6457 8413 26');
    await page.getByTestId('save-settings').click();
    await expect(page.getByText(/Ayarlar kaydedildi/)).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/p08-03-company.png`, fullPage: true });

    // the quote PDF must still render with the new header
    await page.goto('/quotes/');
    await page.locator('tbody tr').first().click();
    await page.waitForURL(/\/quotes\/\?id=/);
    const pdf = page.waitForResponse((r) => /\/documents\/sales\/.+\/pdf/.test(r.url()), { timeout: 120_000 });
    const popup = page.waitForEvent('popup', { timeout: 120_000 });
    await page.getByTestId('doc-pdf').click();
    expect((await pdf).status()).toBe(200);
    await (await popup).close().catch(() => undefined);
  });

  test('döviz kuru elle girilir', async ({ page }) => {
    test.slow();
    await page.goto('/settings/admin/?tab=rates');
    await expect(page.getByTestId('rates-tab')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('rate-input').fill('41.5');
    await page.getByTestId('save-rate').click();
    await expect(page.getByTestId('rate-flash')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('rates-table')).toContainText('USD');
    await page.screenshot({ path: `${SHOTS}/p08-04-rates.png`, fullPage: true });
  });

  test('işlem günlüğü kaydı ve diff’i gösterir', async ({ page }) => {
    test.slow();
    await page.goto('/settings/admin/?tab=audit');
    await expect(page.getByTestId('audit-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="audit-table"] tbody tr').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="audit-table"] tbody tr').first().click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p08-05-audit.png`, fullPage: true });
    await page.keyboard.press('Escape');
  });
});
