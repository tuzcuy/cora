import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import {
  EDOC_PROVIDER,
  createProvider,
  explainGib,
  type EDocumentPayload,
  type EInvoiceProvider,
} from './provider.js';

const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

/**
 * e-Document queue (P09). A delivery note or an invoice is prepared into a
 * UBL-TR shaped payload, queued with its own ETTN, and handed to the provider
 * adapter. Cora keeps the payload, the attempts and the answer; the fiscal seal
 * never leaves the integrator.
 */
@Injectable()
export class EDocsService {
  private readonly log = new Logger(EDocsService.name);
  private readonly provider: EInvoiceProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // Nest cannot inject an interface: the token is optional so the container
    // falls back to createProvider(), while tests hand in a fake directly.
    @Optional() @Inject(EDOC_PROVIDER) provider?: EInvoiceProvider,
  ) {
    this.provider = provider ?? createProvider();
  }

  private get db() {
    return this.prisma.db;
  }

  status() {
    return {
      provider: this.provider.name,
      configured: this.provider.configured,
      message: this.provider.configured
        ? `${this.provider.name} entegratörü bağlı.`
        : 'Entegratör bağlı değil: belgeler hazırlanıp kuyrukta bekler, mali mühür Cora’da tutulmaz.',
    };
  }

  /* ─────────────────────────── payload building ───────────────────────── */

  private async company() {
    const rows = await this.db.setting.findMany({ where: { key: 'company' }, select: { value: true } });
    const c = (rows[0]?.value ?? {}) as Record<string, string>;
    const tenant = await this.db.tenant.findFirst({ select: { name: true } });
    return {
      name: c.name || tenant?.name || 'Cora',
      taxNumber: c.taxNumber ?? null,
      taxOffice: c.taxOffice ?? null,
      address: c.address ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      country: 'TR',
    };
  }

  /** UBL-TR DespatchAdvice from a posted shipment. */
  async despatchPayload(shipmentId: string, ettn: string): Promise<EDocumentPayload> {
    const s = await this.db.shipment.findFirst({
      where: { id: shipmentId },
      include: {
        partner: true,
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { code: true, name: true, unit: { select: { code: true } } } } } },
      },
    });
    if (!s) throw new NotFoundException('İrsaliye bulunamadı');
    const addr = (s.shippingAddress ?? {}) as Record<string, string>;
    return {
      kind: 'E_DESPATCH',
      ettn,
      number: s.number,
      issueDate: day(s.date),
      issueTime: (s.issueTime ?? s.createdAt).toISOString().slice(11, 19),
      profileId: s.ublProfileId,
      typeCode: s.ublTypeCode,
      currency: 'TRY',
      supplier: await this.company(),
      customer: {
        name: s.partner.name,
        taxNumber: s.partner.taxNumber,
        taxOffice: s.partner.taxOffice,
        address: addr.line1 ?? null,
        district: addr.district ?? null,
        city: addr.city ?? s.partner.city ?? null,
        country: 'TR',
        email: s.partner.email,
        phone: s.partner.phone,
      },
      lines: s.lines.map((l) => ({
        lineNo: l.lineNo,
        code: l.product.code,
        name: l.product.name,
        qty: l.qty.toString(),
        unitCode: l.product.unit?.code ?? 'ADET',
      })),
      despatch: {
        actualDespatchDate: s.actualDespatchDate ? day(s.actualDespatchDate) : day(s.date),
        carrierName: s.carrierTitle ?? s.carrier,
        carrierVkn: s.carrierVkn,
        driverName: s.driverName,
        driverTckn: s.driverTckn,
        vehiclePlate: s.vehiclePlate,
        trailerPlate: s.trailerPlate,
        packageCount: s.packageCount,
        grossWeightKg: s.grossWeightKg?.toString() ?? null,
      },
      notes: s.notes,
    };
  }

  /** UBL-TR Invoice from an order (e-invoice or e-archive). */
  async invoicePayload(documentId: string, ettn: string, kind: 'E_INVOICE' | 'E_ARCHIVE'): Promise<EDocumentPayload> {
    const d = await this.db.salesDocument.findFirst({
      where: { id: documentId },
      include: {
        partner: true,
        billingAddress: true,
        shippingAddress: true,
        lines: { orderBy: { lineNo: 'asc' }, include: { product: { select: { code: true, name: true, unit: { select: { code: true } } } } } },
      },
    });
    if (!d) throw new NotFoundException('Belge bulunamadı');
    const addr = d.billingAddress ?? d.shippingAddress;
    return {
      kind,
      ettn,
      number: d.number,
      issueDate: day(d.date),
      issueTime: d.createdAt.toISOString().slice(11, 19),
      profileId: kind === 'E_ARCHIVE' ? 'EARSIVFATURA' : 'TICARIFATURA',
      typeCode: 'SATIS',
      currency: d.currency,
      supplier: await this.company(),
      customer: {
        name: d.partner.name,
        taxNumber: d.partner.taxNumber,
        taxOffice: d.partner.taxOffice,
        address: addr?.line1 ?? null,
        district: addr?.district ?? null,
        city: addr?.city ?? d.partner.city ?? null,
        country: 'TR',
        email: d.partner.email,
        phone: d.partner.phone,
      },
      lines: d.lines.map((l) => ({
        lineNo: l.lineNo,
        code: l.product?.code ?? '',
        name: l.description,
        qty: l.qty.toString(),
        unitCode: l.product?.unit?.code ?? 'ADET',
        unitPrice: l.unitPrice.toString(),
        vatRate: l.vatRate.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
      totals: {
        subtotal: d.subtotal.toString(),
        discountTotal: d.discountTotal.toString(),
        vatTotal: d.vatTotal.toString(),
        grandTotal: d.grandTotal.toString(),
      },
      notes: d.notes,
    };
  }

  /* ───────────────────────────── queue ────────────────────────────────── */

  /** Queue a shipment as an e-despatch (idempotent per shipment). */
  async queueDespatch(shipmentId: string) {
    const shipment = await this.db.shipment.findFirst({
      where: { id: shipmentId },
      select: { id: true, number: true, status: true, partnerId: true, ublUuid: true },
    });
    if (!shipment) throw new NotFoundException('İrsaliye bulunamadı');
    if (shipment.status !== 'POSTED') throw new ConflictException('Yalnız işlenmiş irsaliye e-İrsaliye olarak gönderilir.');

    const existing = await this.db.eDocument.findFirst({
      where: { shipmentId, status: { notIn: ['ERROR', 'CANCELLED', 'REJECTED'] } },
      select: { id: true },
    });
    if (existing) return this.detail(existing.id);

    const ettn = shipment.ublUuid ?? randomUUID();
    const payload = await this.despatchPayload(shipmentId, ettn);
    const created = await this.db.eDocument.create({
      data: {
        kind: 'E_DESPATCH',
        status: 'QUEUED',
        shipmentId,
        partnerId: shipment.partnerId,
        ettn,
        providerName: this.provider.name,
        payload: payload as unknown as Prisma.InputJsonValue,
        createdById: TenantContext.getUserId() ?? null,
      } as never,
    });
    await this.audit.record({ entity: 'EDocument', entityId: created.id, action: 'create', after: { kind: 'E_DESPATCH', number: shipment.number, ettn } });
    return this.detail(created.id);
  }

  /** Queue an order as an e-invoice / e-archive. */
  async queueInvoice(documentId: string, kind: 'E_INVOICE' | 'E_ARCHIVE' = 'E_INVOICE') {
    const doc = await this.db.salesDocument.findFirst({
      where: { id: documentId },
      select: { id: true, number: true, type: true, status: true, partnerId: true },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadı');
    if (doc.type !== 'ORDER') throw new BadRequestException({ errors: { documentId: 'Yalnız sipariş faturalanabilir' } });
    if (['DRAFT', 'CANCELLED', 'REJECTED'].includes(doc.status)) {
      throw new ConflictException(`Bu durumdaki belge faturalanamaz: ${doc.status}`);
    }

    const existing = await this.db.eDocument.findFirst({
      where: { documentId, status: { notIn: ['ERROR', 'CANCELLED', 'REJECTED'] } },
      select: { id: true },
    });
    if (existing) return this.detail(existing.id);

    const ettn = randomUUID();
    const payload = await this.invoicePayload(documentId, ettn, kind);
    const created = await this.db.eDocument.create({
      data: {
        kind, status: 'QUEUED', documentId, partnerId: doc.partnerId, ettn,
        providerName: this.provider.name,
        payload: payload as unknown as Prisma.InputJsonValue,
        createdById: TenantContext.getUserId() ?? null,
      } as never,
    });
    await this.audit.record({ entity: 'EDocument', entityId: created.id, action: 'create', after: { kind, number: doc.number, ettn } });
    return this.detail(created.id);
  }

  /** Hand one queued document to the provider. */
  async send(id: string) {
    const doc = await this.db.eDocument.findFirst({ where: { id } });
    if (!doc) throw new NotFoundException('e-Belge bulunamadı');
    if (['ACCEPTED', 'SENT'].includes(doc.status)) return this.detail(id);

    await this.db.eDocument.update({ where: { id }, data: { status: 'SENDING', attempts: { increment: 1 }, lastTriedAt: new Date() } });
    const payload = doc.payload as unknown as EDocumentPayload;
    const result = doc.kind === 'E_DESPATCH'
      ? await this.provider.sendDespatch(payload)
      : await this.provider.sendInvoice(payload);

    await this.db.eDocument.update({
      where: { id },
      data: {
        status: result.ok ? (result.status === 'ACCEPTED' ? 'ACCEPTED' : 'SENT') : 'ERROR',
        providerId: result.providerId ?? null,
        responseCode: result.code ?? null,
        responseText: result.message,
        sentAt: result.ok ? new Date() : null,
        acceptedAt: result.status === 'ACCEPTED' ? new Date() : null,
      },
    });

    // Mirror the answer on the shipment so the delivery-note screen shows it.
    if (doc.shipmentId) {
      await this.db.shipment.update({
        where: { id: doc.shipmentId },
        data: { gibStatus: result.ok ? result.status : 'ERROR', gibUuid: result.providerId ?? null, sentToGibAt: result.ok ? new Date() : null },
      });
    }
    await this.audit.record({
      entity: 'EDocument', entityId: id, action: 'update',
      diff: { status: { from: doc.status, to: result.ok ? result.status : 'ERROR' }, response: { from: null, to: result.message } },
    });
    if (!result.ok) this.log.warn(`e-Belge gönderilemedi (${doc.ettn}): ${result.message}`);
    return this.detail(id);
  }

  /** Send everything still queued, oldest first. */
  async sendQueue(limit = 25) {
    const queued = await this.db.eDocument.findMany({
      where: { status: { in: ['QUEUED', 'ERROR'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    const results = [];
    for (const q of queued) {
      const d = await this.send(q.id);
      results.push({ id: q.id, status: d.status, message: d.responseText });
    }
    return { processed: results.length, results, provider: this.status() };
  }

  async refresh(id: string) {
    const doc = await this.db.eDocument.findFirst({ where: { id }, select: { id: true, ettn: true, status: true } });
    if (!doc) throw new NotFoundException('e-Belge bulunamadı');
    const res = await this.provider.queryStatus(doc.ettn);
    await this.db.eDocument.update({
      where: { id },
      data: {
        status: res.status as never,
        responseCode: res.code ?? null,
        responseText: res.message,
        acceptedAt: res.status === 'ACCEPTED' ? new Date() : undefined,
      },
    });
    return this.detail(id);
  }

  async cancel(id: string, reason: string) {
    const doc = await this.db.eDocument.findFirst({ where: { id }, select: { id: true, status: true } });
    if (!doc) throw new NotFoundException('e-Belge bulunamadı');
    if (['ACCEPTED'].includes(doc.status)) throw new ConflictException('Kabul edilmiş e-belge Cora’dan iptal edilemez; entegratör üzerinden iptal edin.');
    await this.db.eDocument.update({ where: { id }, data: { status: 'CANCELLED', responseText: reason } });
    await this.audit.record({ entity: 'EDocument', entityId: id, action: 'update', diff: { status: { from: doc.status, to: 'CANCELLED' }, reason: { from: null, to: reason } } });
    return this.detail(id);
  }

  /* ─────────────────────────────── read ───────────────────────────────── */

  async list(q: { status?: string; kind?: string; page?: number; pageSize?: number } = {}) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.EDocumentWhereInput = {};
    if (q.status) where.status = q.status as never;
    if (q.kind) where.kind = q.kind as never;

    const [items, total, facets] = await Promise.all([
      this.db.eDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, kind: true, status: true, ettn: true, providerName: true, providerId: true,
          responseCode: true, responseText: true, attempts: true, sentAt: true, createdAt: true,
          shipment: { select: { id: true, number: true } },
          document: { select: { id: true, number: true, type: true } },
          partner: { select: { id: true, name: true } },
        },
      }),
      this.db.eDocument.count({ where }),
      this.db.eDocument.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      items: items.map((e) => ({
        ...e,
        number: e.shipment?.number ?? e.document?.number ?? '—',
        explanation: explainGib(e.responseCode, e.responseText ?? ''),
      })),
      total, page, pageSize,
      facets: { statuses: facets.map((f) => ({ status: f.status, count: f._count._all })) },
      provider: this.status(),
    };
  }

  async detail(id: string) {
    const e = await this.db.eDocument.findFirst({
      where: { id },
      include: {
        shipment: { select: { id: true, number: true, date: true } },
        document: { select: { id: true, number: true, type: true, date: true } },
        partner: { select: { id: true, code: true, name: true, taxNumber: true } },
      },
    });
    if (!e) throw new NotFoundException('e-Belge bulunamadı');
    return {
      id: e.id, kind: e.kind, status: e.status, ettn: e.ettn,
      providerName: e.providerName, providerId: e.providerId,
      responseCode: e.responseCode, responseText: e.responseText,
      explanation: explainGib(e.responseCode, e.responseText ?? ''),
      attempts: e.attempts, lastTriedAt: e.lastTriedAt, sentAt: e.sentAt, acceptedAt: e.acceptedAt,
      createdAt: e.createdAt,
      number: e.shipment?.number ?? e.document?.number ?? '—',
      shipment: e.shipment, document: e.document, partner: e.partner,
      payload: e.payload,
    };
  }

  /** Incoming documents from the integrator (empty with the null provider). */
  async incoming(since?: Date) {
    const items = await this.provider.getIncoming(since);
    return { items, provider: this.status() };
  }
}
