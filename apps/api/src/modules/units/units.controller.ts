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
import { UnitsService } from './units.service.js';
import { CreateUnitSchema, UpdateUnitSchema, type CreateUnitDto, type UpdateUnitDto } from './dto/unit.dto.js';

@ApiTags('units')
@Controller({ path: 'units', version: '1' })
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Birim listesi' })
  list(@Query(new ZodValidationPipe(CrudListQuerySchema)) q: CrudListQuery) {
    return this.units.list(q);
  }

  @Get(':id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Birim detayı' })
  get(@Param('id') id: string) {
    return this.units.getOrThrow(id);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Birim oluştur' })
  create(@Body(new ZodValidationPipe(CreateUnitSchema)) dto: CreateUnitDto) {
    return this.units.create(dto);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Birim güncelle' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateUnitSchema)) dto: UpdateUnitDto) {
    return this.units.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Birim sil (kullanımdaysa 409)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.units.softDelete(id, q.version);
  }

  @Post(':id/restore')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Silinmiş birimi geri getir' })
  restore(@Param('id') id: string) {
    return this.units.restore(id);
  }
}
