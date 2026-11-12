import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export type PriceSource = 'manual' | 'price_list' | 'tier' | 'product' | 'none';

export interface ResolveInput {
  product: {
    id: string;
    salesPrice: Prisma.Decimal;
    purchasePrice: Prisma.Decimal;
    vatRate: Prisma.Decimal;
  } | null;
  partnerId: string;
  qty: number;
  /** Selected-unit → base-unit factor (KOLİ of 12 → 12). */
  unitFactor: number;
  /** Document currency → TRY rate, frozen on the document. */
  exchangeRate: number;
  /** Price the user typed, in document currency per selected unit. */
  manualPrice?: number;
}

export interface ResolvedPrice {
  /** Per selected unit, in document currency, 4 dp. */
  unitPrice: number;
  source: PriceSource;
  isPriceOverridden: boolean;
  /** Per selected unit, in TRY (cost snapshot for profit). */
  unitCostLocal: number;
  vatRate: number;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Price resolution order (CORA_MIMARI §8, V1 spec §5):
 *   manual → customer price list → quantity tier → product sales price → FX.
 *
 * P04 shipped steps 2 and 3 as stubs; P07 filled them without touching the
 * editor, the sales service or this call order (D-024, D-037). The service still
 * works without a database handle, which keeps the unit tests trivial.
 */
@Injectable()
export class PriceResolverService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * Customer price list: the partner's own list, else the tenant default.
   * Returns TRY per BASE unit, honouring an optional line discount.
   */
  protected async fromPriceList(partnerId: string, productId: string): Promise<number | null> {
    if (!this.prisma || !partnerId) return null;
    const partner = await this.prisma.db.businessPartner.findFirst({
      where: { id: partnerId },
      select: { priceListId: true },
    });
    const now = new Date();
    const validWindow = {
      isActive: true,
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      AND: [{ OR: [{ validTo: null }, { validTo: { gte: now } }] }],
    } satisfies Prisma.PriceListWhereInput;

    const list = partner?.priceListId
      ? await this.prisma.db.priceList.findFirst({ where: { id: partner.priceListId, ...validWindow }, select: { id: true } })
      : await this.prisma.db.priceList.findFirst({ where: { isDefault: true, ...validWindow }, select: { id: true } });
    if (!list) return null;

    const item = await this.prisma.db.priceListItem.findFirst({
      where: { priceListId: list.id, productId },
      select: { price: true, discountRate: true },
    });
    if (!item) return null;
    const price = Number(item.price);
    const discount = Number(item.discountRate ?? 0);
    return r4(discount > 0 ? price * (1 - discount / 100) : price);
  }

  /**
   * Quantity tiers ("500 adet üstü %5"): the highest tier whose minQty is met
   * wins. A tier attached to the partner's price-list line beats a product-wide
   * one. Returns TRY per BASE unit, or null when no tier applies.
   */
  protected async fromTier(productId: string, qtyBase: number, partnerId?: string): Promise<number | null> {
    if (!this.prisma) return null;

    const partner = partnerId
      ? await this.prisma.db.businessPartner.findFirst({ where: { id: partnerId }, select: { priceListId: true } })
      : null;
    const listId =
      partner?.priceListId ??
      (await this.prisma.db.priceList.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } }))?.id;

    const item = listId
      ? await this.prisma.db.priceListItem.findFirst({ where: { priceListId: listId, productId }, select: { id: true, price: true } })
      : null;

    const tier = await this.prisma.db.priceTier.findFirst({
      where: {
        minQty: { lte: qtyBase },
        OR: [...(item ? [{ itemId: item.id }] : []), { productId, itemId: null }],
      },
      orderBy: [{ minQty: 'desc' }],
      select: { discountRate: true, price: true, itemId: true },
    });
    if (!tier) return null;

    if (tier.price != null) return r4(Number(tier.price));
    if (tier.discountRate == null) return null;

    // A discount tier applies to whatever the previous step resolved: the list
    // price when there is one, otherwise the product's own sales price.
    const base = item
      ? Number(item.price)
      : Number((await this.prisma.db.product.findFirst({ where: { id: productId }, select: { salesPrice: true } }))?.salesPrice ?? 0);
    return r4(base * (1 - Number(tier.discountRate) / 100));
  }

  async resolve(input: ResolveInput): Promise<ResolvedPrice> {
    const factor = input.unitFactor > 0 ? input.unitFactor : 1;
    const fx = input.exchangeRate > 0 ? input.exchangeRate : 1;
    const vatRate = input.product ? Number(input.product.vatRate) : 20;
    const unitCostLocal = input.product ? r4(Number(input.product.purchasePrice) * factor) : 0;

    // 1. Manual price wins and is flagged so the rep sees what they touched.
    if (input.manualPrice !== undefined && input.manualPrice !== null) {
      return { unitPrice: r4(input.manualPrice), source: 'manual', isPriceOverridden: true, unitCostLocal, vatRate };
    }
    if (!input.product) {
      return { unitPrice: 0, source: 'none', isPriceOverridden: false, unitCostLocal, vatRate };
    }

    // 2–3. Price list, then quantity tier (a tier may beat the list price).
    const listPrice = await this.fromPriceList(input.partnerId, input.product.id);
    const tierPrice = await this.fromTier(input.product.id, input.qty * factor, input.partnerId);

    let baseTry: number;
    let source: PriceSource;
    if (tierPrice !== null && (listPrice === null || tierPrice <= listPrice)) {
      baseTry = tierPrice;
      source = 'tier';
    } else if (listPrice !== null) {
      baseTry = listPrice;
      source = 'price_list';
    } else {
      // 4. Product sales price (TRY per base unit).
      baseTry = Number(input.product.salesPrice);
      source = 'product';
    }

    // 5. Unit conversion, then FX into the document currency.
    const unitPrice = r4((baseTry * factor) / fx);
    return { unitPrice, source, isPriceOverridden: false, unitCostLocal, vatRate };
  }
}
