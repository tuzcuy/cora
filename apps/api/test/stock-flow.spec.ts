/**
 * P05 proof: goods receipt → ledger, adjustment with reason, transfer,
 * count variance, picking (incl. barcode scan), partial shipment, return.
 * Real Postgres via TEST_DATABASE_URL, throwaway tenant, cleaned in afterAll.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
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
import { StockService } from '../src/modules/stock/stock.service.js';
import { ShipmentsService } from '../src/modules/shipments/shipments.service.js';
import { ReturnsService } from '../src/modules/shipments/returns.service.js';
import { PickingService } from '../src/modules/warehouse/picking.service.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const DB_URL = process.env.TEST_DATABASE_URL;
const dbDescribe = DB_URL ? describe : describe.skip;

const ALL: Permission[] = [
  'quote.read', 'quote.write', 'quote.approve', 'order.read', 'order.write', 'order.cancel',
  'stock.read', 'stock.receive', 'stock.adjust', 'stock.transfer', 'stock.count',
  'warehouse.pick', 'shipment.create', 'shipment.post', 'shipment.cancel', 'return.write',
  'sales.approve_low_margin', 'partner.override_credit', 'cost.view', 'product.read', 'partner.read',
];
const PICKER: Permission[] = ['order.read', 'stock.read', 'warehouse.pick'];

dbDescribe('P05 — stok, depo, sevkiyat', () => {
  const base = new PrismaClient({ adapter: new PrismaPg(DB_URL!) });
  const db = base.$extends(tenantExtension());
  const prismaSvc = { db } as unknown as PrismaService;
  const slug = randomUUID().slice(0, 8);
  let T = '', userId = '', partnerId = '', supplierId = '';
  let whMain = '', whSide = '', unitId = '';
  let pA = '', pB = '';
  let stock: StockService;
  let sales: SalesDocumentsService;
  let ships: ShipmentsService;
  let returns: ReturnsService;
  let picking: PickingService;

  const as = <R>(perms: Permission[], fn: () => Promise<R>) =>
    TenantContext.runAsync({ tenantId: T, userId, permissions: perms }, fn);
  const sys = <R>(fn: () => Promise<R>) => TenantContext.runSystem(fn);
  const level = (productId: string, warehouseId = whMain) =>
    as(ALL, () => db.stockLevel.findFirst({ where: { productId, warehouseId } }));
  const onHand = async (productId: string, warehouseId = whMain) => Number((await level(productId, warehouseId))?.onHand ?? 0);

  beforeAll(async () => {
    await base.$connect();
    const t = await sys(() => db.tenant.create({ data: { name: `P05 ${slug}`, slug: `p05-${slug}` } }));
    T = t.id;
    const u = await sys(() => db.user.create({ data: { tenantId: T, email: `p05-${slug}@test.local`, passwordHash: 'x', fullName: 'P05 Test' } }));
    userId = u.id;
    await as(ALL, async () => {
      const unit = await db.unit.create({ data: { code: 'ADET', name: 'Adet' } as never });
      unitId = unit.id;
      whMain = (await db.warehouse.create({ data: { code: 'MERKEZ', name: 'Merkez', isDefault: true } as never })).id;
      whSide = (await db.warehouse.create({ data: { code: 'SUBE', name: 'Şube' } as never })).id;
      partnerId = (await db.businessPartner.create({ data: { code: `C${slug}`, name: 'Test Otel', type: 'CUSTOMER', creditLimit: 1_000_000 } as never })).id;
      supplierId = (await db.businessPartner.create({ data: { code: `S${slug}`, name: 'Test Tedarikçi', type: 'SUPPLIER' } as never })).id;
      const mk = async (code: string, barcode: string) =>
        (await db.product.create({
          data: { code, name: `Ürün ${code}`, unitId, salesPrice: 100, purchasePrice: 40, vatRate: 20, barcode } as never,
        })).id;
      pA = await mk(`A${slug}`, `868${slug}A`);
      pB = await mk(`B${slug}`, `868${slug}B`);
    });

    const audit = new AuditService(prismaSvc);
    const numbers = new DocumentNumberService(prismaSvc);
    const settings = new SettingsService(prismaSvc);
    const reader = new SalesService(prismaSvc);
    stock = new StockService(prismaSvc, audit, numbers);
    sales = new SalesDocumentsService(
      prismaSvc, audit, numbers, new PriceResolverService(),
      new DocumentGuardsService(prismaSvc, settings), settings, reader,
    );
    ships = new ShipmentsService(prismaSvc, audit, numbers, sales);
    returns = new ReturnsService(prismaSvc, audit, numbers, reader);
    picking = new PickingService(prismaSvc, audit, sales);
  });

  afterAll(async () => {
    if (!T) return;
    await sys(async () => {
      await db.shipmentLine.deleteMany({ where: { shipment: { tenantId: T } } });
      await db.shipment.deleteMany({ where: { tenantId: T } });
      await db.documentStatusHistory.deleteMany({ where: { document: { tenantId: T } } });
      await db.warehouseTask.deleteMany({ where: { order: { tenantId: T } } });
      await db.salesDocumentLine.deleteMany({ where: { document: { tenantId: T } } });
      await db.salesDocument.deleteMany({ where: { tenantId: T } });
      await db.stockCountLine.deleteMany({ where: { count: { tenantId: T } } });
      await db.stockCount.deleteMany({ where: { tenantId: T } });
      await db.stockReceiptLine.deleteMany({ where: { receipt: { tenantId: T } } });
      await db.stockReceipt.deleteMany({ where: { tenantId: T } });
      await db.stockMovement.deleteMany({ where: { tenantId: T } });
      await db.stockLevel.deleteMany({ where: { warehouseId: { in: [whMain, whSide] } } });
      await db.productPriceHistory.deleteMany({ where: { product: { tenantId: T } } });
      await db.product.deleteMany({ where: { tenantId: T } });
      await db.unit.deleteMany({ where: { tenantId: T } });
      await db.warehouse.deleteMany({ where: { tenantId: T } });
      await db.businessPartner.deleteMany({ where: { tenantId: T } });
      await db.auditLog.deleteMany({ where: { tenantId: T } });
      await db.documentSequence.deleteMany({ where: { tenantId: T } });
      await db.user.deleteMany({ where: { tenantId: T } });
      await db.tenant.delete({ where: { id: T } });
    });
    await base.$disconnect();
  });

  it('giriş fişi işlenince stok artar, ortalama maliyet güncellenir, ledger yazılır', async () => {
    const r = await as(ALL, () => stock.createReceipt({
      warehouseId: whMain, supplierId,
      lines: [
        { productId: pA, qty: 100, unitCost: 50, unitFactor: 1 },
        { productId: pB, qty: 40, unitCost: 25, unitFactor: 1 },
      ],
    } as never));
    expect(r.number).toMatch(/^GIR\d{4}-\d{4}$/);
    expect(r.status).toBe('DRAFT');
    expect(await onHand(pA)).toBe(0); // draft moves nothing

    const posted = await as(ALL, () => stock.postReceipt(r.id));
    expect(posted.status).toBe('POSTED');
    expect(await onHand(pA)).toBe(100);
    expect(await onHand(pB)).toBe(40);

    // first receipt into empty stock sets the cost outright
    const prod = await as(ALL, () => db.product.findFirst({ where: { id: pA } }));
    expect(Number(prod!.purchasePrice)).toBe(50);

    const moves = await as(ALL, () => db.stockMovement.findMany({ where: { refId: r.id } }));
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.type === 'RECEIPT')).toBe(true);
  });

  it('ikinci giriş ağırlıklı ortalama maliyeti hesaplar', async () => {
    const r = await as(ALL, () => stock.createReceipt({ warehouseId: whMain, lines: [{ productId: pA, qty: 100, unitCost: 70, unitFactor: 1 }] } as never));
    await as(ALL, () => stock.postReceipt(r.id));
    // 100 @50 + 100 @70 → 60
    const prod = await as(ALL, () => db.product.findFirst({ where: { id: pA } }));
    expect(Number(prod!.purchasePrice)).toBeCloseTo(60, 2);
    expect(await onHand(pA)).toBe(200);
  });

  it('işlenmiş fiş silinemez, taslak fiş silinir', async () => {
    const posted = await as(ALL, () => db.stockReceipt.findFirst({ where: { status: 'POSTED' } }));
    const del = await as(ALL, () => stock.deleteReceipt(posted!.id)).catch((e) => e);
    expect(JSON.stringify(del.getResponse?.() ?? del.message)).toMatch(/İşlenmiş fiş silinemez/);
    const draft = await as(ALL, () => stock.createReceipt({ warehouseId: whMain, lines: [{ productId: pB, qty: 1, unitCost: 1, unitFactor: 1 }] } as never));
    await expect(as(ALL, () => stock.deleteReceipt(draft.id))).resolves.toEqual({ ok: true });
  });

  it('düzeltme sebep ister ve ledger’a işaretlenir', async () => {
    const before = await onHand(pB);
    const res = await as(ALL, () => stock.adjust({ productId: pB, warehouseId: whMain, qty: -5, reason: 'Kırık ürün' }));
    expect(Number(res.onHand)).toBe(before - 5);
    const m = await as(ALL, () => db.stockMovement.findFirst({ where: { productId: pB, type: 'ADJUSTMENT' }, orderBy: { createdAt: 'desc' } }));
    expect(m!.note).toBe('Kırık ürün');
    expect(Number(m!.qty)).toBe(-5);
  });

  it('transfer tek transaction’da çıkış+giriş yazar, yetersizse ürünü söyleyerek reddeder', async () => {
    await as(ALL, () => stock.transfer({ productId: pA, fromWarehouseId: whMain, toWarehouseId: whSide, qty: 30 }));
    expect(await onHand(pA)).toBe(170);
    expect(await onHand(pA, whSide)).toBe(30);
    const pair = await as(ALL, () => db.stockMovement.findMany({ where: { refType: 'TRANSFER' }, orderBy: { createdAt: 'desc' }, take: 2 }));
    expect(new Set(pair.map((m) => m.type))).toEqual(new Set(['TRANSFER_IN', 'TRANSFER_OUT']));

    const err = await as(ALL, () => stock.transfer({ productId: pA, fromWarehouseId: whSide, toWarehouseId: whMain, qty: 9999 })).catch((e) => e);
    expect(JSON.stringify(err.getResponse?.() ?? err.message)).toMatch(/satılabilir/);
  });

  it('sayım yalnız farklar için COUNT hareketi yazar', async () => {
    const c = await as(ALL, () => stock.createCount({ warehouseId: whMain, productIds: [pA, pB] }));
    expect(c.number).toMatch(/^SAY\d{4}-\d{4}$/);
    const systemA = Number(c.lines.find((l) => l.product.id === pA)!.systemQty);

    await as(ALL, () => stock.updateCount(c.id, {
      version: c.version,
      lines: [
        { productId: pA, countedQty: systemA - 3 }, // 3 missing
        { productId: pB, countedQty: Number(c.lines.find((l) => l.product.id === pB)!.systemQty) }, // no change
      ],
    } as never));
    const posted = await as(ALL, () => stock.postCount(c.id));
    expect(posted.status).toBe('POSTED');
    expect(await onHand(pA)).toBe(systemA - 3);
    const counts = await as(ALL, () => db.stockMovement.findMany({ where: { refId: c.id } }));
    expect(counts).toHaveLength(1); // only the differing line
    expect(Number(counts[0]!.qty)).toBe(-3);
  });

  it('toplama: barkot okutma satırı artırır, fazla okutma reddedilir, tamamlanınca READY', async () => {
    const order = await as(ALL, () => sales.create({
      type: 'ORDER', partnerId,
      lines: [{ qty: 5, productId: pA, warehouseId: whMain }, { qty: 2, productId: pB, warehouseId: whMain }],
    } as never)) as Record<string, any>;
    await as(ALL, () => sales.transition(order.id, { toStatus: 'APPROVED' }));
    await as(ALL, () => sales.transition(order.id, { toStatus: 'SENT_TO_WAREHOUSE' }));
    const afterApprove = await as(ALL, () => db.salesDocument.findFirst({ where: { id: order.id } }));
    expect(afterApprove!.status).toBe('SENT_TO_WAREHOUSE');

    const started = await as(PICKER, () => picking.start(order.id));
    expect(started.order.status).toBe('PICKING');

    const barcodeA = `868${slug}A`;
    let scan = await as(PICKER, () => picking.scan(order.id, { barcode: barcodeA, qty: 5 }));
    expect(scan.ok).toBe(true);
    expect(scan.pickedQty).toBe('5.000');

    scan = await as(PICKER, () => picking.scan(order.id, { barcode: barcodeA, qty: 1 }));
    expect(scan.ok).toBe(false);
    expect(scan.reason).toBe('OVER_PICK');

    scan = await as(PICKER, () => picking.scan(order.id, { barcode: 'YOK-123', qty: 1 }));
    expect(scan.reason).toBe('NOT_IN_ORDER');

    const notDone = await as(PICKER, () => picking.ready(order.id)).catch((e) => e);
    expect(JSON.stringify(notDone.getResponse?.() ?? notDone.message)).toMatch(/Toplama tamamlanmadı/);

    await as(PICKER, () => picking.scan(order.id, { barcode: `868${slug}B`, qty: 2 }));
    const ready = await as(PICKER, () => picking.ready(order.id));
    expect(ready.order.status).toBe('READY');
    expect(ready.progress.allPicked).toBe(true);

    (globalThis as Record<string, unknown>).__p05order = order.id;
  });

  it('kısmi sevk: stok düşer, kalan miktar takip edilir, sipariş PARTIALLY_SHIPPED', async () => {
    const orderId = (globalThis as Record<string, unknown>).__p05order as string;
    const before = await onHand(pA);

    const out = await as(ALL, () => ships.outstanding(orderId));
    const lineA = out.lines.find((l) => l.product?.id === pA)!;
    expect(lineA.remainingQty).toBe('5.000');

    const sh = await as(ALL, () => ships.create({
      orderId,
      carrier: 'Aras Kargo', carrierVkn: '1234567890', vehiclePlate: '07 ABC 123',
      driverName: 'Ali Veli', driverTckn: '11111111110', packageCount: 3, grossWeightKg: 42.5,
      lines: [{ orderLineId: lineA.orderLineId, qty: 2 }],
    } as never));
    expect(sh.number).toMatch(/^IRS\d{4}-\d{4}$/);
    expect(sh.ublUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(sh.ublProfileId).toBe('TEMELIRSALIYE');
    expect(await onHand(pA)).toBe(before); // draft moves nothing

    const posted = await as(ALL, () => ships.post(sh.id));
    expect(posted.status).toBe('POSTED');
    expect(await onHand(pA)).toBe(before - 2);

    const order = await as(ALL, () => db.salesDocument.findFirst({ where: { id: orderId }, include: { lines: true } }));
    expect(order!.status).toBe('PARTIALLY_SHIPPED');
    const ol = order!.lines.find((l) => l.productId === pA)!;
    expect(Number(ol.shippedQty)).toBe(2);

    const rest = await as(ALL, () => ships.outstanding(orderId));
    expect(rest.lines.find((l) => l.product?.id === pA)!.remainingQty).toBe('3.000');
  });

  it('kalan sevk edilince sipariş SHIPPED olur ve SALE hareketleri ledger’da', async () => {
    const orderId = (globalThis as Record<string, unknown>).__p05order as string;
    const sh = await as(ALL, () => ships.create({ orderId } as never)); // remaining lines
    await as(ALL, () => ships.post(sh.id));
    const order = await as(ALL, () => db.salesDocument.findFirst({ where: { id: orderId } }));
    expect(order!.status).toBe('SHIPPED');
    const sales = await as(ALL, () => db.stockMovement.findMany({ where: { refType: 'SHIPMENT', type: 'SALE' } }));
    expect(sales.length).toBeGreaterThanOrEqual(3);
    expect(sales.every((m) => Number(m.qty) < 0)).toBe(true);
  });

  it('iade: sevk edilenden fazlası reddedilir, onaylanınca stok geri girer', async () => {
    const orderId = (globalThis as Record<string, unknown>).__p05order as string;
    const returnable = await as(ALL, () => returns.returnable(orderId));
    const lineA = returnable.lines.find((l) => l.product?.id === pA)!;
    expect(lineA.returnableQty).toBe('5.000');

    const tooMany = await as(ALL, () => returns.create({ orderId, reason: 'Hasarlı', lines: [{ orderLineId: lineA.orderLineId, qty: 99 }] } as never)).catch((e) => e);
    expect(JSON.stringify(tooMany.getResponse?.() ?? tooMany.message)).toMatch(/iade edilebilir/);

    const before = await onHand(pA);
    const ret = await as(ALL, () => returns.create({
      orderId, reason: 'Müşteri hasarlı teslim aldı',
      lines: [{ orderLineId: lineA.orderLineId, qty: 2 }],
    } as never)) as Record<string, any>;
    expect(ret.number).toMatch(/^IAD\d{4}-\d{4}$/);
    expect(ret.type).toBe('RETURN');
    expect(await onHand(pA)).toBe(before); // draft only

    await as(ALL, () => sales.transition(ret.id, { toStatus: 'APPROVED' }));
    expect(await onHand(pA)).toBe(before + 2);
    const move = await as(ALL, () => db.stockMovement.findFirst({ where: { refId: ret.id, type: 'RETURN_IN' } }));
    expect(Number(move!.qty)).toBe(2);

    const order = await as(ALL, () => db.salesDocument.findFirst({ where: { id: orderId }, include: { lines: true } }));
    expect(Number(order!.lines.find((l) => l.productId === pA)!.returnedQty)).toBe(2);
  });

  it('ledger ile StockLevel tutarlı (her ürün/depo için hareket toplamı = onHand)', async () => {
    for (const productId of [pA, pB]) {
      for (const warehouseId of [whMain, whSide]) {
        const moves = await as(ALL, () => db.stockMovement.findMany({ where: { productId, warehouseId } }));
        const sum = moves.reduce((a, m) => a + Number(m.qty), 0);
        expect(await onHand(productId, warehouseId)).toBeCloseTo(sum, 3);
      }
    }
  });

  it('durum makinesi yetkisiz geçişi reddeder (toplayıcı siparişi iptal edemez)', async () => {
    const orderId = (globalThis as Record<string, unknown>).__p05order as string;
    await expect(as(PICKER, () => sales.transition(orderId, { toStatus: 'CANCELLED', note: 'test' }))).rejects.toThrow();
  });
});
