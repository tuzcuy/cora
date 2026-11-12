import { Controller, Delete, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { FilesService, type UploadedImage } from './files.service.js';

/** /api/v1/files — product images, stored in the database (P06). */
@ApiTags('files')
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('products/:productId/images')
  @RequirePermission('product.read')
  list(@Param('productId') productId: string) {
    return this.files.listForProduct(productId);
  }

  @Get('images/:id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Görsel baytları (PDF ve Excel de bunu kullanır)' })
  async image(@Param('id') id: string, @Res() res: Response) {
    const { data, contentType } = await this.files.raw(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(data);
  }

  @Post('products/:productId/images')
  @RequirePermission('product.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Ürün görseli yükle (PNG/JPEG/WebP, en fazla 2 MB)' })
  upload(@Param('productId') productId: string, @UploadedFile() file: UploadedImage) {
    return this.files.upload(productId, file);
  }

  @Delete('images/:id')
  @RequirePermission('product.write')
  remove(@Param('id') id: string) {
    return this.files.remove(id);
  }
}
