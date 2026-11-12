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
import { PartnerGroupsService } from './partner-groups.service.js';
import {
  CreatePartnerGroupSchema,
  UpdatePartnerGroupSchema,
  type CreatePartnerGroupDto,
  type UpdatePartnerGroupDto,
} from './dto/partner-group.dto.js';

@ApiTags('partner-groups')
@Controller({ path: 'partner-groups', version: '1' })
export class PartnerGroupsController {
  constructor(private readonly groups: PartnerGroupsService) {}

  @Get()
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Cari grubu listesi' })
  list(@Query(new ZodValidationPipe(CrudListQuerySchema)) q: CrudListQuery) {
    return this.groups.list(q);
  }

  @Get(':id')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Cari grubu detayı' })
  get(@Param('id') id: string) {
    return this.groups.getOrThrow(id);
  }

  @Post()
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Cari grubu oluştur' })
  create(@Body(new ZodValidationPipe(CreatePartnerGroupSchema)) dto: CreatePartnerGroupDto) {
    return this.groups.create(dto);
  }

  @Patch(':id')
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Cari grubu güncelle' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePartnerGroupSchema)) dto: UpdatePartnerGroupDto,
  ) {
    return this.groups.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Cari grubu sil (kullanımdaysa 409)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.groups.softDelete(id, q.version);
  }

  @Post(':id/restore')
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Silinmiş cari grubunu geri getir' })
  restore(@Param('id') id: string) {
    return this.groups.restore(id);
  }
}
