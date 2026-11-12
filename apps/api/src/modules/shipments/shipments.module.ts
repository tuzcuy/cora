import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { SalesModule } from '../sales/sales.module.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { ReturnsService } from './returns.service.js';

@Module({
  imports: [SalesModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, ReturnsService, AuditService, DocumentNumberService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
