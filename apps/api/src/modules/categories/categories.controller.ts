import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import {
  CrudDeleteQuerySchema,
  CrudListQuerySchema,
  type CrudDeleteQuery,
  type CrudListQuery,
} from '../../common/crud/crud-query.dto.js';
import { CategoriesService } from './categories.service.js';
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  type CreateCategoryDto,
  type UpdateCategoryDto,
} from './dto/category.dto.js';

@ApiTags('categories')
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Kategori listesi' })
  list(@Query(new ZodValidationPipe(CrudListQuerySchema)) q: CrudListQuery) {
    return this.categories.list(q);
  }

  @Get('tree')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Kategori ağacı' })
  tree() {
    return this.categories.tree();
  }

  @Get(':id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Kategori detayı' })
  get(@Param('id') id: string) {
    return this.categories.getOrThrow(id);
  }

  @Post()
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Kategori oluştur' })
  create(@Body(new ZodValidationPipe(CreateCategorySchema)) dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Kategori güncelle' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateCategorySchema)) dto: UpdateCategoryDto) {
    return this.categories.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Kategori sil (kullanımdaysa 409)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.categories.softDelete(id, q.version);
  }

  @Post(':id/restore')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Silinmiş kategoriyi geri getir' })
  restore(@Param('id') id: string) {
    return this.categories.restore(id);
  }
}
