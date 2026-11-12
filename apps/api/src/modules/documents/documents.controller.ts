import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PdfService } from './pdf.service.js';
import { ExcelService } from './excel.service.js';

const ExportProductsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  brandId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  withImages: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(20000).optional(),
});
const ExportDocumentsSchema = z.object({
  type: z.enum(['QUOTE', 'ORDER', 'RETURN']).optional(),
  status: z.string().trim().max(30).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
const CommitSchema = z.object({
  kind: z.enum(['products', 'partners']),
  mapping: z.string().min(2), // JSON string (multipart form field)
  warehouseId: z.string().trim().min(1).optional(),
  dryRun: z.coerce.boolean().optional(),
});

type UploadedExcel = { buffer: Buffer; originalname: string; size: number };

const sendFile = (res: Response, buffer: Buffer, fileName: string, mime: string) => {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.end(buffer);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** /api/v1/documents — PDF and Excel output plus the import wizard (P06). */
@ApiTags('documents')
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(
    private readonly pdf: PdfService,
    private readonly excel: ExcelService,
  ) {}

  /* ── PDF ── */

  @Get('sales/:id/pdf')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Teklif / sipariş PDF (gömülü Türkçe font, logo, ürün fotoğrafı)' })
  async salesPdf(@Param('id') id: string, @Query('images') images: string | undefined, @Res() res: Response) {
    const { buffer, fileName } = await this.pdf.salesDocument(id, { withImages: images !== '0' });
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  @Get('shipments/:id/pdf')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Sevk irsaliyesi PDF' })
  async shipmentPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.pdf.shipment(id);
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  @Get('orders/:id/pick-list.pdf')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Depo toplama listesi PDF (barkodlu, kutucuklu)' })
  async pickListPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.pdf.pickList(id);
    sendFile(res, buffer, fileName, 'application/pdf');
  }

  /* ── Excel export ── */

  @Get('export/products.xlsx')
  @RequirePermission('export.excel')
  @ApiOperation({ summary: 'Ürünleri Excel’e aktar — fotoğraf hücreye gömülü' })
  async exportProducts(@Query(new ZodValidationPipe(ExportProductsSchema)) q: z.infer<typeof ExportProductsSchema>, @Res() res: Response) {
    const { buffer, fileName } = await this.excel.exportProducts(q);
    sendFile(res, buffer, fileName, XLSX);
  }

  @Get('export/documents.xlsx')
  @RequirePermission('export.excel')
  @ApiOperation({ summary: 'Belgeleri Excel’e aktar (başlık + satır sayfası)' })
  async exportDocuments(
    @Query(new ZodValidationPipe(ExportDocumentsSchema)) q: z.infer<typeof ExportDocumentsSchema>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.excel.exportDocuments({ ...q, canViewCost: user.permissions.includes('cost.view') });
    sendFile(res, buffer, fileName, XLSX);
  }

  @Get('import/template/:kind.xlsx')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'İçe aktarım şablonu' })
  async template(@Param('kind') kind: string, @Res() res: Response) {
    const { buffer, fileName } = await this.excel.template(kind === 'partners' ? 'partners' : 'products');
    sendFile(res, buffer, fileName, XLSX);
  }

  /* ── Excel import wizard ── */

  @Post('import/analyze')
  @RequirePermission('product.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Yükle → sütun eşle → doğrula: başlıklar, öneri eşleme, önizleme, hatalar' })
  analyze(@UploadedFile() file: UploadedExcel, @Body('kind') kind: string) {
    return this.excel.analyze(kind === 'partners' ? 'partners' : 'products', file?.buffer);
  }

  @Post('import/commit')
  @RequirePermission('product.import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'İçe aktarımı uygula (açılış stoğu girilmişse giriş fişi de yazar)' })
  async commit(@UploadedFile() file: UploadedExcel, @Body(new ZodValidationPipe(CommitSchema)) body: z.infer<typeof CommitSchema>) {
    const mapping = JSON.parse(body.mapping) as Record<string, string | null>;
    return this.excel.commit(body.kind, file?.buffer, mapping, { warehouseId: body.warehouseId, dryRun: body.dryRun });
  }

  @Post('import/errors.csv')
  @RequirePermission('product.import')
  @ApiOperation({ summary: 'Hatalı satırları CSV olarak indir' })
  errors(@Body() body: { failed?: { row: number; message: string }[] }, @Res() res: Response) {
    const csv = this.excel.errorCsv(body.failed ?? []);
    sendFile(res, csv, 'cora-import-hatalar.csv', 'text/csv; charset=utf-8');
  }
}
