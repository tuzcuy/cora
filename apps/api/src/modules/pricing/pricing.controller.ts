import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { PricingService } from './pricing.service.js';
import {
  BulkPriceUpdateSchema,
  CreatePriceListSchema,
  PriceListItemsSchema,
  PriceListQuerySchema,
  TierInputSchema,
  UpdatePriceListSchema,
  type BulkPriceUpdateDto,
  type CreatePriceListDto,
  type PriceListItemsDto,
  type PriceListQuery,
  type TierInputDto,
  type UpdatePriceListDto,
} from './dto/pricing.dto.js';

const ListDetailQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** /api/v1/pricing — price lists, quantity tiers, bulk updates (P07). */
@ApiTags('pricing')
@Controller({ path: 'pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('lists')
  @RequirePermission('product.read')
  lists(@Query(new ZodValidationPipe(PriceListQuerySchema)) q: PriceListQuery) {
    return this.pricing.lists(q);
  }

  @Get('lists/:id')
  @RequirePermission('product.read')
  list(@Param('id') id: string, @Query(new ZodValidationPipe(ListDetailQuery)) q: z.infer<typeof ListDetailQuery>) {
    return this.pricing.list(id, q);
  }

  @Post('lists')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Fiyat listesi oluştur' })
  create(@Body(new ZodValidationPipe(CreatePriceListSchema)) dto: CreatePriceListDto) {
    return this.pricing.createList(dto);
  }

  @Patch('lists/:id')
  @RequirePermission('product.write')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdatePriceListSchema)) dto: UpdatePriceListDto) {
    return this.pricing.updateList(id, dto);
  }

  @Delete('lists/:id')
  @RequirePermission('product.write')
  remove(@Param('id') id: string) {
    return this.pricing.deleteList(id);
  }

  @Post('lists/:id/items')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Liste satırlarını ekle / güncelle / sil' })
  setItems(@Param('id') id: string, @Body(new ZodValidationPipe(PriceListItemsSchema)) dto: PriceListItemsDto) {
    return this.pricing.setItems(id, dto);
  }

  @Post('tiers')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Miktar kademelerini yaz (500+ adet %5)' })
  setTiers(@Body(new ZodValidationPipe(TierInputSchema)) dto: TierInputDto) {
    return this.pricing.setTiers(dto);
  }

  @Get('tiers')
  @RequirePermission('product.read')
  tiers(@Query('itemId') itemId?: string, @Query('productId') productId?: string) {
    return this.pricing.tiersFor({ itemId, productId });
  }

  @Post('bulk-update')
  @RequirePermission('product.write')
  @ApiOperation({ summary: 'Filtreli toplu fiyat güncelleme (önizleme + uygula, geçmişe yazar)' })
  bulk(@Body(new ZodValidationPipe(BulkPriceUpdateSchema)) dto: BulkPriceUpdateDto) {
    return this.pricing.bulkUpdate(dto);
  }

  @Get('history/:productId')
  @RequirePermission('product.read')
  history(@Param('productId') productId: string) {
    return this.pricing.history(productId);
  }
}
