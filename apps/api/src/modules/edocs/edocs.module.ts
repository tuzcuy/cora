import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { EDocsController } from './edocs.controller.js';
import { EDocsService } from './edocs.service.js';

@Module({
  controllers: [EDocsController],
  providers: [EDocsService, AuditService],
  exports: [EDocsService],
})
export class EDocsModule {}
