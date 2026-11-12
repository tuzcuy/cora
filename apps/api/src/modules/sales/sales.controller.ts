import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { SalesService } from './sales.service.js';
import { DocumentListQuerySchema, type DocumentListQuery } from './dto/sales.dto.js';

const canViewCost = (u: AuthUser) => u.permissions.includes('cost.view');

@ApiTags('sales')
@Controller({ path: 'sales', version: '1' })
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Modül sağlık kontrolü' })
  ping() {
    return { module: 'sales', ok: true };
  }

  @Get('documents')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Teklif/sipariş listesi — durum, tarih, müşteri filtresi' })
  list(
    @Query(new ZodValidationPipe(DocumentListQuerySchema)) query: DocumentListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.list(query, canViewCost(user));
  }

  @Get('documents/:id')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Belge detayı — satırlar, toplamlar, kâr, durum geçmişi' })
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sales.detail(id, canViewCost(user));
  }
}
