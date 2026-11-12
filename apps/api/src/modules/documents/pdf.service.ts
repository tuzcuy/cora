import { Injectable, NotFoundException } from '@nestjs/common';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { FilesService } from '../files/files.service.js';

// The API compiles to CommonJS, so resolve from this file's own path.
const require_ = createRequire(pathToFileURL(__filename).href);
/* eslint-disable @typescript-eslint/no-explicit-any */
const PdfPrinter = require_('pdfmake/src/printer.js') as any;
type Doc = Record<string, any>;

/**
 * Fonts come from pdfmake's own bundle as base64 (Roboto covers Turkish), so
 * there is no font file to ship, no runtime download and no Chromium (D-013).
 */
const vfsModule = require_('pdfmake/build/vfs_fonts.js') as any;
const vfs: Record<string, string> = vfsModule.pdfMake?.vfs ?? vfsModule.vfs ?? vfsModule;
const ttf = (name: string) => Buffer.from(vfs[name]!, 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: ttf('Roboto-Regular.ttf'),
    bold: ttf('Roboto-Medium.ttf'),
    italics: ttf('Roboto-Italic.ttf'),
    bolditalics: ttf('Roboto-MediumItalic.ttf'),
  },
});

const tl = (v: unknown, currency = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(v ?? 0));
const num = (v: unknown, dp = 0) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v ?? 0));
const day = (v: Date | string | null | undefined) => (v ? new Date(v).toLocaleDateString('tr-TR') : '—');

const TITLE: Record<string, string> = { QUOTE: 'TEKLİF', ORDER: 'SİPARİŞ FORMU', RETURN: 'İADE BELGESİ' };
const GREY = '#6b7280';
const INK = '#111827';

/**
 * PDF output (P06) with a pure-JS renderer — no Chromium anywhere in the stack
 * (D-013). Quote/order, delivery note and warehouse pick list share one header
 * and footer so the documents look like one family.
 */
