import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BaseCrudService } from '../../common/crud/base-crud.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { CrudListQuery } from '../../common/crud/crud-query.dto.js';
import type { CreatePartnerGroupDto, UpdatePartnerGroupDto } from './dto/partner-group.dto.js';

@Injectable()
export class PartnerGroupsService extends BaseCrudService<CreatePartnerGroupDto, UpdatePartnerGroupDto> {
  protected readonly model = 'PartnerGroup';
  protected readonly label = 'Cari grubu';

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
        this.prisma.db.partnerGroup.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { _count: { select: { partners: true } } },
        }),
        this.prisma.db.partnerGroup.count({ where }),
      ]);
      return {
        items: items.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          version: g.version,
          deletedAt: g.deletedAt,
          partnerCount: g._count.partners,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    };
    return q.includeDeleted ? TenantContext.withDeleted(run) : run();
  }
}
