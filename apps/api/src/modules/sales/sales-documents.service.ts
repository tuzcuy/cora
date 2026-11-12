import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculateDocument,
  transition as runTransition,
  availableTransitions as listTransitions,
  TransitionEffect,
  TransitionError,
  type GuardContext,
  type LineInput,
  type Permission,
  type SalesStatus,
} from '@cora/shared';
import { PrismaService, type ExtendedPrismaClient } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import { SettingsService, type SalesSettings } from '../../common/settings/settings.service.js';
import { PriceResolverService } from './price-resolver.service.js';
import { DocumentGuardsService, RESERVING_STATUSES, type GuardResult } from './document-guards.service.js';
import { SalesService } from './sales.service.js';
import type {
  BulkTransitionDto,
  CreateDocumentDto,
  LineInputDto,
  TransitionDto,
  UpdateDocumentDto,
} from './dto/sales-write.dto.js';

/** Interactive-transaction client of the EXTENDED prisma client (tenant-scoped). */
type Tx = Omit<ExtendedPrismaClient, '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;
type DocType = 'QUOTE' | 'ORDER';
const dec = (v: number | string | Prisma.Decimal, dp: number) =>
  new Prisma.Decimal(Number(v).toFixed(dp));

const EDITABLE_FREE = new Set(['DRAFT', 'SENT', 'APPROVAL_PENDING']);
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED']);

const lineInclude = { lines: { orderBy: { lineNo: 'asc' as const } } };
type DocWithLines = Prisma.SalesDocumentGetPayload<{ include: typeof lineInclude }>;

/**
 * Write path for quotes and orders (P04 A/B/D).
 *
 *  - Amounts are NEVER taken from the client: every save rebuilds the lines
 *    through the shared pricing engine (calculateDocument) and stores its result.
 *  - Status is NEVER written directly: transition() from the shared state
 *    machine decides, and its effects (reserve/release/post/create order …)
 *    run here, in the same transaction as the status row, history and audit.
 *  - Guards (stock ATP, credit limit, margin threshold) are evaluated before an
 *    approval; stock blocks, credit/margin route to APPROVAL_PENDING unless the
 *    actor may approve them.
 */
