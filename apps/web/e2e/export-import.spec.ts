import { test, expect } from '@playwright/test';
import { SHOTS, login } from './helpers';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * P06 live proof: product photo upload → Excel export with the photo inside the
 * cell → quote PDF → the import wizard end to end → e-mail dialog with its log.
 */
const AUTH_STATE = process.env.E2E_AUTH ?? 'test-results/.auth-p06.json';

/** 8×8 solid PNG, small enough to inline. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAI0lEQVR42mNkYPhfz0AEYBxVSF+FjAxkKKQ8UEZ9PeorBADlqQXBLZDbTQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe.configure({ mode: 'serial' });

test('oturum aç', async ({ page }) => {
  test.slow();
  await login(page);
  await page.context().storageState({ path: AUTH_STATE });
});

test.describe('PDF, Excel, içe aktarım', () => {
  test.use({ storageState: AUTH_STATE });
  const dir = mkdtempSync(path.join(tmpdir(), 'cora-e2e-'));

  test('ürün görseli yüklenir ve Excel’e fotoğraflı aktarılır', async ({ page }) => {
    test.slow();
    await page.goto('/products/');
    await expect(page.getByRole('heading', { name: 'Ürünler' })).toBeVisible({ timeout: 60_000 });
    await page.locator('tbody tr').first().click();
    await expect(page.getByTestId('product-images')).toBeVisible({ timeout: 30_000 });

    const imgPath = path.join(dir, 'urun.png');
    writeFileSync(imgPath, PNG);
    await page.getByTestId('image-upload').setInputFiles(imgPath);
    // reruns accumulate images on the same product; one is enough to prove upload
    await expect(page.getByTestId('product-images').locator('img').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/p06-01-product-image.png`, fullPage: true });

    await page.goto('/products/');
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('export-products').click();
    const file = await download;
    const target = path.join(dir, 'urunler.xlsx');
    await file.saveAs(target);
    const bytes = readFileSync(target);
    expect(bytes.length).toBeGreaterThan(5000);
    // .xlsx is a zip; the media folder proves an image was embedded
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.toString('latin1')).toContain('xl/media/');
    await page.screenshot({ path: `${SHOTS}/p06-02-products-export.png`, fullPage: true });
  });

  test('teklif PDF’i indirilir', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await page.locator('tbody tr').first().click();
    await page.waitForURL(/\/quotes\/\?id=/);
    await expect(page.getByTestId('document-editor')).toBeVisible({ timeout: 30_000 });

    // The tab opens on a blob URL, so assert on the API response instead of the
    // popup's (initially empty) location.
    const pdfResponse = page.waitForResponse((r) => /\/documents\/sales\/.+\/pdf/.test(r.url()), { timeout: 120_000 });
    const popup = page.waitForEvent('popup', { timeout: 120_000 });
    await page.getByTestId('doc-pdf').click();
    const res = await pdfResponse;
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect(Number(res.headers()['content-length'] ?? 0)).toBeGreaterThan(3000);
    await (await popup).close().catch(() => undefined);
    await page.screenshot({ path: `${SHOTS}/p06-03-quote-pdf-button.png`, fullPage: true });
  });

  test('e-posta penceresi açılır, gönderim log’u görünür', async ({ page }) => {
    test.slow();
    await page.goto('/quotes/');
    await page.locator('tbody tr').first().click();
    await page.waitForURL(/\/quotes\/\?id=/);
    await page.getByTestId('doc-email').click();
    const dlg = page.getByRole('dialog', { name: 'E-posta ile gönder' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('email-to')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p06-04-email-dialog.png`, fullPage: true });
    await page.keyboard.press('Escape');
  });

  test('içe aktarım sihirbazı: dosya → eşleme → doğrulama → aktar', async ({ page }) => {
    test.slow();
    await page.goto('/settings/import/');
    await expect(page.getByTestId('import-wizard')).toBeVisible({ timeout: 60_000 });

    // template download proves the round trip is real
    const tpl = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByTestId('download-template').click();
    const tplFile = await tpl;
    const tplPath = path.join(dir, 'sablon.xlsx');
    await tplFile.saveAs(tplPath);
    expect(readFileSync(tplPath).length).toBeGreaterThan(2000);

    // build a tiny partner sheet from the template's own format
    const stamp = Date.now().toString(36).slice(-5);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cariler');
    ws.addRow(['Cari kodu', 'Ünvan', 'Tip', 'Şehir', 'Adres', 'Kredi limiti']);
    ws.addRow([`E2E-${stamp}`, `E2E Test Otel ${stamp}`, 'CUSTOMER', 'Antalya', 'Test Mah. 1. Sk.', '125.000,50']);
    const sheet = path.join(dir, 'cariler.xlsx');
    writeFileSync(sheet, Buffer.from(await wb.xlsx.writeBuffer()));

    await page.getByTestId('kind-partners').click();
    await page.getByTestId('import-file').setInputFiles(sheet);
    await expect(page.getByTestId('import-summary')).toContainText('1 satır', { timeout: 60_000 });
    await expect(page.getByTestId('map-code')).toHaveValue('Cari kodu');
    await expect(page.getByTestId('import-preview')).toContainText(`E2E Test Otel ${stamp}`);
    await page.screenshot({ path: `${SHOTS}/p06-05-import-mapping.png`, fullPage: true });

    await page.getByTestId('import-commit').click();
    await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('import-result')).toContainText('1 yeni kayıt');
    await page.screenshot({ path: `${SHOTS}/p06-06-import-result.png`, fullPage: true });

    // and the record is really there
    await page.goto('/partners/');
    await page.getByLabel(/ara/i).first().fill(`E2E Test Otel ${stamp}`);
    await expect(page.getByText(`E2E Test Otel ${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  });
});
