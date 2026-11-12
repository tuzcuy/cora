import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/numbering/document-number.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [StockController],
  providers: [StockService, AuditService, DocumentNumberService],
  exports: [StockService],
})
export class StockModule {}
