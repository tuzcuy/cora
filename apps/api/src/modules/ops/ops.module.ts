import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

@Module({
  controllers: [OpsController],
  providers: [OpsService, AuditService, SettingsService],
  exports: [OpsService],
})
export class OpsModule {}
