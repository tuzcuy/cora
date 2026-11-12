import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { MailController } from './mail.controller.js';
import { MailService } from './mail.service.js';

@Module({
  imports: [DocumentsModule, SalesModule],
  controllers: [MailController],
  providers: [MailService, AuditService],
  exports: [MailService],
})
export class MailModule {}
