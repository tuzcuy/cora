/**
 * P06 proof: PDF renders with Turkish glyphs and no Chromium, Excel export
 * embeds the product photo in the sheet, and the import wizard maps columns,
 * parses Turkish decimals, catches duplicates and writes opening stock through
 * the ledger.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { Permission } from '@cora/shared';

import { tenantExtension } from '../src/prisma/prisma-tenant.extension.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantContext } from '../src/common/context/tenant-context.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { DocumentNumberService } from '../src/common/numbering/document-number.service.js';
import { SettingsService } from '../src/common/settings/settings.service.js';
import { SalesService } from '../src/modules/sales/sales.service.js';
import { PriceResolverService } from '../src/modules/sales/price-resolver.service.js';
import { DocumentGuardsService } from '../src/modules/sales/document-guards.service.js';
import { SalesDocumentsService } from '../src/modules/sales/sales-documents.service.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { PdfService } from '../src/modules/documents/pdf.service.js';
import { ExcelService, parseTrNumber } from '../src/modules/documents/excel.service.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ALL: Permission[] = [
  'quote.read', 'quote.write', 'order.read', 'order.write', 'product.read', 'product.write',
  'product.import', 'partner.read', 'partner.write', 'partner.import', 'stock.read', 'stock.receive',
  'cost.view', 'export.excel',
];

/** 1×1 red PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Türkçe ondalık ayrıştırma', () => {
  it('virgüllü, binlik noktalı ve düz sayıları okur', () => {
    expect(parseTrNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseTrNumber('19,90')).toBeCloseTo(19.9);
    expect(parseTrNumber('250')).toBe(250);
    expect(parseTrNumber('₺ 1.000,00')).toBe(1000);
    expect(parseTrNumber('abc')).toBeNull();
    expect(parseTrNumber('')).toBeNull();
  });
});

dbDescribe('P06 — PDF, Excel, içe aktarım', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', userId = '', partnerId = '', whId = '', unitId = '', productId = '', quoteId = '';
  let files: FilesService;
  let pdf: PdfService;
  let excel: ExcelService;

  const as = <R>(fn: () => Promise<R>) => TenantContext.runAsync({ tenantId: T, userId, permissions: ALL }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P06 ${slug}`, slug: `p06-${slug}` } }));
    T = t.id;
    userId = (await sys(() => db.user.create({ data: { tenantId: T, email: `p06-${slug}@test.local`, passwordHash: 'x', fullName: 'P06 Test' } }))).id;
    await as(async () => {
      unitId = (await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never })).id;
      whId = (await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never })).id;
      partnerId = (await db.businessPartner.create({
        data: { code: `C${slug}`, name: 'Şişli Güneş Otelcilik A.Ş.', type: 'CUSTOMER', city: 'İstanbul', taxOffice: 'Şişli', taxNumber: '1234567890', creditLimit: 100000 } as never,
      })).id;
      productId = (await db.product.create({
        data: { code: `P${slug}`, name: 'Çay Bardağı 100 ml İnce Belli', unitId, salesPrice: 19.9, purchasePrice: 12.5, vatRate: 20 } as never,
      })).id;
      await db.setting.create({ data: { key: 'company', value: { name: 'Demo Toptan A.Ş.', address: 'Antalya', taxOffice: 'Muratpaşa', taxNumber: '9998887776', phone: '0242 000 00 00' } } as never });
      await db.setting.create({ data: { key: 'bank', value: { name: 'Ziraat', branch: 'Antalya', iban: 'TR00 0000 0000 0000 0000 0000 00', accountName: 'Demo Toptan A.Ş.' } } as never });
    });

    const audit = new AuditService(prismaSvc);
    const settings = new SettingsService(prismaSvc);
    files = new FilesService(prismaSvc, audit);
    pdf = new PdfService(prismaSvc, settings, files);
    excel = new ExcelService(prismaSvc, audit, files);

    const sales = new SalesDocumentsService(
      prismaSvc, audit, new DocumentNumberService(prismaSvc), new PriceResolverService(),
      new DocumentGuardsService(prismaSvc, settings), settings, new SalesService(prismaSvc),
    );
    const q = await as(() => sales.create({ type: 'QUOTE', partnerId, lines: [{ qty: 24, productId, unitFactor: 1 }] } as never)) as Record<string, string>;
    quoteId = q.id;
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.documentStatusHistory.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.stockReceiptLine.deleteMany({ where: { receipt: { tenantId: T } } });
      await db.stockReceipt.deleteMany({ where: { tenantId: T } });
      await db.stockMovement.deleteMany({ where: { tenantId: T } });
      await db.stockLevel.deleteMany({ where: { warehouseId: whId } });
      await db.productImage.deleteMany({ where: { product: { tenantId: T } } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.partnerAddress.deleteMany({ where: { partner: { tenantId: T } } });
      await db.businessPartner.deleteMany({ where: { tenantId: T } });
      await db.brand.deleteMany({ where: { tenantId: T } });
      await db.category.deleteMany({ where: { tenantId: T } });
      await db.unit.deleteMany({ where: { tenantId: T } });
      await db.warehouse.deleteMany({ where: { tenantId: T } });
      await db.setting.deleteMany({ where: { tenantId: T } });
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.documentSequence.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('ürün görseli veritabanına yüklenir ve geri okunur', async () => {
    const up = await as(() => files.upload(productId, { buffer: PNG, mimetype: 'image/png', originalname: 'urun.png', size: PNG.length }));
    expect(up.id).toBeTruthy();
    const raw = await as(() => files.raw(up.id));
    expect(raw.data.length).toBe(PNG.length);
    expect(raw.contentType).toBe('image/png');

    const map = await as(() => files.dataUrlsForProducts([productId]));
    expect(map.get(productId)).toMatch(/^data:image\/png;base64,/);

    await expect(as(() => files.upload(productId, { buffer: PNG, mimetype: 'application/pdf', originalname: 'x.pdf', size: 10 }))).rejects.toThrow();
  });

  it('teklif PDF’i üretiliyor (Chromium yok), Türkçe karakter gömülü', async () => {
    const { buffer, fileName } = await as(() => pdf.salesDocument(quoteId));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(3000);
    expect(fileName).toMatch(/^TEK\d{4}-\d{4}\.pdf$/);
    // Roboto subset embedded → the font name appears in the file
    expect(buffer.toString('latin1')).toMatch(/Roboto/);
  });

  it('toplama listesi PDF’i sipariş için üretiliyor', async () => {
    const order = await as(() => db.salesDocument.findFirst({ where: { type: 'QUOTE' } }));
    // pick list needs an ORDER; convert by writing one directly for the test
    const o = await as(() => db.salesDocument.create({
      data: {
        type: 'ORDER', number: `SIP-TEST-${slug}`, partnerId, status: 'SENT_TO_WAREHOUSE',
        lines: { create: [{ lineNo: 1, productId, description: 'Çay Bardağı', qty: 10, unitPrice: 19.9, vatRate: 20, warehouseId: whId }] },
      } as never,
    }));
    expect(order).toBeTruthy();
    const { buffer } = await as(() => pdf.pickList(o.id));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('Excel dışa aktarımı fotoğrafı hücreye gömüyor', async () => {
    const { buffer, count } = await as(() => excel.exportProducts({ withImages: true }));
    expect(count).toBeGreaterThan(0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Ürünler')!;
    expect(ws.getRow(1).getCell(2).value).toBe('Kod');
    expect(ws.rowCount).toBeGreaterThan(1);
    // the image is anchored inside the sheet, not attached as a separate file
    expect(wb.model.media.length).toBeGreaterThan(0);
    expect(ws.getImages().length).toBeGreaterThan(0);
  });

  it('belge dışa aktarımında maliyet sütunları yalnız cost.view ile', async () => {
    const withCost = await as(() => excel.exportDocuments({ canViewCost: true }));
    const without = await as(() => excel.exportDocuments({ canViewCost: false }));
    const read = async (buf: Buffer) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('Belgeler')!;
      const headers: string[] = [];
      ws.getRow(1).eachCell((c) => headers.push(String(c.value)));
      return headers;
    };
    expect(await read(withCost.buffer)).toContain('Kâr');
    expect(await read(without.buffer)).not.toContain('Kâr');
  });

  it('içe aktarım sihirbazı: sütunları eşler, Türkçe ondalığı okur, tekrarı ve mevcut kaydı bildirir', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ürünler');
    ws.addRow(['Ürün kodu', 'Ürün adı', 'Marka', 'Birim', 'KDV %', 'Alış fiyatı', 'Satış fiyatı', 'Açılış stoğu']);
    ws.addRow([`IMP-${slug}-1`, 'İthal Kupa 300 ml', 'Paşabahçe', 'ADET', 20, '12,50', '24,90', 30]);
    ws.addRow([`IMP-${slug}-2`, 'Şeffaf Tabak 21 cm', 'Paşabahçe', 'ADET', 20, '18,75', '32,50', 0]);
    ws.addRow([`IMP-${slug}-1`, 'Tekrar eden kod', 'Paşabahçe', 'ADET', 20, '1,00', '2,00', 0]);
    ws.addRow(['', 'Kodsuz satır', '', 'ADET', 20, '1,00', '2,00', 0]);
    ws.addRow([`P${slug}`, 'Çay Bardağı 100 ml İnce Belli', '', 'ADET', 20, '13,00', '21,90', 0]);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const analysis = await as(() => excel.analyze('products', file));
    expect(analysis.mapping.code).toBe('Ürün kodu');
    expect(analysis.mapping.salesPrice).toBe('Satış fiyatı');
    expect(analysis.rowCount).toBe(5);
    expect(analysis.issues.some((i) => /tekrar eden kod/i.test(i.message))).toBe(true);
    expect(analysis.issues.some((i) => /Zorunlu alan boş/.test(i.message))).toBe(true);
    expect(analysis.issues.some((i) => /zaten var/.test(i.message))).toBe(true);

    const result = await as(() => excel.commit('products', file, analysis.mapping, { warehouseId: whId }));
    expect(result.created).toBe(2);
    expect(result.updated).toBe(2); // the pre-existing product + the duplicate row updating its twin
    expect(result.failedCount).toBe(1); // the row without a code
    expect(result.receiptNumber).toMatch(/^GIR-ACILIS-/);

    // row 4 repeats IMP-1 on purpose, so the last write wins there; assert on IMP-2
    const imported = await as(() => db.product.findFirst({ where: { code: `IMP-${slug}-2` } }));
    expect(Number(imported!.salesPrice)).toBeCloseTo(32.5, 2);
    expect(Number(imported!.purchasePrice)).toBeCloseTo(18.75, 2);
    const overwritten = await as(() => db.product.findFirst({ where: { code: `IMP-${slug}-1` } }));
    expect(overwritten!.name).toBe('Tekrar eden kod');

    // opening stock went through the ledger, not straight into StockLevel
    const level = await as(() => db.stockLevel.findFirst({ where: { productId: overwritten!.id, warehouseId: whId } }));
    expect(Number(level!.onHand)).toBe(30);
    const move = await as(() => db.stockMovement.findFirst({ where: { productId: overwritten!.id, type: 'RECEIPT' } }));
    expect(Number(move!.qty)).toBe(30);

    const csv = excel.errorCsv(result.failed);
    expect(csv.toString('utf8')).toMatch(/satir;hata/);
  });

  it('cari içe aktarımı adresi de yazar', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cariler');
    ws.addRow(['Cari kodu', 'Ünvan', 'Tip', 'Şehir', 'Adres', 'Kredi limiti', 'E-posta']);
    ws.addRow([`IMPC-${slug}`, 'Kaş Deniz Otel Ltd.', 'CUSTOMER', 'Antalya', 'Çukurbağ Yarımadası No:1', '250.000,00', 'satinalma@kasdeniz.com']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const analysis = await as(() => excel.analyze('partners', file));
    expect(analysis.issues).toHaveLength(0);
    const res = await as(() => excel.commit('partners', file, analysis.mapping));
    expect(res.created).toBe(1);

    expect(res.failedCount).toBe(0);
    const p = await as(() => db.businessPartner.findFirst({ where: { code: `IMPC-${slug}` }, include: { addresses: true } }));
    expect(Number(p!.creditLimit)).toBe(250000);
    expect(p!.addresses[0]!.line1).toContain('Çukurbağ');
  });
});
