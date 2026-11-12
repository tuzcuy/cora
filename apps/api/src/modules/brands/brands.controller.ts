import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { BrandsService } from './brands.service.js';
import {
  CreateBrandSchema,
  DeleteQuerySchema,
  ListQuerySchema,
  UpdateBrandSchema,
  type CreateBrandDto,
  type DeleteQuery,
  type ListQuery,
  type UpdateBrandDto,
} from './dto/brand.dto.js';

@ApiTags('brands')
@Controller({ path: 'brands', version: '1' })
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Marka listesi' })
  list(@Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery) {
    return this.brands.list(q);
  }

  @Get(':id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Marka detayı' })
  get(@Param('id') id: string) {
    return this.brands.getOrThrow(id);
  }

  @Post()
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Marka oluştur' })
  create(@Body(new ZodValidationPipe(CreateBrandSchema)) dto: CreateBrandDto) {
    return this.brands.create(dto);
  }

  @Patch(':id')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Marka güncelle (version ile optimistic lock)' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateBrandSchema)) dto: UpdateBrandDto) {
    return this.brands.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Marka sil (soft delete; kullanımdaysa 409)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(DeleteQuerySchema)) q: DeleteQuery) {
    return this.brands.softDelete(id, q.version);
  }

  @Post(':id/restore')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Silinmiş markayı geri getir' })
  restore(@Param('id') id: string) {
    return this.brands.restore(id);
  }
}
