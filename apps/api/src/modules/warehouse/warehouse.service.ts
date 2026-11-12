import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Board columns, in fulfilment order. */
export const BOARD_COLUMNS = [
  { key: 'SENT_TO_WAREHOUSE', label: 'Bekleyen' },
  { key: 'PICKING', label: 'Hazırlanan' },
  { key: 'READY', label: 'Hazır' },
  { key: 'SHIPPED', label: 'Sevk edilen' },
] as const;

const select = {
  id: true,
  number: true,
  status: true,
  date: true,
  deliveryDate: true,
  grandTotalLocal: true,
  partner: { select: { id: true, name: true, city: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SalesDocumentSelect;

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  async board(limitPerColumn = 40) {
    const columns = await Promise.all(
      BOARD_COLUMNS.map(async (col) => {
        // "Sevk edilen" folds PARTIALLY_SHIPPED in with SHIPPED.
        const statuses =
          col.key === 'SHIPPED' ? ['SHIPPED', 'PARTIALLY_SHIPPED'] : [col.key];
        const where: Prisma.SalesDocumentWhereInput = {
          type: 'ORDER',
          status: { in: statuses as never },
        };
        const [items, total] = await Promise.all([
          this.prisma.db.salesDocument.findMany({
            where,
            select,
            orderBy: { date: 'asc' },
            take: limitPerColumn,
          }),
          this.prisma.db.salesDocument.count({ where }),
        ]);
        return {
          key: col.key,
          label: col.label,
          total,
          items: items.map((d) => ({
            id: d.id,
            number: d.number,
            status: d.status,
            date: d.date,
            deliveryDate: d.deliveryDate,
            lineCount: d._count.lines,
            grandTotalLocal: d.grandTotalLocal.toString(),
            partner: d.partner,
          })),
        };
      }),
    );

    const reserved = await this.prisma.db.stockLevel.aggregate({ _sum: { reserved: true } });
    return {
      columns,
      reservedTotal: (reserved._sum.reserved ?? new Prisma.Decimal(0)).toString(),
    };
  }
}
