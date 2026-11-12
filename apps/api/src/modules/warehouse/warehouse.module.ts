import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller.js';
import { WarehouseService } from './warehouse.service.js';
import { PickingService } from './picking.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SalesModule } from '../sales/sales.module.js';

@Module({
  imports: [SalesModule],
  controllers: [WarehouseController],
  providers: [WarehouseService, PickingService, AuditService],
  exports: [WarehouseService],
})
export class WarehouseModule {}
