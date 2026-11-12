import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { SalesDocumentsController } from './sales-documents.controller.js';
import { SalesDocumentsService } from './sales-documents.service.js';
import { PriceResolverService } from './price-resolver.service.js';
import { DocumentGuardsService } from './document-guards.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';

@Module({
  controllers: [SalesController, SalesDocumentsController],
  providers: [SalesService, SalesDocumentsService, PriceResolverService, DocumentGuardsService, SettingsService],
  exports: [SalesService, SalesDocumentsService, PriceResolverService],
})
export class SalesModule {}