@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  /* ───────────────────────────── company block ───────────────────────────── */

  private async company() {
    const rows = await this.prisma.db.setting.findMany({
      where: { key: { in: ['company', 'bank'] } },
      select: { key: true, value: true },
    });
    const bag = Object.fromEntries(rows.map((r) => [r.key, r.value as Record<string, unknown>]));
    const tenant = await this.prisma.db.tenant.findFirst({ select: { name: true } });
    const c = (bag.company ?? {}) as Record<string, string>;
    const b = (bag.bank ?? {}) as Record<string, string>;
    return {
      name: c.name ?? tenant?.name ?? 'Cora',
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      web: c.web ?? '',
      taxOffice: c.taxOffice ?? '',
      taxNumber: c.taxNumber ?? '',
      logo: typeof c.logo === 'string' && c.logo.startsWith('data:image') ? c.logo : null,
      bankName: b.name ?? '',
      bankBranch: b.branch ?? '',
      iban: b.iban ?? '',
      accountName: b.accountName ?? '',
    };
  }

  private header(company: Awaited<ReturnType<PdfService['company']>>, title: string, right: [string, string][]): Doc {
    const left: Doc[] = [];
    if (company.logo) left.push({ image: company.logo, fit: [140, 44], margin: [0, 0, 0, 6] });
    left.push({ text: company.name, style: 'company' });
    const lines = [
      company.address,
      [company.phone, company.email].filter(Boolean).join(' · '),
      company.taxOffice || company.taxNumber ? `VD: ${company.taxOffice} · VKN: ${company.taxNumber}` : '',
    ].filter(Boolean);
    for (const l of lines) left.push({ text: l, style: 'small' });

    return {
      columns: [
        { width: '*', stack: left },
        {
          width: 'auto',
          stack: [
            { text: title, style: 'docTitle' },
            {
              table: {
                body: right.map(([k, v]) => [
                  { text: k, style: 'small', alignment: 'right' },
                  { text: v, style: 'smallBold', alignment: 'right' },
                ]),
              },
              layout: 'noBorders',
              margin: [0, 4, 0, 0],
            },
          ],
        },
      ],
      margin: [0, 0, 0, 12],
    };
  }

  private partyBox(title: string, lines: string[]): Doc {
    return {
      stack: [
        { text: title, style: 'boxTitle' },
        ...lines.filter(Boolean).map((l, i) => ({ text: l, style: i === 0 ? 'boxName' : 'small' })),
      ],
      margin: [0, 0, 0, 10],
    };
  }

  private async render(docDefinition: Doc): Promise<Buffer> {
    const pdf = printer.createPdfKitDocument({
      pageSize: 'A4',
      pageMargins: [36, 40, 36, 54],
      defaultStyle: { font: 'Roboto', fontSize: 9, color: INK },
      styles: {
        company: { fontSize: 14, bold: true },
        docTitle: { fontSize: 18, bold: true, alignment: 'right' },
        boxTitle: { fontSize: 8, bold: true, color: GREY, margin: [0, 0, 0, 2] },
        boxName: { fontSize: 11, bold: true },
        small: { fontSize: 8, color: GREY },
        smallBold: { fontSize: 9, bold: true },
        th: { fontSize: 8, bold: true, color: GREY },
        total: { fontSize: 12, bold: true },
        note: { fontSize: 8, color: GREY },
      },
      footer: (page: number, pages: number) => ({
        columns: [
          { text: 'Cora · Corant Soft', style: 'note', margin: [36, 0, 0, 0] },
          { text: `Sayfa ${page} / ${pages}`, style: 'note', alignment: 'right', margin: [0, 0, 36, 0] },
        ],
        margin: [0, 10, 0, 0],
      }),
      ...docDefinition,
    });
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });
  }

  /* ──────────────────────────── quote / order ───────────────────────────── */

  async salesDocument(id: string, opts: { withImages?: boolean } = {}): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.prisma.db.salesDocument.findFirst({
      where: { id },
      include: {
        partner: true,
        salesRep: { select: { fullName: true, email: true, phone: true } },
        shippingAddress: true,
        billingAddress: true,
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } } },
      },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadı');

    const company = await this.company();
    const sales = await this.settings.sales();
    const images = opts.withImages
      ? await this.files.dataUrlsForProducts(doc.lines.map((l) => l.productId).filter((v): v is string => !!v))
      : new Map<string, string>();
    const showImages = images.size > 0;

    const right: [string, string][] = [
      ['Belge No', doc.number],
      ['Tarih', day(doc.date)],
    ];
    if (doc.revision > 1) right.push(['Revizyon', String(doc.revision)]);
    if (doc.type === 'QUOTE') right.push(['Geçerlilik', doc.validUntil ? day(doc.validUntil) : `${sales.quoteValidityDays} gün`]);
    if (doc.deliveryDate) right.push(['Teslim', day(doc.deliveryDate)]);
    if (doc.reference) right.push(['Referans', doc.reference]);

    const addr = doc.billingAddress ?? doc.shippingAddress;
    const head = [
      { text: '#', style: 'th' },
      ...(showImages ? [{ text: '', style: 'th' }] : []),
      { text: 'Kod', style: 'th' },
      { text: 'Açıklama', style: 'th' },
      { text: 'Miktar', style: 'th', alignment: 'right' },
      { text: 'Birim Fiyat', style: 'th', alignment: 'right' },
      { text: 'İsk.', style: 'th', alignment: 'right' },
      { text: 'KDV', style: 'th', alignment: 'right' },
      { text: 'Tutar', style: 'th', alignment: 'right' },
    ];
    const body = [head, ...doc.lines.map((l, i) => {
      const img = l.productId ? images.get(l.productId) : undefined;
      return [
        { text: String(i + 1), fontSize: 8, color: GREY },
        ...(showImages ? [img ? { image: img, fit: [28, 28] } : { text: '' }] : []),
        { text: l.product?.code ?? '', fontSize: 8 },
        { text: l.description },
        { text: `${num(l.qty)} ${l.product?.unit?.code ?? ''}`, alignment: 'right' },
        { text: tl(l.unitPrice, doc.currency), alignment: 'right' },
        { text: Number(l.discountRate) ? `%${num(l.discountRate, 0)}` : Number(l.discountAmount) ? tl(l.discountAmount, doc.currency) : '—', alignment: 'right' },
        { text: `%${num(l.vatRate, 0)}`, alignment: 'right' },
        { text: tl(l.lineTotal, doc.currency), alignment: 'right' },
      ];
    })];

    const vatByRate = new Map<string, number>();
    for (const l of doc.lines) {
      const k = num(l.vatRate, 0);
      vatByRate.set(k, (vatByRate.get(k) ?? 0) + Number(l.lineVat));
    }

    const totals: Doc[][] = [
      [{ text: 'Ara toplam', style: 'small' }, { text: tl(doc.subtotal, doc.currency), alignment: 'right' }],
      [{ text: 'İskonto', style: 'small' }, { text: tl(doc.discountTotal, doc.currency), alignment: 'right' }],
      ...[...vatByRate.entries()].map(([rate, amount]): Doc[] => [
        { text: `KDV %${rate}`, style: 'small' },
        { text: tl(amount, doc.currency), alignment: 'right' },
      ]),
      [{ text: 'Genel toplam', style: 'total' }, { text: tl(doc.grandTotal, doc.currency), style: 'total', alignment: 'right' }],
    ];
    if (doc.currency !== 'TRY') {
      totals.push([{ text: `Kur ${num(doc.exchangeRate, 4)} · TRY karşılığı`, style: 'small' }, { text: tl(doc.grandTotalLocal), alignment: 'right' }]);
    }

    const footerBits: Doc[] = [];
    if (doc.paymentTerms) footerBits.push({ text: `Ödeme koşulu: ${doc.paymentTerms}`, style: 'small' });
    if (company.iban) {
      footerBits.push({ text: `Banka: ${[company.bankName, company.bankBranch].filter(Boolean).join(' / ')}`, style: 'small' });
      footerBits.push({ text: `IBAN: ${company.iban}${company.accountName ? ` · ${company.accountName}` : ''}`, style: 'small' });
    }
    if (doc.type === 'QUOTE') {
      footerBits.push({ text: `Bu teklif ${doc.validUntil ? day(doc.validUntil) : `${sales.quoteValidityDays} gün`} tarihine kadar geçerlidir.`, style: 'small' });
    }
    if (doc.notes) footerBits.push({ text: doc.notes, style: 'small', margin: [0, 4, 0, 0] });

    const content: Doc[] = [
      this.header(company, TITLE[doc.type] ?? 'BELGE', right),
      {
        columns: [
          this.partyBox('MÜŞTERİ', [
            doc.partner.name,
            addr ? [addr.line1, addr.district, addr.city].filter(Boolean).join(', ') : (doc.partner.city ?? ''),
            doc.partner.taxOffice || doc.partner.taxNumber ? `VD: ${doc.partner.taxOffice ?? ''} · VKN: ${doc.partner.taxNumber ?? ''}` : '',
            doc.partner.phone ?? '',
          ]),
          this.partyBox('SATIŞ TEMSİLCİSİ', [
            doc.salesRep?.fullName ?? '—',
            doc.salesRep?.email ?? '',
            doc.salesRep?.phone ?? '',
          ]),
        ],
        columnGap: 16,
      },
      {
        table: {
          headerRows: 1,
          widths: showImages
            ? [14, 32, 52, '*', 46, 58, 38, 28, 62]
            : [14, 52, '*', 46, 58, 38, 28, 62],
          body,
        },
        layout: {
          hLineWidth: (i: number, node: Doc) => (i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? '#9ca3af' : '#e5e7eb'),
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
      {
        columns: [
          { width: '*', stack: footerBits, margin: [0, 12, 12, 0] },
          {
            width: 'auto',
            table: { body: totals },
            layout: 'noBorders',
            margin: [0, 12, 0, 0],
          },
        ],
      },
    ];

    const buffer = await this.render({ content, info: { title: doc.number, author: company.name } });
    return { buffer, fileName: `${doc.number.replace(/\//g, '-')}.pdf` };
  }

  /* ───────────────────────────── delivery note ──────────────────────────── */

  async shipment(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const s = await this.prisma.db.shipment.findFirst({
      where: { id },
      include: {
        partner: true,
        warehouse: true,
        order: { select: { number: true, date: true, reference: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { code: true, name: true, unit: { select: { code: true } } } } } },
      },
    });
    if (!s) throw new NotFoundException('İrsaliye bulunamadı');
    const company = await this.company();
    const addr = (s.shippingAddress ?? {}) as Record<string, string>;

    const content: Doc[] = [
      this.header(company, 'SEVK İRSALİYESİ', [
        ['İrsaliye No', s.number],
        ['Tarih', day(s.date)],
        ['Sipariş', s.order?.number ?? '—'],
        ['ETTN', s.ublUuid ? s.ublUuid.slice(0, 8) + '…' : '—'],
      ]),
      {
        columns: [
          this.partyBox('ALICI', [
            s.partner.name,
            [addr.line1, addr.district, addr.city].filter(Boolean).join(', ') || (s.partner.city ?? ''),
            s.partner.taxOffice || s.partner.taxNumber ? `VD: ${s.partner.taxOffice ?? ''} · VKN: ${s.partner.taxNumber ?? ''}` : '',
          ]),
          this.partyBox('TAŞIMA', [
            s.carrier ?? s.carrierTitle ?? '—',
            s.vehiclePlate ? `Plaka: ${s.vehiclePlate}${s.trailerPlate ? ` / ${s.trailerPlate}` : ''}` : '',
            s.driverName ? `Sürücü: ${s.driverName}` : '',
            s.packageCount ? `Koli: ${s.packageCount}${s.grossWeightKg ? ` · ${num(s.grossWeightKg, 1)} kg` : ''}` : '',
            `Depo: ${s.warehouse.name}`,
          ]),
        ],
        columnGap: 16,
      },
      {
        table: {
          headerRows: 1,
          widths: [16, 70, '*', 70],
          body: [
            [
              { text: '#', style: 'th' }, { text: 'Kod', style: 'th' },
              { text: 'Mal / Hizmet', style: 'th' }, { text: 'Miktar', style: 'th', alignment: 'right' },
            ],
            ...s.lines.map((l, i) => [
              { text: String(i + 1), fontSize: 8, color: GREY },
              { text: l.product.code, fontSize: 8 },
              { text: l.product.name },
              { text: `${num(l.qty)} ${l.product.unit?.code ?? ''}`, alignment: 'right' },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i: number, node: Doc) => (i <= 1 || i === node.table.body.length ? 0.7 : 0.3),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? '#9ca3af' : '#e5e7eb'),
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      },
      { text: s.notes ?? '', style: 'small', margin: [0, 10, 0, 0] },
      {
        columns: [
          { width: '*', stack: [{ text: 'Teslim eden', style: 'small' }, { text: '\n\n___________________', style: 'small' }] },
          { width: '*', stack: [{ text: 'Teslim alan', style: 'small' }, { text: '\n\n___________________', style: 'small' }] },
        ],
        margin: [0, 24, 0, 0],
      },
      { text: 'Bu belge e-İrsaliye alanlarıyla üretilmiştir; entegratöre gönderim P09 kapsamındadır.', style: 'note', margin: [0, 16, 0, 0] },
    ];

    const buffer = await this.render({ content, info: { title: s.number, author: company.name } });
    return { buffer, fileName: `${s.number}.pdf` };
  }

  /* ──────────────────────────── warehouse pick list ─────────────────────── */

  async pickList(orderId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const order = await this.prisma.db.salesDocument.findFirst({
      where: { id: orderId, type: 'ORDER' },
      include: {
        partner: { select: { name: true, city: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            product: { select: { code: true, name: true, barcode: true, unit: { select: { code: true } } } },
            warehouse: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    const company = await this.company();

    const content: Doc[] = [
      this.header(company, 'TOPLAMA LİSTESİ', [
        ['Sipariş', order.number],
        ['Tarih', day(order.date)],
        ['Teslim', day(order.deliveryDate)],
      ]),
      { text: `${order.partner.name}${order.partner.city ? ` · ${order.partner.city}` : ''}`, style: 'boxName', margin: [0, 0, 0, 8] },
      {
        table: {
          headerRows: 1,
          widths: [16, 70, '*', 80, 44, 44, 30],
          body: [
            [
              { text: '#', style: 'th' }, { text: 'Kod', style: 'th' }, { text: 'Ürün', style: 'th' },
              { text: 'Barkod', style: 'th' }, { text: 'Depo', style: 'th' },
              { text: 'Miktar', style: 'th', alignment: 'right' }, { text: '✓', style: 'th', alignment: 'center' },
            ],
            ...order.lines.map((l, i) => [
              { text: String(i + 1), fontSize: 8, color: GREY },
              { text: l.product?.code ?? '', fontSize: 8 },
              { text: l.description },
              { text: l.product?.barcode ?? '—', fontSize: 8, color: GREY },
              { text: l.warehouse?.code ?? '—', fontSize: 8 },
              { text: `${num(Number(l.qty) * Number(l.unitFactor))} ${l.product?.unit?.code ?? ''}`, alignment: 'right' },
              { text: '☐', alignment: 'center' },
            ]),
          ],
        },
        layout: {
          hLineWidth: (i: number, node: Doc) => (i <= 1 || i === node.table.body.length ? 0.7 : 0.3),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? '#9ca3af' : '#e5e7eb'),
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      },
      { text: 'Toplayan: ______________________     Tarih/Saat: ______________', style: 'small', margin: [0, 24, 0, 0] },
    ];

    const buffer = await this.render({ content, info: { title: `${order.number} toplama`, author: company.name } });
    return { buffer, fileName: `${order.number}-toplama.pdf` };
  }
}
