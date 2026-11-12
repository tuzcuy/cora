import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BaseCrudService } from '../../common/crud/base-crud.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { CreateBrandDto, ListQuery, UpdateBrandDto } from './dto/brand.dto.js';

@Injectable()
export class BrandsService extends BaseCrudService<CreateBrandDto, UpdateBrandDto> {
  protected readonly model = 'Brand';
  protected readonly label = 'Marka';

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  async list(q: ListQuery) {
    const run = async () => {
      const where = q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {};
      const [items, total] = await Promise.all([
        this.prisma.db.brand.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { products: true } } },
        }),
        this.prisma.db.brand.count({ where }),
      ]);
      return {
        items: items.map((b) => ({
          id: b.id,
          name: b.name,
          version: b.version,
          deletedAt: b.deletedAt,
          productCount: b._count.products,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    };
    // "Silinenleri göster" is an explicit flag, never the default.
    return q.includeDeleted ? TenantContext.withDeleted(run) : run();
  }
}
