import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { buildSearchText, turkishFold } from '@cora/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { FilesService } from '../files/files.service.js';

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
const HEAD_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };

/** Turkish decimal comma, thousand dot: "1.234,56" → 1234.56 */
export function parseTrNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const raw = String(input).trim().replace(/\s|₺|TL/gi, '');
  if (!raw) return null;
  const normalised = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

export interface ImportColumn {
  /** Field in Cora. */
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}

export const PRODUCT_COLUMNS: ImportColumn[] = [
  { key: 'code', label: 'Ürün kodu', required: true },
  { key: 'name', label: 'Ürün adı', required: true },
  { key: 'barcode', label: 'Barkod' },
  { key: 'brand', label: 'Marka' },
  { key: 'category', label: 'Kategori' },
  { key: 'unit', label: 'Birim', hint: 'ADET, KOLİ…' },
  { key: 'vatRate', label: 'KDV %' },
  { key: 'purchasePrice', label: 'Alış fiyatı' },
  { key: 'salesPrice', label: 'Satış fiyatı' },
  { key: 'minStock', label: 'Kritik stok' },
  { key: 'openingStock', label: 'Açılış stoğu', hint: 'Girilirse giriş fişi olarak işlenir' },
];

export const PARTNER_COLUMNS: ImportColumn[] = [
  { key: 'code', label: 'Cari kodu', required: true },
  { key: 'name', label: 'Ünvan', required: true },
  { key: 'type', label: 'Tip', hint: 'CUSTOMER / SUPPLIER' },
  { key: 'taxOffice', label: 'Vergi dairesi' },
  { key: 'taxNumber', label: 'VKN / TCKN' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-posta' },
  { key: 'city', label: 'Şehir' },
  { key: 'district', label: 'İlçe' },
  { key: 'address', label: 'Adres' },
  { key: 'creditLimit', label: 'Kredi limiti' },
];

type Row = Record<string, unknown>;

/**
 * Excel in and out (P06).
 *
 * Export embeds the product photo INSIDE the cell — the thing the customer's
 * current system cannot do — using ExcelJS images anchored to the row.
 * Import is a three-step wizard: analyse (headers + suggested mapping + preview
 * with validation), then commit, with Turkish decimal commas and duplicate-code
 * detection handled here rather than left to the user.
 */
@Injectable()
export class ExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  /* ─────────────────────────────── export ─────────────────────────────── */

  async exportProducts(q: { q?: string; brandId?: string; categoryId?: string; withImages?: boolean; limit?: number }) {
    const where: Prisma.ProductWhereInput = {};
    if (q.q?.trim()) where.searchText = { contains: turkishFold(q.q.trim()) };
    if (q.brandId) where.brandId = q.brandId;
    if (q.categoryId) where.categoryId = q.categoryId;

    const products = await this.prisma.db.product.findMany({
      where,
      orderBy: { code: 'asc' },
      take: Math.min(q.limit ?? 5000, 20000),
      include: {
        brand: { select: { name: true } },
        category: { select: { name: true } },
        unit: { select: { code: true } },
        stockLevels: { select: { onHand: true, reserved: true } },
      },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cora';
    const ws = wb.addWorksheet('Ürünler', { views: [{ state: 'frozen', ySplit: 1 }] });
    const withImages = q.withImages !== false;

    ws.columns = [
      { header: 'Görsel', key: 'image', width: 12 },
      { header: 'Kod', key: 'code', width: 18 },
      { header: 'Ürün adı', key: 'name', width: 46 },
      { header: 'Marka', key: 'brand', width: 16 },
      { header: 'Kategori', key: 'category', width: 18 },
      { header: 'Barkod', key: 'barcode', width: 16 },
      { header: 'Birim', key: 'unit', width: 8 },
      { header: 'KDV %', key: 'vatRate', width: 8 },
      { header: 'Alış', key: 'purchasePrice', width: 12 },
      { header: 'Satış', key: 'salesPrice', width: 12 },
      { header: 'Stok', key: 'onHand', width: 10 },
      { header: 'Rezerve', key: 'reserved', width: 10 },
      { header: 'Satılabilir', key: 'available', width: 12 },
    ];
    ws.getRow(1).fill = HEAD_FILL;
    ws.getRow(1).font = HEAD_FONT;
    ws.getRow(1).height = 20;

    const images = withImages ? await this.files.dataUrlsForProducts(products.map((p) => p.id)) : new Map<string, string>();

    products.forEach((p, i) => {
      const onHand = p.stockLevels.reduce((a, s) => a + Number(s.onHand), 0);
      const reserved = p.stockLevels.reduce((a, s) => a + Number(s.reserved), 0);
      const row = ws.addRow({
        image: '',
        code: p.code,
        name: p.name,
        brand: p.brand?.name ?? '',
        category: p.category?.name ?? '',
        barcode: p.barcode ?? '',
        unit: p.unit?.code ?? '',
        vatRate: Number(p.vatRate),
        purchasePrice: Number(p.purchasePrice),
        salesPrice: Number(p.salesPrice),
        onHand,
        reserved,
        available: onHand - reserved,
      });
      row.getCell('purchasePrice').numFmt = '#,##0.00 ₺';
      row.getCell('salesPrice').numFmt = '#,##0.00 ₺';
      row.getCell('vatRate').numFmt = '0"%"';

      const dataUrl = images.get(p.id);
      if (dataUrl) {
        const [meta, b64] = dataUrl.split(',');
        const ext = meta?.includes('png') ? 'png' : meta?.includes('webp') ? 'png' : 'jpeg';
        const imageId = wb.addImage({ base64: b64!, extension: ext as 'png' | 'jpeg' });
        row.height = 48;
        // Anchored to the cell, so the photo travels with the row when sorted.
        ws.addImage(imageId, {
          tl: { col: 0.1, row: i + 1.1 },
          ext: { width: 56, height: 56 },
          editAs: 'oneCell',
        });
      }
    });

    ws.autoFilter = { from: { row: 1, column: 2 }, to: { row: 1, column: 13 } };
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, fileName: `cora-urunler-${new Date().toISOString().slice(0, 10)}.xlsx`, count: products.length };
  }

  async exportDocuments(q: { type?: 'QUOTE' | 'ORDER' | 'RETURN'; dateFrom?: Date; dateTo?: Date; status?: string; canViewCost: boolean }) {
    const where: Prisma.SalesDocumentWhereInput = {};
    if (q.type) where.type = q.type;
    if (q.status) where.status = q.status as never;
    if (q.dateFrom || q.dateTo) {
      where.date = {};
      if (q.dateFrom) where.date.gte = q.dateFrom;
      if (q.dateTo) where.date.lte = new Date(q.dateTo.getTime() + 86_399_999);
    }
    const docs = await this.prisma.db.salesDocument.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 20000,
      include: {
        partner: { select: { code: true, name: true, city: true } },
        salesRep: { select: { fullName: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { code: true, name: true } } } },
      },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Cora';
    const head = wb.addWorksheet('Belgeler', { views: [{ state: 'frozen', ySplit: 1 }] });
    head.columns = [
      { header: 'Belge', key: 'number', width: 16 },
      { header: 'Tip', key: 'type', width: 10 },
      { header: 'Tarih', key: 'date', width: 12 },
      { header: 'Durum', key: 'status', width: 18 },
      { header: 'Müşteri', key: 'partner', width: 34 },
      { header: 'Şehir', key: 'city', width: 14 },
      { header: 'Temsilci', key: 'rep', width: 20 },
      { header: 'Satır', key: 'lines', width: 8 },
      { header: 'Ara toplam', key: 'subtotal', width: 14 },
      { header: 'KDV', key: 'vat', width: 12 },
      { header: 'Genel toplam', key: 'total', width: 16 },
      ...(q.canViewCost ? [{ header: 'Kâr', key: 'profit', width: 14 }, { header: 'Marj %', key: 'margin', width: 10 }] : []),
    ];
    head.getRow(1).fill = HEAD_FILL;
    head.getRow(1).font = HEAD_FONT;

    for (const d of docs) {
      const row = head.addRow({
        number: d.number, type: d.type, date: d.date, status: d.status,
        partner: d.partner.name, city: d.partner.city ?? '', rep: d.salesRep?.fullName ?? '',
        lines: d.lines.length,
        subtotal: Number(d.subtotal), vat: Number(d.vatTotal), total: Number(d.grandTotal),
        ...(q.canViewCost ? { profit: Number(d.profitLocal), margin: Number(d.marginPct) } : {}),
      });
      row.getCell('date').numFmt = 'dd.mm.yyyy';
      for (const k of ['subtotal', 'vat', 'total', ...(q.canViewCost ? ['profit'] : [])]) row.getCell(k).numFmt = '#,##0.00 ₺';
    }

    const detail = wb.addWorksheet('Satırlar', { views: [{ state: 'frozen', ySplit: 1 }] });
    detail.columns = [
      { header: 'Belge', key: 'number', width: 16 },
      { header: 'Tarih', key: 'date', width: 12 },
      { header: 'Müşteri', key: 'partner', width: 34 },
      { header: 'Ürün kodu', key: 'code', width: 18 },
      { header: 'Ürün', key: 'name', width: 46 },
      { header: 'Miktar', key: 'qty', width: 10 },
      { header: 'Birim fiyat', key: 'price', width: 14 },
      { header: 'İskonto %', key: 'disc', width: 10 },
      { header: 'Tutar', key: 'total', width: 14 },
    ];
    detail.getRow(1).fill = HEAD_FILL;
    detail.getRow(1).font = HEAD_FONT;
    for (const d of docs) {
      for (const l of d.lines) {
        const row = detail.addRow({
          number: d.number, date: d.date, partner: d.partner.name,
          code: l.product?.code ?? '', name: l.description,
          qty: Number(l.qty), price: Number(l.unitPrice), disc: Number(l.discountRate), total: Number(l.lineTotal),
        });
        row.getCell('date').numFmt = 'dd.mm.yyyy';
        row.getCell('price').numFmt = '#,##0.00 ₺';
        row.getCell('total').numFmt = '#,##0.00 ₺';
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, fileName: `cora-belgeler-${new Date().toISOString().slice(0, 10)}.xlsx`, count: docs.length };
  }

  /** Template with the expected headers, so nobody has to guess the format. */
  async template(kind: 'products' | 'partners') {
    const cols = kind === 'products' ? PRODUCT_COLUMNS : PARTNER_COLUMNS;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind === 'products' ? 'Ürünler' : 'Cariler');
    ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, c.label.length + 6) }));
    ws.getRow(1).fill = HEAD_FILL;
    ws.getRow(1).font = HEAD_FONT;
    ws.addRow(
      kind === 'products'
        ? { code: 'CAM-001', name: 'Su Bardağı 200 ml', barcode: '8680000000001', brand: 'Paşabahçe', category: 'Bardak', unit: 'ADET', vatRate: 20, purchasePrice: '12,50', salesPrice: '19,90', minStock: 100, openingStock: 250 }
        : { code: '120.10.0001', name: 'Örnek Otel A.Ş.', type: 'CUSTOMER', taxOffice: 'Antalya', taxNumber: '1234567890', phone: '0242 000 00 00', email: 'muhasebe@ornek.com', city: 'Antalya', district: 'Muratpaşa', address: 'Örnek Mah. 1. Sk. No:1', creditLimit: '250.000,00' },
    );
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, fileName: `cora-${kind}-sablon.xlsx` };
  }

  /* ─────────────────────────────── import ─────────────────────────────── */

  private async readSheet(file: Buffer): Promise<{ headers: string[]; rows: Row[] }> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({ errors: { file: 'Dosya okunamadı — .xlsx bekleniyor' } });
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException({ errors: { file: 'Çalışma sayfası bulunamadı' } });

    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cell.value ?? '').trim();
    });

    const rows: Row[] = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      const obj: Row = {};
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const key = headers[col - 1];
        if (!key) return;
        const v = cell.value;
        obj[key] = v && typeof v === 'object' && 'result' in (v as object) ? (v as { result: unknown }).result : v;
      });
      if (Object.values(obj).some((v) => v !== null && v !== undefined && String(v).trim() !== '')) rows.push(obj);
    });
    return { headers: headers.filter(Boolean), rows };
  }

  /** Suggest a header → field mapping and validate a preview of the rows. */
  async analyze(kind: 'products' | 'partners', file: Buffer) {
    const cols = kind === 'products' ? PRODUCT_COLUMNS : PARTNER_COLUMNS;
    const { headers, rows } = await this.readSheet(file);

    const mapping: Record<string, string | null> = {};
    for (const col of cols) {
      const folded = turkishFold(col.label);
      const hit =
        headers.find((h) => turkishFold(h) === folded) ??
        headers.find((h) => turkishFold(h) === turkishFold(col.key)) ??
        headers.find((h) => turkishFold(h).includes(folded.split(' ')[0]!));
      mapping[col.key] = hit ?? null;
    }
    const preview = rows.slice(0, 20);
    const issues = await this.validate(kind, rows, mapping);

    return {
      columns: cols,
      headers,
      mapping,
      rowCount: rows.length,
      preview,
      issues: issues.slice(0, 50),
      issueCount: issues.length,
      validCount: rows.length - new Set(issues.map((i) => i.row)).size,
    };
  }

  private async validate(kind: 'products' | 'partners', rows: Row[], mapping: Record<string, string | null>) {
    const cols = kind === 'products' ? PRODUCT_COLUMNS : PARTNER_COLUMNS;
    const issues: { row: number; column: string; message: string; value?: string }[] = [];
    const get = (r: Row, key: string) => {
      const header = mapping[key];
      return header ? r[header] : undefined;
    };

    const codes = new Map<string, number>();
    rows.forEach((r, i) => {
      const line = i + 2; // sheet row (1 = header)
      for (const col of cols.filter((c) => c.required)) {
        const v = get(r, col.key);
        if (v === undefined || v === null || String(v).trim() === '') {
          issues.push({ row: line, column: col.label, message: 'Zorunlu alan boş' });
        }
      }
      const code = String(get(r, 'code') ?? '').trim();
      if (code) {
        const seen = codes.get(code);
        if (seen) issues.push({ row: line, column: 'Kod', message: `Dosyada tekrar eden kod (satır ${seen})`, value: code });
        else codes.set(code, line);
      }
      for (const key of ['vatRate', 'purchasePrice', 'salesPrice', 'minStock', 'openingStock', 'creditLimit']) {
        const raw = get(r, key);
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;
        if (parseTrNumber(raw) === null) {
          issues.push({ row: line, column: cols.find((c) => c.key === key)?.label ?? key, message: 'Sayı okunamadı', value: String(raw) });
        }
      }
      const email = get(r, 'email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
        issues.push({ row: line, column: 'E-posta', message: 'Geçersiz e-posta', value: String(email) });
      }
    });

    // existing codes in the database → these become updates, not errors
    const codeList = [...codes.keys()];
    if (codeList.length) {
      const existing = kind === 'products'
        ? await this.prisma.db.product.findMany({ where: { code: { in: codeList } }, select: { code: true } })
        : await this.prisma.db.businessPartner.findMany({ where: { code: { in: codeList } }, select: { code: true } });
      for (const e of existing) {
        const line = codes.get(e.code);
        if (line) issues.push({ row: line, column: 'Kod', message: 'Kayıt zaten var — güncellenecek', value: e.code });
      }
    }
    return issues;
  }

  /**
   * Apply the import. Existing codes are updated, new ones created; a product
   * row with an opening stock also gets a posted goods receipt so the stock
   * ledger stays the only source of on-hand.
   */
  async commit(
    kind: 'products' | 'partners',
    file: Buffer,
    mapping: Record<string, string | null>,
    opts: { warehouseId?: string; dryRun?: boolean } = {},
  ) {
    const { rows } = await this.readSheet(file);
    const get = (r: Row, key: string) => {
      const header = mapping[key];
      const v = header ? r[header] : undefined;
      return v === null || v === undefined ? undefined : String(v).trim();
    };

    let created = 0;
    let updated = 0;
    const failed: { row: number; message: string }[] = [];
    const openingStock: { productId: string; qty: number; cost: number }[] = [];

    for (const [i, r] of rows.entries()) {
      const line = i + 2;
      const code = get(r, 'code');
      const name = get(r, 'name');
      if (!code || !name) {
        failed.push({ row: line, message: 'Kod veya ad boş' });
        continue;
      }
      try {
        if (kind === 'products') {
          const unitCode = get(r, 'unit') ?? 'ADET';
          const unit =
            (await this.prisma.db.unit.findFirst({ where: { code: unitCode } })) ??
            (await this.prisma.db.unit.findFirst({ where: { code: 'ADET' } })) ??
            (await this.prisma.db.unit.findFirst());
          if (!unit) throw new Error('Birim tanımı yok');

          const brandName = get(r, 'brand');
          const brand = brandName
            ? (await this.prisma.db.brand.findFirst({ where: { name: brandName } })) ??
              (await this.prisma.db.brand.create({ data: { name: brandName } as never }))
            : null;
          const categoryName = get(r, 'category');
          const category = categoryName
            ? (await this.prisma.db.category.findFirst({ where: { name: categoryName } })) ??
              (await this.prisma.db.category.create({ data: { name: categoryName } as never }))
            : null;

          const data = {
            name,
            barcode: get(r, 'barcode') ?? null,
            brandId: brand?.id ?? null,
            categoryId: category?.id ?? null,
            unitId: unit.id,
            vatRate: parseTrNumber(get(r, 'vatRate')) ?? 20,
            purchasePrice: parseTrNumber(get(r, 'purchasePrice')) ?? 0,
            salesPrice: parseTrNumber(get(r, 'salesPrice')) ?? 0,
            minStock: parseTrNumber(get(r, 'minStock')) ?? 0,
            searchText: buildSearchText([code, name, get(r, 'barcode'), brandName, categoryName]),
          };
          const existing = await this.prisma.db.product.findFirst({ where: { code }, select: { id: true } });
          if (opts.dryRun) {
            if (existing) updated += 1;
            else created += 1;
            continue;
          }
          let product;
          if (existing) {
            updated += 1;
            product = await this.prisma.db.product.update({ where: { id: existing.id }, data: data as never });
          } else {
            created += 1;
            product = await this.prisma.db.product.create({ data: { code, ...data } as never });
          }

          const opening = parseTrNumber(get(r, 'openingStock'));
          if (opening && opening > 0 && opts.warehouseId) {
            openingStock.push({ productId: product.id, qty: opening, cost: Number(data.purchasePrice) });
          }
        } else {
          const data = {
            name,
            type: (get(r, 'type') ?? 'CUSTOMER').toUpperCase() === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
            taxOffice: get(r, 'taxOffice') ?? null,
            taxNumber: get(r, 'taxNumber') ?? null,
            phone: get(r, 'phone') ?? null,
            email: get(r, 'email') ?? null,
            city: get(r, 'city') ?? null,
            creditLimit: parseTrNumber(get(r, 'creditLimit')) ?? 0,
            searchText: buildSearchText([code, name, get(r, 'taxNumber'), get(r, 'city'), get(r, 'phone')]),
          };
          const existing = await this.prisma.db.businessPartner.findFirst({ where: { code }, select: { id: true } });
          if (opts.dryRun) {
            if (existing) updated += 1;
            else created += 1;
            continue;
          }
          if (existing) {
            updated += 1;
            await this.prisma.db.businessPartner.update({ where: { id: existing.id }, data: data as never });
          } else {
            created += 1;
            const partner = await this.prisma.db.businessPartner.create({ data: { code, ...data } as never });
            const address = get(r, 'address');
            if (address) {
              await this.prisma.db.partnerAddress.create({
                data: { partnerId: partner.id, type: 'SHIPPING', title: 'Merkez', line1: address, district: get(r, 'district') ?? null, city: data.city, isDefault: true } as never,
              });
            }
          }
        }
      } catch (e) {
        failed.push({ row: line, message: (e as Error).message });
      }
    }

    // Opening stock becomes a real, posted goods receipt (rule 8).
    let receiptNumber: string | null = null;
    if (!opts.dryRun && openingStock.length && opts.warehouseId) {
      const receipt = await this.prisma.db.stockReceipt.create({
        data: {
          number: `GIR-ACILIS-${Date.now().toString(36).toUpperCase()}`,
          warehouseId: opts.warehouseId,
          note: 'Excel içe aktarım — açılış stoğu',
          status: 'POSTED',
          postedAt: new Date(),
          totalCost: openingStock.reduce((a, l) => a + l.qty * l.cost, 0),
          lines: { create: openingStock.map((l, i) => ({ lineNo: i + 1, productId: l.productId, qty: l.qty, unitCost: l.cost, lineTotal: l.qty * l.cost })) },
        } as never,
      });
      receiptNumber = receipt.number;
      for (const l of openingStock) {
        await this.prisma.db.stockMovement.create({
          data: { productId: l.productId, warehouseId: opts.warehouseId, qty: l.qty, type: 'RECEIPT', refType: 'STOCK_RECEIPT', refId: receipt.id, unitCost: l.cost, note: 'Açılış stoğu' } as never,
        });
        await this.prisma.db.stockLevel.upsert({
          where: { productId_warehouseId: { productId: l.productId, warehouseId: opts.warehouseId } },
          update: { onHand: { increment: l.qty } },
          create: { productId: l.productId, warehouseId: opts.warehouseId, onHand: l.qty, reserved: 0 },
        });
      }
    }

    if (!opts.dryRun) {
      await this.audit.record({
        entity: kind === 'products' ? 'Product' : 'BusinessPartner',
        entityId: 'import',
        action: 'create',
        diff: { imported: { from: null, to: { created, updated, failed: failed.length, openingStock: openingStock.length } } },
      });
    }

    return { created, updated, failed, failedCount: failed.length, openingStockLines: openingStock.length, receiptNumber };
  }

  /** Failed rows as CSV so the user can fix and re-upload just those. */
  errorCsv(failed: { row: number; message: string }[]): Buffer {
    const lines = ['satir;hata', ...failed.map((f) => `${f.row};"${f.message.replace(/"/g, '""')}"`)];
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
  }
}
