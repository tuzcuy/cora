import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { FilesModule } from '../files/files.module.js';
import { DocumentsController } from './documents.controller.js';
import { PdfService } from './pdf.service.js';
import { ExcelService } from './excel.service.js';

@Module({
  imports: [FilesModule],
  controllers: [DocumentsController],
  providers: [PdfService, ExcelService, SettingsService, AuditService],
  exports: [PdfService, ExcelService],
})
export class DocumentsModule {}
