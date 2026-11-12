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
import { WarehousesService } from './warehouses.service.js';
import {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  type CreateWarehouseDto,
  type UpdateWarehouseDto,
} from './dto/warehouse.dto.js';

@ApiTags('warehouses')
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Depo listesi' })
  list(@Query(new ZodValidationPipe(CrudListQuerySchema)) q: CrudListQuery) {
    return this.warehouses.list(q);
  }

  @Get(':id')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Depo detayı' })
  get(@Param('id') id: string) {
    return this.warehouses.getOrThrow(id);
  }

  @Post()
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Depo oluştur' })
  create(@Body(new ZodValidationPipe(CreateWarehouseSchema)) dto: CreateWarehouseDto) {
    return this.warehouses.create(dto);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Depo güncelle' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateWarehouseSchema)) dto: UpdateWarehouseDto) {
    return this.warehouses.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Depo sil (kullanımdaysa 409)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.warehouses.softDelete(id, q.version);
  }

  @Post(':id/restore')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Silinmiş depoyu geri getir' })
  restore(@Param('id') id: string) {
    return this.warehouses.restore(id);
  }
}
