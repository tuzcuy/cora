import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { WarehouseService } from './warehouse.service.js';
import { PickingService } from './picking.service.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PickSchema, ScanSchema, type PickDto, type ScanDto } from '../shipments/dto/shipment.dto.js';

@ApiTags('warehouse')
@Controller({ path: 'warehouse', version: '1' })
export class WarehouseController {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly picking: PickingService,
  ) {}

  @Get('ping')
  @ApiOperation({ summary: 'Modül sağlık kontrolü' })
  ping() {
    return { module: 'warehouse', ok: true };
  }

  @Get('board')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Depo panosu — bekleyen / hazırlanan / hazır / sevk edilen' })
  board() {
    return this.warehouse.board();
  }

  @Get('tasks/:orderId')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Toplama listesi: satırlar, hedef ve toplanan miktar' })
  task(@Param('orderId') orderId: string) {
    return this.picking.task(orderId);
  }

  @Post('tasks/:orderId/start')
  @RequirePermission('warehouse.pick')
  @ApiOperation({ summary: 'Toplamayı başlat (SENT_TO_WAREHOUSE → PICKING)' })
  start(@Param('orderId') orderId: string) {
    return this.picking.start(orderId);
  }

  @Post('tasks/:orderId/pick')
  @RequirePermission('warehouse.pick')
  @ApiOperation({ summary: 'Satır toplama miktarlarını yaz' })
  pick(@Param('orderId') orderId: string, @Body(new ZodValidationPipe(PickSchema)) dto: PickDto) {
    return this.picking.pick(orderId, dto);
  }

  @Post('tasks/:orderId/scan')
  @RequirePermission('warehouse.pick')
  @ApiOperation({ summary: 'Barkod okut (klavye emülasyonu): eşleşen satırı artırır' })
  scan(@Param('orderId') orderId: string, @Body(new ZodValidationPipe(ScanSchema)) dto: ScanDto) {
    return this.picking.scan(orderId, dto);
  }

  @Post('tasks/:orderId/ready')
  @RequirePermission('warehouse.pick')
  @ApiOperation({ summary: 'Toplama bitti (PICKING → READY)' })
  ready(@Param('orderId') orderId: string) {
    return this.picking.ready(orderId);
  }
}
