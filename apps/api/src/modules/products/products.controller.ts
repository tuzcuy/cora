import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { ProductsService } from './products.service.js';
import { ProductListQuerySchema, type ProductListQuery } from './dto/product.dto.js';

/** cost.view is deliberately NOT part of the Satış role — reps see no cost. */
const canViewCost = (user: AuthUser) => user.permissions.includes('cost.view');

@ApiTags('products')
@Controller({ path: 'products', version: '1' })
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Modül sağlık kontrolü' })
  ping() {
    return { module: 'products', ok: true };
  }

  @Get()
  @RequirePermission('product.read')
  @ApiOperation({
    summary: 'Ürün listesi — sunucu taraflı sayfalama, filtre, sıralama ve fasetler',
  })
  list(
    @Query(new ZodValidationPipe(ProductListQuerySchema)) query: ProductListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.products.list(query, canViewCost(user));
  }

  @Get(':id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Ürün detayı — depo kırılımlı stok ile' })
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.products.detail(id, canViewCost(user));
  }
}
