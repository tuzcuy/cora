import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';

/**
 * P03 live proof: Ayarlar → Markalar → yeni marka oluştur → düzenle → sil.
 * Also checks field validation, Ctrl+S, Esc-with-unsaved-changes guard, and
 * that a brand in use is refused with a readable 409.
 *
 *   E2E_BASE_URL=https://cora.example.com E2E_EMAIL=... E2E_PASSWORD=... pnpm e2e
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-crud.json';

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('Ayarlar › Markalar CRUD', () => {
  test.use({ storageState: AUTH_STATE });
  const stamp = Date.now().toString(36).slice(-5);
  const name = `E2E Marka ${stamp}`;
  const renamed = `${name} (rev)`;

  test.beforeEach(async ({ page }) => {
    test.slow();
    await page.goto('/settings/brands/');
    await expect(page.getByRole('heading', { name: 'Markalar' })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  });

  test('yeni marka: doğrulama, Ctrl+S ile kaydet', async ({ page }) => {
    await page.getByTestId('crud-new').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByRole('heading', { name: 'Yeni marka' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p03-01-new-brand-dialog.png` });

    // empty → field error under the input
    await dialog.getByRole('button', { name: /Kaydet/ }).click();
    await expect(dialog.getByText('Marka adı gerekli')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p03-02-validation.png` });

    await dialog.getByLabel('Marka adı').fill(name);
    await page.keyboard.press('Control+s');
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p03-03-created.png`, fullPage: true });
  });

  test('düzenle: Esc kaydedilmemiş değişiklikte sorar, Kaydet yeniden adlandırır', async ({ page }) => {
    const row = page.locator('tbody tr', { hasText: name });
    await row.getByTestId('crud-edit').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByRole('heading', { name: 'Marka düzenle' })).toBeVisible();

    await dialog.getByLabel('Marka adı').fill(renamed);
    // Esc with a dirty form → confirm prompt; dismiss keeps the dialog open.
    page.once('dialog', (d) => d.dismiss());
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /Kaydet/ }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p03-04-renamed.png`, fullPage: true });
  });

  test('kullanımdaki marka silinemez (409, anlaşılır mesaj)', async ({ page }) => {
    const inUse = page.locator('tbody tr', { hasText: 'Paşabahçe' }).first();
    await inUse.getByTestId('crud-delete').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByText(/silme reddedilecek/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Sil' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/Bağlı kayıtlar|ürün/, { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p03-05-delete-refused.png` });
    await dialog.getByRole('button', { name: 'Vazgeç' }).click();
    await expect(page.locator('tbody tr', { hasText: 'Paşabahçe' }).first()).toBeVisible();
  });

  test('sil: onay → listeden kalkar; "Silinenleri göster" ile görünür', async ({ page }) => {
    const row = page.locator('tbody tr', { hasText: renamed });
    await row.getByTestId('crud-delete').click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Sil' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toHaveCount(0, { timeout: 30_000 });

    await page.getByLabel('Silinenleri göster').check();
    const deletedRow = page.locator('tbody tr', { hasText: renamed });
    await expect(deletedRow).toBeVisible({ timeout: 30_000 });
    await expect(deletedRow.getByText('Silinmiş')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p03-06-deleted.png`, fullPage: true });
  });
});

test.describe('Ayarlar alt sayfaları açılıyor', () => {
  test.use({ storageState: AUTH_STATE });
  for (const [path, heading] of [
    ['/settings/categories/', 'Kategoriler'],
    ['/settings/units/', 'Birimler'],
    ['/settings/warehouses/', 'Depolar'],
    ['/settings/partner-groups/', 'Cari Grupları'],
  ] as const) {
    test(`${heading} listesi`, async ({ page }) => {
      test.slow();
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    });
  }
});
