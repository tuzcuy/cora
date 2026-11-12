import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BaseCrudService } from '../../common/crud/base-crud.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { CrudListQuery } from '../../common/crud/crud-query.dto.js';
import type { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto.js';

type Plain = Record<string, unknown>;

@Injectable()
export class WarehousesService extends BaseCrudService<CreateWarehouseDto, UpdateWarehouseDto> {
  protected readonly model = 'Warehouse';
  protected readonly label = 'Depo';

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  /** Exactly one default warehouse per tenant — settled inside the same transaction. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async afterWrite(tx: any, row: Plain): Promise<void> {
    if (row.isDefault === true) {
      await tx.warehouse.updateMany({
        where: { id: { not: row.id as string }, isDefault: true },
        data: { isDefault: false },
      });
    }
  }

  async list(q: CrudListQuery) {
    const run = async () => {
      const where = q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' as const } },
              { name: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {};
      const [items, total] = await Promise.all([
        this.prisma.db.warehouse.findMany({
          where,
          orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { stockLevels: true, stockMovements: true } } },
        }),
        this.prisma.db.warehouse.count({ where }),
      ]);
      return {
        items: items.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          isDefault: w.isDefault,
          isActive: w.isActive,
          version: w.version,
          deletedAt: w.deletedAt,
          stockLevelCount: w._count.stockLevels,
          movementCount: w._count.stockMovements,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    };
    return q.includeDeleted ? TenantContext.withDeleted(run) : run();
  }
}
