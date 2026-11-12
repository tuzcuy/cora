import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BaseCrudService } from '../../common/crud/base-crud.service.js';
import { TenantContext } from '../../common/context/tenant-context.js';
import type { CrudListQuery } from '../../common/crud/crud-query.dto.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

type Plain = Record<string, unknown>;

@Injectable()
export class CategoriesService extends BaseCrudService<CreateCategoryDto, UpdateCategoryDto> {
  protected readonly model = 'Category';
  protected readonly label = 'Kategori';

  constructor(prisma: PrismaService, audit: AuditService) {
    super(prisma, audit);
  }

  /**
   * The DB unique (tenantId, name, parentId) cannot catch two roots with the
   * same name — Postgres treats NULL parentId as distinct — so the service
   * checks it. Also guards against a parent from another tenant (the scoped
   * findFirst returns null) and against making a node its own ancestor.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async beforeWrite(tx: any, data: Plain, id?: string): Promise<void> {
    const parentId = (data.parentId ?? null) as string | null;
    if (parentId) {
      if (parentId === id) throw new BadRequestException({ error: 'ValidationError', message: 'Kategori kendi üst kategorisi olamaz', errors: { parentId: 'Kendi üst kategorisi olamaz' } });
      const parent = await tx.category.findFirst({ where: { id: parentId } });
      if (!parent) throw new BadRequestException({ error: 'ValidationError', message: 'Üst kategori bulunamadı', errors: { parentId: 'Üst kategori bulunamadı' } });
      // walk up: parent must not descend from id
      if (id) {
        let cur = parent;
        for (let depth = 0; cur?.parentId && depth < 32; depth += 1) {
          if (cur.parentId === id) throw new BadRequestException({ error: 'ValidationError', message: 'Döngüsel kategori ağacı', errors: { parentId: 'Bu seçim döngü oluşturur' } });
          cur = await tx.category.findFirst({ where: { id: cur.parentId } });
        }
      }
    }
    if (typeof data.name === 'string') {
      const dup = await tx.category.findFirst({
        where: { name: data.name, parentId, ...(id ? { id: { not: id } } : {}) },
      });
      if (dup) throw new ConflictException({ error: 'Conflict', message: 'Aynı seviyede aynı adla kategori var', errors: { name: 'Bu ad aynı seviyede zaten kullanılıyor' } });
    }
  }

  async list(q: CrudListQuery) {
    const run = async () => {
      const where = q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {};
      const [items, total] = await Promise.all([
        this.prisma.db.category.findMany({
          where,
          orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { parent: { select: { id: true, name: true } }, _count: { select: { products: true, children: true } } },
        }),
        this.prisma.db.category.count({ where }),
      ]);
      return {
        items: items.map((c) => ({
          id: c.id, name: c.name, parentId: c.parentId, parentName: c.parent?.name ?? null,
          version: c.version, deletedAt: c.deletedAt,
          productCount: c._count.products, childCount: c._count.children,
        })),
        total, page: q.page, pageSize: q.pageSize,
      };
    };
    return q.includeDeleted ? TenantContext.withDeleted(run) : run();
  }

  /** Whole tree (no paging) for pickers and the settings tree view. */
  async tree() {
    const rows = await this.prisma.db.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true, version: true, _count: { select: { products: true } } },
    });
    type Node = { id: string; name: string; parentId: string | null; version: number; productCount: number; children: Node[] };
    const byId = new Map<string, Node>();
    for (const r of rows) byId.set(r.id, { id: r.id, name: r.name, parentId: r.parentId, version: r.version, productCount: r._count.products, children: [] });
    const roots: Node[] = [];
    for (const n of byId.values()) {
      const p = n.parentId ? byId.get(n.parentId) : undefined;
      if (p) p.children.push(n); else roots.push(n);
    }
    return { roots, total: rows.length };
  }
}