@Injectable()
export class SalesDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: DocumentNumberService,
    private readonly prices: PriceResolverService,
    private readonly guards: DocumentGuardsService,
    private readonly settings: SettingsService,
    private readonly reader: SalesService,
  ) {}

  /* ------------------------------------------------------------ actor */

  private actor() {
    const store = TenantContext.getStore();
    return {
      userId: store?.userId ?? null,
      permissions: (store?.permissions ?? []) as Permission[],
      canViewCost: (store?.permissions ?? []).includes('cost.view' as Permission),
    };
  }

  private requirePermission(p: Permission) {
    if (!this.actor().permissions.includes(p)) throw new ForbiddenException(`Yetki yok: ${p}`);
  }

  /* --------------------------------------------------------- loading */

  private async load(tx: Tx, id: string): Promise<DocWithLines> {
    const doc = await tx.salesDocument.findFirst({ where: { id }, include: lineInclude });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    return doc;
  }

  private assertVersion(doc: { version: number }, expected?: number) {
    if (expected !== undefined && doc.version !== expected) {
      throw new ConflictException({
        error: 'VersionConflict',
        message: 'Belge başkası tarafından değiştirildi. Sayfayı yenileyip tekrar deneyin.',
        currentVersion: doc.version,
      });
    }
  }

  /** Who may edit what: free while DRAFT/SENT/pending; approved orders need order.edit_approved. */
  private assertEditable(doc: DocWithLines, editingLines: boolean) {
    const { permissions } = this.actor();
    if (TERMINAL.has(doc.status)) {
      throw new ConflictException({ error: 'NotEditable', message: 'Kapanmış belge düzenlenemez' });
    }
    const base: Permission = doc.type === 'QUOTE' ? 'quote.write' : 'order.write';
    if (!permissions.includes(base)) throw new ForbiddenException(`Yetki yok: ${base}`);
    if (!EDITABLE_FREE.has(doc.status) && editingLines && !permissions.includes('order.edit_approved')) {
      throw new ForbiddenException('Onaylı belgede satır değişikliği için yetki yok: order.edit_approved');
    }
  }

  /* ------------------------------------------------------ FX freeze */

  /** Rate is frozen on the document at its date (CORA_MIMARI §8); TRY is always 1. */
  private async freezeRate(tx: Tx, currency: string, date: Date) {
    if (currency === 'TRY') return { exchangeRate: 1, rateDate: null as Date | null };
    const row = await tx.exchangeRate.findFirst({
      where: { currency: currency as never, date: { lte: date } },
      orderBy: { date: 'desc' },
    });
    if (!row) {
      throw new BadRequestException({
        error: 'ValidationError',
        message: `${currency} için ${date.toISOString().slice(0, 10)} tarihinde kur bulunamadı`,
        errors: { currency: `${currency} kuru tanımlı değil` },
      });
    }
    return { exchangeRate: Number(row.rate), rateDate: row.date };
  }

  /* -------------------------------------------------------- lines */

  /**
   * Turn editor lines into stored rows: resolve price, snapshot cost, run the
   * pricing engine. lineNo is the array order — the client never numbers.
   */
  private async buildLines(
    tx: Tx,
    inputs: LineInputDto[],
    header: { partnerId: string; currency: string; exchangeRate: number; priceIncludesVat: boolean },
    settings: SalesSettings,
    defaultWarehouseId: string | null,
  ) {
    const productIds = [...new Set(inputs.map((l) => l.productId).filter((v): v is string => !!v))];
    const products = productIds.length
      ? await tx.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, code: true, name: true, salesPrice: true, purchasePrice: true, vatRate: true, unitId: true, packageUnitId: true, packageQty: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      if (!byId.has(id)) {
        throw new BadRequestException({ error: 'ValidationError', message: 'Ürün bulunamadı', errors: { lines: `Ürün bulunamadı: ${id}` } });
      }
    }

    const engineInputs: LineInput[] = [];
    const rows: Prisma.SalesDocumentLineUncheckedCreateInput[] = [];
    for (const [idx, li] of inputs.entries()) {
      const product = li.productId ? byId.get(li.productId)! : null;
      // Unit factor: package unit selected → packageQty, else what the client sent (default 1).
      let unitFactor = li.unitFactor ?? 1;
      if (product && li.unitId && li.unitId === product.packageUnitId && product.packageQty) {
        unitFactor = Number(product.packageQty);
      } else if (product && (!li.unitId || li.unitId === product.unitId)) {
        unitFactor = 1;
      }
      const price = await this.prices.resolve({
        product: product ? { id: product.id, salesPrice: product.salesPrice, purchasePrice: product.purchasePrice, vatRate: product.vatRate } : null,
        partnerId: header.partnerId,
        qty: li.qty,
        unitFactor,
        exchangeRate: header.exchangeRate,
        manualPrice: li.unitPrice,
      });
      const vatRate = li.vatRate ?? price.vatRate ?? settings.defaultVatRate;
      engineInputs.push({
        qty: li.qty,
        unitPrice: price.unitPrice,
        vatRate,
        discountRate: li.discountRate,
        discountAmount: li.discountAmount,
        priceIncludesVat: header.priceIncludesVat,
        unitCostLocal: price.unitCostLocal,
        exchangeRate: header.exchangeRate,
      });
      rows.push({
        documentId: '', // filled by caller
        lineNo: idx + 1,
        productId: product?.id ?? null,
        description: li.description?.trim() || product?.name || 'Satır',
        qty: dec(li.qty, 3),
        unitId: li.unitId ?? product?.unitId ?? null,
        unitFactor: dec(unitFactor, 3),
        unitPrice: dec(price.unitPrice, 4),
        discountRate: dec(li.discountRate ?? 0, 4),
        discountAmount: dec(li.discountAmount ?? 0, 4),
        vatRate: dec(vatRate, 4),
        unitCostLocal: dec(price.unitCostLocal, 4),
        warehouseId: li.warehouseId ?? defaultWarehouseId,
        isPriceOverridden: price.isPriceOverridden,
      });
    }

    const calc = calculateDocument({ lines: engineInputs, exchangeRate: header.exchangeRate, priceIncludesVat: header.priceIncludesVat });
    rows.forEach((r, i) => {
      const c = calc.lines[i]!;
      r.lineNet = dec(c.lineNet.toString(), 4);
      r.lineVat = dec(c.lineVat.toString(), 4);
      r.lineTotal = dec(c.lineTotal.toString(), 4);
      r.lineProfitLocal = dec(c.lineProfitLocal.toString(), 4);
    });
    return { rows, calc };
  }

  private totals(calc: ReturnType<typeof calculateDocument>) {
    return {
      subtotal: dec(calc.subtotal.toString(), 4),
      discountTotal: dec(calc.discountTotal.toString(), 4),
      vatTotal: dec(calc.vatTotal.toString(), 4),
      grandTotal: dec(calc.grandTotal.toString(), 4),
      subtotalLocal: dec(calc.subtotalLocal.toString(), 4),
      vatTotalLocal: dec(calc.vatTotalLocal.toString(), 4),
      grandTotalLocal: dec(calc.grandTotalLocal.toString(), 4),
      costTotalLocal: dec(calc.costTotalLocal.toString(), 4),
      profitLocal: dec(calc.profitLocal.toString(), 4),
      marginPct: dec(calc.marginPct.toString(), 4),
    };
  }

  private async defaultWarehouse(tx: Tx) {
    const wh = (await tx.warehouse.findFirst({ where: { isDefault: true } })) ?? (await tx.warehouse.findFirst());
    return wh?.id ?? null;
  }

  private async history(tx: Tx, documentId: string, from: string | null, to: string, note?: string) {
    await tx.documentStatusHistory.create({
      data: { documentId, fromStatus: from as never, toStatus: to as never, userId: this.actor().userId, note: note ?? null },
    });
  }

  /* ---------------------------------------------------- reservations */

  /** Reservations live in BASE units on StockLevel.reserved and line.reservedQty. */
  private async reserve(tx: Tx, doc: DocWithLines) {
    const wh = await this.defaultWarehouse(tx);
    for (const l of doc.lines) {
      if (!l.productId) continue;
      const base = Number(l.qty) * Number(l.unitFactor || 1);
      const delta = base - Number(l.reservedQty);
      if (delta === 0) continue;
      const warehouseId = l.warehouseId ?? wh;
      if (!warehouseId) throw new ConflictException({ error: 'NoWarehouse', message: 'Depo tanımlı değil' });
      const updated = await tx.stockLevel.updateMany({
        where: { productId: l.productId, warehouseId },
        data: { reserved: { increment: dec(delta, 3) } },
      });
      if (updated.count === 0) {
        await tx.stockLevel.create({ data: { productId: l.productId, warehouseId, onHand: dec(0, 3), reserved: dec(Math.max(delta, 0), 3) } });
      }
      await tx.salesDocumentLine.update({ where: { id: l.id }, data: { reservedQty: dec(base, 3) } });
    }
  }

  private async release(tx: Tx, doc: DocWithLines) {
    const wh = await this.defaultWarehouse(tx);
    for (const l of doc.lines) {
      const reserved = Number(l.reservedQty);
      if (!l.productId || reserved === 0) continue;
      await tx.stockLevel.updateMany({
        where: { productId: l.productId, warehouseId: l.warehouseId ?? wh ?? undefined },
        data: { reserved: { decrement: dec(reserved, 3) } },
      });
      await tx.salesDocumentLine.update({ where: { id: l.id }, data: { reservedQty: dec(0, 3) } });
    }
  }

  /**
   * POST_STOCK_SALE: stock leaves the warehouse — onHand down, reservation
   * consumed, one SALE ledger row per line (INVARIANTS.md rule 8). Shipment
   * documents themselves are P05; this keeps the machine's effect honest.
   */
  /**
   * Customer return (P05): goods come back in through the ledger and the
   * originating order line's returnedQty grows so the same item cannot be
   * returned twice.
   */
  private async postReturn(tx: Tx, doc: DocWithLines) {
    const warehouseId = doc.lines.find((l) => l.warehouseId)?.warehouseId ?? (await this.defaultWarehouse(tx));
    for (const l of doc.lines) {
      if (!l.productId) continue;
      const qty = dec(Number(l.qty) * Number(l.unitFactor), 3);
      await tx.stockMovement.create({
        data: {
          productId: l.productId,
          warehouseId: l.warehouseId ?? warehouseId,
          qty,
          type: 'RETURN_IN',
          refType: 'RETURN',
          refId: doc.id,
          unitCost: l.unitCostLocal,
          note: doc.number,
          userId: TenantContext.getUserId() ?? null,
        } as never,
      });
      await tx.stockLevel.upsert({
        where: { productId_warehouseId: { productId: l.productId, warehouseId: l.warehouseId ?? warehouseId! } },
        update: { onHand: { increment: qty } },
        create: { productId: l.productId, warehouseId: l.warehouseId ?? warehouseId!, onHand: qty, reserved: 0 },
      });
    }
    if (doc.sourceDocumentId) {
      const source = await tx.salesDocument.findFirst({ where: { id: doc.sourceDocumentId }, include: { lines: true } });
      for (const l of doc.lines) {
        const orig = source?.lines.find((x) => x.productId === l.productId);
        if (orig) {
          await tx.salesDocumentLine.update({
            where: { id: orig.id },
            data: { returnedQty: { increment: dec(Number(l.qty) * Number(l.unitFactor), 3) } },
          });
        }
      }
    }
  }

  private async postSale(tx: Tx, doc: DocWithLines) {
    const wh = await this.defaultWarehouse(tx);
    for (const l of doc.lines) {
      if (!l.productId) continue;
      const base = Number(l.qty) * Number(l.unitFactor || 1);
      const remaining = base - Number(l.shippedQty);
      if (remaining <= 0) continue;
      const warehouseId = l.warehouseId ?? wh;
      if (!warehouseId) continue;
      await tx.stockLevel.updateMany({
        where: { productId: l.productId, warehouseId },
        data: { onHand: { decrement: dec(remaining, 3) }, reserved: { decrement: dec(Math.min(remaining, Number(l.reservedQty)), 3) } },
      });
      await tx.stockMovement.create({
        data: {
          productId: l.productId,
          warehouseId,
          qty: dec(-remaining, 3),
          type: 'SALE',
          refType: 'SalesDocument',
          refId: doc.id,
          userId: this.actor().userId,
          note: doc.number,
        } as Prisma.StockMovementUncheckedCreateInput,
      });
      await tx.salesDocumentLine.update({
        where: { id: l.id },
        data: { shippedQty: dec(base, 3), reservedQty: dec(Math.max(0, Number(l.reservedQty) - remaining), 3) },
      });
    }
  }

  /* ---------------------------------------------------------- create */

  async create(dto: CreateDocumentDto) {
    this.requirePermission(dto.type === 'QUOTE' ? 'quote.write' : 'order.write');
    const { userId, canViewCost } = this.actor();
    const id = await this.prisma.db.$transaction(async (tx) => {
      const settings = await this.settings.sales();
      const partner = await tx.businessPartner.findFirst({
        where: { id: dto.partnerId },
        select: { id: true, currency: true, paymentTermDays: true, salesRepId: true, defaultDiscountRate: true },
      });
      if (!partner) throw new BadRequestException({ error: 'ValidationError', message: 'Müşteri bulunamadı', errors: { partnerId: 'Müşteri bulunamadı' } });

      const date = dto.date ?? new Date();
      const currency = dto.currency ?? partner.currency ?? 'TRY';
      const { exchangeRate, rateDate } = await this.freezeRate(tx, currency, date);
      const priceIncludesVat = dto.priceIncludesVat ?? false;
      const wh = await this.defaultWarehouse(tx);
      const { rows, calc } = await this.buildLines(tx, dto.lines, { partnerId: partner.id, currency, exchangeRate, priceIncludesVat }, settings, wh);
      const { number } = await this.numbering.next(tx, dto.type, { year: date.getFullYear() });

      const doc = await tx.salesDocument.create({
        data: {
          type: dto.type,
          number,
          date,
          validUntil:
            dto.type === 'QUOTE'
              ? (dto.validUntil ?? new Date(date.getTime() + settings.quoteValidityDays * 864e5))
              : (dto.validUntil ?? null),
          deliveryDate: dto.deliveryDate ?? null,
          partnerId: partner.id,
          contactId: dto.contactId ?? null,
          shippingAddressId: dto.shippingAddressId ?? null,
          billingAddressId: dto.billingAddressId ?? null,
          salesRepId: dto.salesRepId ?? partner.salesRepId ?? userId,
          currency: currency as never,
          exchangeRate: dec(exchangeRate, 6),
          rateDate,
          priceIncludesVat,
          paymentTerms: dto.paymentTerms ?? (partner.paymentTermDays ? `${partner.paymentTermDays} gün` : null),
          reference: dto.reference ?? null,
          tags: dto.tags ?? [],
          notes: dto.notes ?? null,
          internalNotes: dto.internalNotes ?? null,
          createdById: userId,
          ...this.totals(calc),
          lines: { create: rows.map(({ documentId: _d, ...r }) => r) },
        } as never,
      });
      await this.history(tx, doc.id, null, 'DRAFT', 'Oluşturuldu');
      await this.audit.record({ entity: 'SalesDocument', entityId: doc.id, action: 'create', after: doc as never }, tx);
      return doc.id;
    });
    return this.reader.detail(id, canViewCost);
  }

  /* ---------------------------------------------------------- update */

  async update(id: string, dto: UpdateDocumentDto, expectedVersion: number) {
    const { canViewCost } = this.actor();
    await this.prisma.db.$transaction(async (tx) => {
      const before = await this.load(tx, id);
      this.assertVersion(before, expectedVersion);
      this.assertEditable(before, dto.lines !== undefined);
      const settings = await this.settings.sales();

      const partnerId = dto.partnerId ?? before.partnerId;
      const date = dto.date ?? before.date;
      const currency = dto.currency ?? before.currency;
      const priceIncludesVat = dto.priceIncludesVat ?? before.priceIncludesVat;
      const rateChanged = currency !== before.currency || date.getTime() !== before.date.getTime();
      const fx = rateChanged ? await this.freezeRate(tx, currency, date) : { exchangeRate: Number(before.exchangeRate), rateDate: before.rateDate };

      const header: Prisma.SalesDocumentUncheckedUpdateInput = {
        partnerId,
        date,
        currency: currency as never,
        exchangeRate: dec(fx.exchangeRate, 6),
        rateDate: fx.rateDate,
        priceIncludesVat,
        version: { increment: 1 },
      };
      for (const k of ['validUntil', 'deliveryDate', 'contactId', 'shippingAddressId', 'billingAddressId', 'salesRepId', 'paymentTerms', 'reference', 'tags', 'notes', 'internalNotes'] as const) {
        if (dto[k] !== undefined) (header as Record<string, unknown>)[k] = dto[k];
      }

      const wasReserving = RESERVING_STATUSES.has(before.status);
      if (dto.lines !== undefined || rateChanged || partnerId !== before.partnerId || priceIncludesVat !== before.priceIncludesVat) {
        // Rebuild every line from the editor's rows (or the stored rows when only the header moved).
        const inputs: LineInputDto[] =
          dto.lines ??
          before.lines.map((l) => ({
            productId: l.productId,
            description: l.description,
            qty: Number(l.qty),
            unitId: l.unitId,
            unitFactor: Number(l.unitFactor),
            unitPrice: l.isPriceOverridden ? Number(l.unitPrice) : undefined,
            discountRate: Number(l.discountRate),
            discountAmount: Number(l.discountAmount),
            vatRate: Number(l.vatRate),
            warehouseId: l.warehouseId,
          }));
        if (wasReserving) await this.release(tx, before);
        const wh = await this.defaultWarehouse(tx);
        const { rows, calc } = await this.buildLines(tx, inputs, { partnerId, currency, exchangeRate: fx.exchangeRate, priceIncludesVat }, settings, wh);
        await tx.salesDocumentLine.deleteMany({ where: { documentId: id } });
        if (rows.length) await tx.salesDocumentLine.createMany({ data: rows.map((r) => ({ ...r, documentId: id })) });
        Object.assign(header, this.totals(calc));
      }

      const result = await tx.salesDocument.updateMany({ where: { id, version: expectedVersion }, data: header });
      if (result.count === 0) this.assertVersion({ version: expectedVersion + 1 }, expectedVersion);

      const after = await this.load(tx, id);
      if (wasReserving) {
        // Re-reserve against the new quantities; stock must still cover them.
        const g = await this.guards.evaluate(after, this.actor().permissions);
        if (g.blockers.some((b) => b.code === 'STOCK_SHORT')) this.throwGuard(g);
        await this.reserve(tx, after);
      }
      await this.audit.record({ entity: 'SalesDocument', entityId: id, action: 'update', before: before as never, after: after as never }, tx);
    });
    return this.reader.detail(id, canViewCost);
  }

  /* ---------------------------------------------------------- delete */

  async softDelete(id: string, expectedVersion?: number) {
    return this.prisma.db.$transaction(async (tx) => {
      const doc = await this.load(tx, id);
      this.assertVersion(doc, expectedVersion);
      this.requirePermission(doc.type === 'QUOTE' ? 'quote.write' : 'order.write');
      if (doc.status !== 'DRAFT') {
        throw new ConflictException({ error: 'NotDraft', message: 'Yalnızca taslak belgeler silinebilir; diğerleri iptal edilir' });
      }
      const deletedAt = new Date();
      await tx.salesDocument.updateMany({ where: { id }, data: { deletedAt, version: { increment: 1 } } });
      await this.audit.record({ entity: 'SalesDocument', entityId: id, action: 'delete', before: doc as never, after: { ...doc, deletedAt } as never }, tx);
      return { id, deletedAt };
    });
  }

  /* ------------------------------------------------ copy / revise / convert */

  private async cloneInto(
    tx: Tx,
    src: DocWithLines,
    opts: { type: DocType; number: string; status: SalesStatus; extra?: Partial<Prisma.SalesDocumentUncheckedCreateInput>; note: string },
  ) {
    const settings = await this.settings.sales();
    const date = new Date();
    const fx = await this.freezeRate(tx, src.currency, date);
    const wh = await this.defaultWarehouse(tx);
    const inputs: LineInputDto[] = src.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      qty: Number(l.qty),
      unitId: l.unitId,
      unitFactor: Number(l.unitFactor),
      unitPrice: l.isPriceOverridden ? Number(l.unitPrice) : undefined,
      discountRate: Number(l.discountRate),
      discountAmount: Number(l.discountAmount),
      vatRate: Number(l.vatRate),
      warehouseId: l.warehouseId,
    }));
    const { rows, calc } = await this.buildLines(tx, inputs, { partnerId: src.partnerId, currency: src.currency, exchangeRate: fx.exchangeRate, priceIncludesVat: src.priceIncludesVat }, settings, wh);
    const doc = await tx.salesDocument.create({
      data: {
        type: opts.type,
        number: opts.number,
        date,
        validUntil: opts.type === 'QUOTE' ? new Date(date.getTime() + settings.quoteValidityDays * 864e5) : null,
        deliveryDate: src.deliveryDate,
        partnerId: src.partnerId,
        contactId: src.contactId,
        shippingAddressId: src.shippingAddressId,
        billingAddressId: src.billingAddressId,
        salesRepId: src.salesRepId,
        status: opts.status as never,
        currency: src.currency,
        exchangeRate: dec(fx.exchangeRate, 6),
        rateDate: fx.rateDate,
        priceIncludesVat: src.priceIncludesVat,
        paymentTerms: src.paymentTerms,
        reference: src.reference,
        tags: src.tags,
        notes: src.notes,
        internalNotes: src.internalNotes,
        createdById: this.actor().userId,
        ...this.totals(calc),
        ...(opts.extra ?? {}),
        lines: { create: rows.map(({ documentId: _d, ...r }) => r) },
      } as never,
      include: lineInclude,
    });
    await this.history(tx, doc.id, null, 'DRAFT', opts.note);
    if (opts.status !== 'DRAFT') await this.history(tx, doc.id, 'DRAFT', opts.status, opts.note);
    await this.audit.record({ entity: 'SalesDocument', entityId: doc.id, action: 'create', after: doc as never }, tx);
    return doc;
  }

  /** New DRAFT of the same type, fresh number, no links. */
  async copy(id: string) {
    const { canViewCost } = this.actor();
    const newId = await this.prisma.db.$transaction(async (tx) => {
      const src = await this.load(tx, id);
      this.requirePermission(src.type === 'QUOTE' ? 'quote.write' : 'order.write');
      const { number } = await this.numbering.next(tx, src.type as DocType);
      const doc = await this.cloneInto(tx, src, { type: src.type as DocType, number, status: 'DRAFT', note: `${src.number} kopyalandı` });
      return doc.id;
    });
    return this.reader.detail(newId, canViewCost);
  }

  /**
   * Revision: rev+1 of a quote, number `<base>/R<n>`, chained via revisedFromId.
   * A still-open parent is cancelled through the state machine so only one
   * revision is alive (D-025).
   */
  async revise(id: string, note?: string) {
    const { canViewCost, permissions } = this.actor();
    const newId = await this.prisma.db.$transaction(async (tx) => {
      const src = await this.load(tx, id);
      if (src.type !== 'QUOTE') throw new ConflictException({ error: 'NotQuote', message: 'Yalnızca teklifler revize edilir' });
      this.requirePermission('quote.write');
      if (src.status === 'APPROVED') throw new ConflictException({ error: 'Approved', message: 'Onaylı teklif revize edilemez; siparişi düzenleyin' });
      const base = src.number.replace(/\/R\d+$/, '');
      const revision = src.revision + 1;
      const doc = await this.cloneInto(tx, src, {
        type: 'QUOTE',
        number: `${base}/R${revision}`,
        status: 'DRAFT',
        extra: { revision, revisedFromId: src.id, sourceDocumentId: src.sourceDocumentId },
        note: note ?? `${src.number} revize edildi (R${revision})`,
      });
      if (!TERMINAL.has(src.status)) {
        const r = runTransition({ docType: src.type as DocType, from: src.status as SalesStatus, to: 'CANCELLED', permissions });
        await tx.salesDocument.updateMany({ where: { id: src.id }, data: { status: r.to as never, cancelledAt: new Date(), cancelReason: `Revize edildi → ${doc.number}`, version: { increment: 1 } } });
        await this.history(tx, src.id, src.status, 'CANCELLED', `Revize edildi → ${doc.number}`);
      }
      return doc.id;
    });
    return this.reader.detail(newId, canViewCost);
  }

  /** Explicit quote → order conversion (DRAFT order linked by sourceDocumentId). */
  async convert(id: string, opts: { deliveryDate?: Date | null } = {}) {
    const { canViewCost } = this.actor();
    const newId = await this.prisma.db.$transaction(async (tx) => {
      const src = await this.load(tx, id);
      if (src.type !== 'QUOTE') throw new ConflictException({ error: 'NotQuote', message: 'Yalnızca teklifler siparişe dönüştürülür' });
      this.requirePermission('order.write');
      if (!['DRAFT', 'SENT', 'APPROVED'].includes(src.status)) {
        throw new ConflictException({ error: 'BadStatus', message: `${src.status} durumundaki teklif dönüştürülemez` });
      }
      const existing = await tx.salesDocument.findFirst({ where: { sourceDocumentId: src.id, type: 'ORDER', status: { not: 'CANCELLED' } } });
      if (existing) throw new ConflictException({ error: 'AlreadyConverted', message: `Bu teklif zaten siparişe dönüştürülmüş: ${existing.number}` });
      const { number } = await this.numbering.nextAvailable(tx, 'ORDER', async (n) => !!(await tx.salesDocument.findFirst({ where: { type: 'ORDER', number: n }, select: { id: true } })));
      const doc = await this.cloneInto(tx, src, {
        type: 'ORDER',
        number,
        status: 'DRAFT',
        extra: { sourceDocumentId: src.id, deliveryDate: opts.deliveryDate ?? src.deliveryDate },
        note: `${src.number} teklifinden dönüştürüldü`,
      });
      return doc.id;
    });
    return this.reader.detail(newId, canViewCost);
  }

  /* --------------------------------------------------------- guards */

  async validate(id: string): Promise<GuardResult> {
    const doc = await this.prisma.db.salesDocument.findFirst({ where: { id }, include: lineInclude });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    return this.guards.evaluate(doc, this.actor().permissions);
  }

  private throwGuard(g: GuardResult): never {
    throw new ConflictException({
      error: 'GuardFailed',
      message: g.blockers.map((b) => b.message).join(' · '),
      errors: { _: g.blockers.map((b) => b.message).join(' · ') },
      guard: g,
    });
  }

  /* --------------------------------------------------- transitions */

  /** UI buttons come from here — never a hardcoded list (P04 A3). */
  async availableTransitions(id: string) {
    const doc = await this.prisma.db.salesDocument.findFirst({ where: { id }, include: lineInclude });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    const { permissions } = this.actor();
    const guard = await this.guards.evaluate(doc, permissions);
    const ctx: GuardContext = { ...guard.ctx, validUntil: doc.validUntil, now: new Date() };
    const transitions = listTransitions(doc.type as DocType, doc.status as SalesStatus)
      .filter((t) => t.permission !== null)
      .map((t) => {
        const hasPerm = permissions.includes(t.permission!);
        const reasons: string[] = [];
        if (!hasPerm) reasons.push(`Yetki yok: ${t.permission}`);
        let routesTo: string | undefined;
        let allowed = hasPerm;
        if (t.to === 'APPROVED') {
          if (guard.blockers.length) {
            allowed = false;
            reasons.push(...guard.blockers.map((b) => b.message));
          } else if (guard.needsApproval && doc.status !== 'APPROVAL_PENDING') {
            routesTo = 'APPROVAL_PENDING';
            reasons.push(...guard.warnings.map((w) => w.message));
          }
        } else if (t.guard && !t.guard(ctx)) {
          allowed = false;
          reasons.push('Geçiş koşulu sağlanmıyor');
        }
        return { to: t.to, label: t.label, permission: t.permission, allowed, routesTo, reasons, requiresNote: t.to === 'CANCELLED' };
      });
    return { id: doc.id, status: doc.status, type: doc.type, transitions, guard };
  }

  async transition(
    id: string,
    dto: TransitionDto,
    opts: { skipStockPosting?: boolean } = {},
  ) {
    const { canViewCost, permissions, userId } = this.actor();
    let warnings: GuardResult['warnings'] = [];
    await this.prisma.db.$transaction(async (tx) => {
      const doc = await this.load(tx, id);
      this.assertVersion(doc, dto.version);
      const from = doc.status as SalesStatus;
      let to = dto.toStatus as SalesStatus;
      if (to === 'CANCELLED' && !dto.note?.trim()) {
        throw new BadRequestException({ error: 'ValidationError', message: 'İptal sebebi zorunlu', errors: { note: 'İptal sebebi zorunlu' } });
      }

      let ctx: GuardContext = { now: new Date(), validUntil: doc.validUntil };
      if (to === 'APPROVED') {
        const g = await this.guards.evaluate(doc, permissions);
        warnings = g.warnings;
        if (g.blockers.length) this.throwGuard(g);
        ctx = { ...ctx, ...g.ctx };
        // Route to manager approval when the actor cannot accept the warnings.
        if (g.needsApproval && from !== 'APPROVAL_PENDING') to = 'APPROVAL_PENDING';
      }

      let result: { to: SalesStatus; effects: TransitionEffect[] };
      try {
        result = runTransition({ docType: doc.type as DocType, from, to, permissions, guardContext: ctx });
      } catch (e) {
        if (e instanceof TransitionError) {
          if (e.code === 'FORBIDDEN') throw new ForbiddenException(e.message);
          throw new ConflictException({ error: e.code, message: e.message });
        }
        throw e;
      }

      const data: Prisma.SalesDocumentUncheckedUpdateInput = { status: result.to as never, version: { increment: 1 } };
      for (const effect of result.effects) {
        switch (effect) {
          case TransitionEffect.SET_SENT_AT: data.sentAt = new Date(); break;
          case TransitionEffect.SET_APPROVED_AT: data.approvedAt = new Date(); data.approvedById = userId; break;
          case TransitionEffect.SET_CANCELLED_AT: data.cancelledAt = new Date(); data.cancelReason = dto.note ?? null; break;
          case TransitionEffect.RESERVE_STOCK:
            if (doc.type === 'ORDER') await this.reserve(tx, doc);
            break;
          case TransitionEffect.RELEASE_RESERVATION: await this.release(tx, doc); break;
          case TransitionEffect.POST_STOCK_SALE:
            // The delivery note already wrote the SALE movements for what left.
            if (!opts.skipStockPosting) await this.postSale(tx, doc);
            break;
          case TransitionEffect.POST_STOCK_RETURN:
            if (!opts.skipStockPosting) await this.postReturn(tx, doc);
            break;
          case TransitionEffect.ENQUEUE_WAREHOUSE:
            await tx.warehouseTask.upsert({
              where: { orderId: doc.id },
              update: {},
              create: { orderId: doc.id, warehouseId: doc.lines[0]?.warehouseId ?? (await this.defaultWarehouse(tx)), status: 'PENDING' },
            });
            break;
          case TransitionEffect.START_WAREHOUSE_TASK:
            await tx.warehouseTask.updateMany({ where: { orderId: doc.id }, data: { status: 'PICKING', startedAt: new Date() } });
            break;
          case TransitionEffect.SET_READY_AT:
            await tx.warehouseTask.updateMany({ where: { orderId: doc.id }, data: { status: 'READY', readyAt: new Date() } });
            break;
          case TransitionEffect.CREATE_ORDER: {
            // Quote approved → an APPROVED order with reservations, linked by sourceDocumentId.
            const { number } = await this.numbering.nextAvailable(tx, 'ORDER', async (n) => !!(await tx.salesDocument.findFirst({ where: { type: 'ORDER', number: n }, select: { id: true } })));
            const order = await this.cloneInto(tx, doc, {
              type: 'ORDER', number, status: 'APPROVED',
              extra: { sourceDocumentId: doc.id, approvedAt: new Date(), approvedById: userId },
              note: `${doc.number} onaylandı`,
            });
            await this.reserve(tx, order);
            const settings = await this.settings.sales();
            if (settings.autoSendToWarehouse) {
              const r2 = runTransition({ docType: 'ORDER', from: 'APPROVED', to: 'SENT_TO_WAREHOUSE', permissions: ['order.write'] });
              await tx.salesDocument.updateMany({ where: { id: order.id }, data: { status: r2.to as never } });
              await tx.warehouseTask.upsert({
                where: { orderId: order.id },
                update: {},
                create: { orderId: order.id, warehouseId: order.lines[0]?.warehouseId ?? (await this.defaultWarehouse(tx)), status: 'PENDING' },
              });
              await this.history(tx, order.id, 'APPROVED', 'SENT_TO_WAREHOUSE', 'Otomatik depoya iletildi');
            }
            break;
          }
        }
      }
      await tx.salesDocument.updateMany({ where: { id }, data });
      await this.history(tx, id, from, result.to, dto.note);
      await this.audit.record({ entity: 'SalesDocument', entityId: id, action: `status:${result.to}`, diff: { status: { from, to: result.to }, note: dto.note ?? null } }, tx);
    });
    const detail = await this.reader.detail(id, canViewCost);
    return { ...detail, warnings };
  }

  async bulkTransition(dto: BulkTransitionDto) {
    const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];
    for (const id of dto.ids) {
      try {
        const r = await this.transition(id, { toStatus: dto.toStatus, note: dto.note });
        results.push({ id, ok: true, status: (r as Record<string, unknown>).status as string });
      } catch (e) {
        const msg = (e as { message?: string; getResponse?: () => unknown }).getResponse?.() ?? (e as Error).message;
        results.push({ id, ok: false, error: typeof msg === 'string' ? msg : ((msg as { message?: string }).message ?? 'Hata') });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }
}
