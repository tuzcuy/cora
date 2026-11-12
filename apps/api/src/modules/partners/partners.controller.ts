import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CrudDeleteQuerySchema, type CrudDeleteQuery } from '../../common/crud/crud-query.dto.js';
import { PartnersService } from './partners.service.js';
import { PartnerWriteService } from './partner-write.service.js';
import { PartnerListQuerySchema, type PartnerListQuery } from './dto/partner.dto.js';
import {
  CreatePartnerSchema,
  PartnerBalanceSchema,
  StatementQuerySchema,
  UpdatePartnerSchema,
  type CreatePartnerDto,
  type PartnerBalanceDto,
  type StatementQuery,
  type UpdatePartnerDto,
} from './dto/partner-write.dto.js';

@ApiTags('partners')
@Controller({ path: 'partners', version: '1' })
export class PartnersController {
  constructor(
    private readonly partners: PartnersService,
    private readonly write: PartnerWriteService,
  ) {}

  @Get('ping')
  @ApiOperation({ summary: 'Modül sağlık kontrolü' })
  ping() {
    return { module: 'partners', ok: true };
  }

  @Get()
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Cari listesi — arama, bölge faseti, sayfalama' })
  list(@Query(new ZodValidationPipe(PartnerListQuerySchema)) query: PartnerListQuery) {
    return this.partners.list(query);
  }

  @Get('risk')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Limitine yaklaşan / aşan cariler' })
  riskList(@Query('threshold') threshold?: string) {
    return this.write.riskList(threshold ? Number(threshold) : 80);
  }

  @Get(':id')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Cari detayı — belgeler, toplam satış, bakiye' })
  detail(@Param('id') id: string) {
    return this.partners.detail(id);
  }

  @Get(':id/card')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Kart verisi: kişiler, adresler, risk (form için)' })
  card(@Param('id') id: string) {
    return this.write.detail(id);
  }

  @Get(':id/statement')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Cari ekstre — açılış, borç/alacak, yürüyen bakiye' })
  statement(@Param('id') id: string, @Query(new ZodValidationPipe(StatementQuerySchema)) q: StatementQuery) {
    return this.write.statement(id, q);
  }

  @Get(':id/risk')
  @RequirePermission('partner.read')
  @ApiOperation({ summary: 'Kredi limiti ve açık risk' })
  risk(@Param('id') id: string) {
    return this.write.risk(id);
  }

  @Post()
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Yeni cari (kişiler ve adreslerle birlikte)' })
  create(@Body(new ZodValidationPipe(CreatePartnerSchema)) dto: CreatePartnerDto) {
    return this.write.create(dto);
  }

  @Patch(':id')
  @RequirePermission('partner.write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdatePartnerSchema)) dto: UpdatePartnerDto) {
    return this.write.update(id, dto);
  }

  @Patch(':id/balance')
  @RequirePermission('partner.write')
  @ApiOperation({ summary: 'Dış bakiyeyi güncelle (muhasebe entegrasyonuna kadar elle)' })
  balance(@Param('id') id: string, @Body(new ZodValidationPipe(PartnerBalanceSchema)) dto: PartnerBalanceDto) {
    return this.write.setBalance(id, dto);
  }

  @Delete(':id')
  @RequirePermission('partner.write')
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.write.remove(id, q.version);
  }
}
