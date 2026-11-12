import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { ShipmentsService } from './shipments.service.js';
import { ReturnsService } from './returns.service.js';
import {
  CancelShipmentSchema,
  CreateReturnSchema,
  CreateShipmentSchema,
  ShipmentQuerySchema,
  UpdateShipmentSchema,
  type CancelShipmentDto,
  type CreateReturnDto,
  type CreateShipmentDto,
  type ShipmentQuery,
  type UpdateShipmentDto,
} from './dto/shipment.dto.js';

/** /api/v1/shipments — delivery notes with partial shipping and UBL-TR fields (P05). */
@ApiTags('shipments')
@Controller({ path: 'shipments', version: '1' })
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly returns: ReturnsService,
  ) {}

  @Get()
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'İrsaliye listesi' })
  list(@Query(new ZodValidationPipe(ShipmentQuerySchema)) q: ShipmentQuery) {
    return this.shipments.list(q);
  }

  @Get('outstanding/:orderId')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Siparişte sevk edilmeyi bekleyen miktarlar' })
  outstanding(@Param('orderId') orderId: string) {
    return this.shipments.outstanding(orderId);
  }

  @Get('returnable/:orderId')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Siparişte iade edilebilir miktarlar' })
  returnable(@Param('orderId') orderId: string) {
    return this.returns.returnable(orderId);
  }

  @Get(':id')
  @RequirePermission('order.read')
  detail(@Param('id') id: string) {
    return this.shipments.detail(id);
  }

  @Post()
  @RequirePermission('shipment.create')
  @ApiOperation({ summary: 'Siparişten irsaliye oluştur (kısmi sevk destekli)' })
  create(@Body(new ZodValidationPipe(CreateShipmentSchema)) dto: CreateShipmentDto) {
    return this.shipments.create(dto);
  }

  @Patch(':id')
  @RequirePermission('shipment.create')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateShipmentSchema)) dto: UpdateShipmentDto) {
    return this.shipments.update(id, dto);
  }

  @Post(':id/post')
  @RequirePermission('shipment.post')
  @ApiOperation({ summary: 'İrsaliyeyi işle: stok düşer, sipariş durumu ilerler' })
  post(@Param('id') id: string) {
    return this.shipments.post(id);
  }

  @Post(':id/cancel')
  @RequirePermission('shipment.cancel')
  cancel(@Param('id') id: string, @Body(new ZodValidationPipe(CancelShipmentSchema)) dto: CancelShipmentDto) {
    return this.shipments.cancel(id, dto);
  }

  @Post('returns')
  @RequirePermission('return.write')
  @ApiOperation({ summary: 'İade belgesi oluştur (orijinal siparişe bağlı)' })
  createReturn(@Body(new ZodValidationPipe(CreateReturnSchema)) dto: CreateReturnDto) {
    return this.returns.create(dto);
  }
}
