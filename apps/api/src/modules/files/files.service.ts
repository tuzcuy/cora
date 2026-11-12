import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * Product images (P06). Bytes are stored in Postgres: the shared host has no
 * object storage and Render's free tier has no persistent disk, so a MinIO
 * bucket would have been a promise we cannot keep. Images are capped at 2 MB and
 * read back by the UI, the PDF renderer and the Excel exporter.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForProduct(productId: string) {
    const rows = await this.prisma.db.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, fileName: true, contentType: true, byteSize: true, sortOrder: true, createdAt: true },
    });
    return { items: rows.map((r) => ({ ...r, url: `/api/v1/files/images/${r.id}` })) };
  }

  async upload(productId: string, file: UploadedImage) {
    if (!file?.buffer?.length) throw new BadRequestException({ errors: { file: 'Dosya gerekli' } });
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException({ errors: { file: 'Yalnız PNG, JPEG veya WebP yüklenebilir' } });
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException({ errors: { file: `Dosya 2 MB'ı aşamaz (${(file.size / 1024 / 1024).toFixed(1)} MB)` } });
    }
    const product = await this.prisma.db.product.findFirst({ where: { id: productId }, select: { id: true, primaryImageId: true } });
    if (!product) throw new NotFoundException('Ürün bulunamadı');

    const count = await this.prisma.db.productImage.count({ where: { productId } });
    const image = await this.prisma.db.productImage.create({
      data: {
        productId,
        objectKey: `db://${productId}/${Date.now()}`,
        sortOrder: count,
        data: new Uint8Array(file.buffer),
        contentType: file.mimetype,
        fileName: file.originalname,
        byteSize: file.size,
      },
      select: { id: true, fileName: true, contentType: true, byteSize: true, sortOrder: true },
    });
    if (!product.primaryImageId) {
      await this.prisma.db.product.update({ where: { id: productId }, data: { primaryImageId: image.id } });
    }
    await this.audit.record({ entity: 'ProductImage', entityId: image.id, action: 'create', after: { productId, fileName: file.originalname, byteSize: file.size } });
    return { ...image, url: `/api/v1/files/images/${image.id}` };
  }

  /** Raw bytes for the API response, the PDF renderer and the Excel exporter. */
  async raw(id: string): Promise<{ data: Buffer; contentType: string }> {
    const row = await this.prisma.db.productImage.findFirst({ where: { id }, select: { data: true, contentType: true } });
    if (!row?.data) throw new NotFoundException('Görsel bulunamadı');
    return { data: Buffer.from(row.data as Uint8Array), contentType: row.contentType ?? 'image/png' };
  }

  /** Primary image of each product, as data URLs, for embedding in exports. */
  async dataUrlsForProducts(productIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (productIds.length === 0) return out;
    const rows = await this.prisma.db.productImage.findMany({
      where: { productId: { in: productIds } },
      orderBy: { sortOrder: 'asc' },
      select: { productId: true, data: true, contentType: true },
    });
    for (const r of rows) {
      if (!r.data || out.has(r.productId)) continue;
      out.set(r.productId, `data:${r.contentType ?? 'image/png'};base64,${Buffer.from(r.data as Uint8Array).toString('base64')}`);
    }
    return out;
  }

  async remove(id: string) {
    const img = await this.prisma.db.productImage.findFirst({ where: { id }, select: { id: true, productId: true } });
    if (!img) throw new NotFoundException('Görsel bulunamadı');
    await this.prisma.db.productImage.delete({ where: { id } });
    const product = await this.prisma.db.product.findFirst({ where: { id: img.productId }, select: { primaryImageId: true } });
    if (product?.primaryImageId === id) {
      const next = await this.prisma.db.productImage.findFirst({ where: { productId: img.productId }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
      await this.prisma.db.product.update({ where: { id: img.productId }, data: { primaryImageId: next?.id ?? null } });
    }
    await this.audit.record({ entity: 'ProductImage', entityId: id, action: 'delete', before: { productId: img.productId } });
    return { ok: true };
  }
}
