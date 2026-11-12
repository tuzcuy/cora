import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

@Module({
  controllers: [FilesController],
  providers: [FilesService, AuditService],
  exports: [FilesService],
})
export class FilesModule {}
