import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BaseCrudService } from '../../common/crud/base-crud.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { CrudListQuery } from '../../common/crud/crud-query.dto.js';
import type { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto.js';

@Injectable()
export class UnitsService extends BaseCrudService<CreateUnitDto, UpdateUnitDto> {
  protected readonly model = 'Unit';
  protected readonly label = 'Birim';

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
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
        this.prisma.db.unit.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { baseProducts: true, packageProducts: true } } },
        }),
        this.prisma.db.unit.count({ where }),
      ]);
      return {
        items: items.map((u) => ({
          id: u.id,
          code: u.code,
          name: u.name,
          decimals: u.decimals,
          version: u.version,
          deletedAt: u.deletedAt,
          productCount: u._count.baseProducts + u._count.packageProducts,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    };
    return q.includeDeleted ? TenantContext.withDeleted(run) : run();
  }
}
