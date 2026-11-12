import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { CrudDeleteQuerySchema, type CrudDeleteQuery } from '../../common/crud/crud-query.dto.js';
import { SalesService } from './sales.service.js';
import { SalesDocumentsService } from './sales-documents.service.js';
import { DocumentListQuerySchema, type DocumentListQuery } from './dto/sales.dto.js';
import {
  BulkTransitionSchema,
  ConvertSchema,
  CreateDocumentSchema,
  ReviseSchema,
  TransitionSchema,
  UpdateDocumentSchema,
  type BulkTransitionDto,
  type CreateDocumentDto,
  type TransitionDto,
  type UpdateDocumentDto,
} from './dto/sales-write.dto.js';

const canViewCost = (u: AuthUser) => u.permissions.includes('cost.view');

/**
 * /api/v1/sales-documents — the editor's API (P04). Reads delegate to the
 * same read model the list screens use; writes go through
 * SalesDocumentsService (pricing engine + state machine + guards, one tx).
 * The older /sales/documents read routes stay for the existing screens.
 */
@ApiTags('sales-documents')
@Controller({ path: 'sales-documents', version: '1' })
export class SalesDocumentsController {
  constructor(
    private readonly reader: SalesService,
    private readonly docs: SalesDocumentsService,
  ) {}

  @Get()
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Belge listesi' })
  list(@Query(new ZodValidationPipe(DocumentListQuerySchema)) q: DocumentListQuery, @CurrentUser() u: AuthUser) {
    return this.reader.list(q, canViewCost(u));
  }

  @Get(':id')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Belge detayı (satırlar, toplamlar, geçmiş, akış)' })
  detail(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.reader.detail(id, canViewCost(u));
  }

  @Get(':id/available-transitions')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Kullanıcının bu belgede yapabileceği durum geçişleri + guard sonucu' })
  availableTransitions(@Param('id') id: string) {
    return this.docs.availableTransitions(id);
  }

  @Post()
  @RequirePermission('quote.write')
  @ApiOperation({ summary: 'Teklif/sipariş oluştur — tutarlar sunucuda hesaplanır' })
  create(@Body(new ZodValidationPipe(CreateDocumentSchema)) dto: CreateDocumentDto) {
    return this.docs.create(dto);
  }

  @Patch(':id')
  @RequirePermission('quote.write')
  @ApiOperation({ summary: 'Belge güncelle (version ile optimistic lock; lines tüm satır setini değiştirir)' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateDocumentSchema)) dto: UpdateDocumentDto) {
    return this.docs.update(id, dto, dto.version);
  }

  @Delete(':id')
  @RequirePermission('quote.write')
  @ApiOperation({ summary: 'Taslak belgeyi sil (soft)' })
  remove(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.docs.softDelete(id, q.version);
  }

  @Post(':id/copy')
  @RequirePermission('quote.write')
  @ApiOperation({ summary: 'Belgeyi yeni taslak olarak kopyala' })
  copy(@Param('id') id: string) {
    return this.docs.copy(id);
  }

  @Post(':id/revise')
  @RequirePermission('quote.write')
  @ApiOperation({ summary: 'Teklifi revize et (rev+1, zincir bağlantılı)' })
  revise(@Param('id') id: string, @Body(new ZodValidationPipe(ReviseSchema)) dto: { note?: string }) {
    return this.docs.revise(id, dto.note);
  }

  @Post(':id/convert')
  @RequirePermission('order.write')
  @ApiOperation({ summary: 'Teklifi siparişe dönüştür (sourceDocumentId ile bağlı)' })
  convert(@Param('id') id: string, @Body(new ZodValidationPipe(ConvertSchema)) dto: { deliveryDate?: Date | null }) {
    return this.docs.convert(id, dto);
  }

  @Post(':id/validate')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Guard kontrolü: stok, kredi limiti, marj — { ok, warnings, blockers }' })
  validate(@Param('id') id: string) {
    return this.docs.validate(id);
  }

  @Post(':id/transition')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Durum geçişi (durum makinesi + yetki + guard + yan etkiler, tek transaction)' })
  transition(@Param('id') id: string, @Body(new ZodValidationPipe(TransitionSchema)) dto: TransitionDto) {
    return this.docs.transition(id, dto);
  }

  @Post('bulk-transition')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Toplu durum geçişi' })
  bulk(@Body(new ZodValidationPipe(BulkTransitionSchema)) dto: BulkTransitionDto) {
    return this.docs.bulkTransition(dto);
  }
}
