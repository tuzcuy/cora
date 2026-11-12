import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';
import { PartnerWriteService } from './partner-write.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';

@Module({
  controllers: [PartnersController],
  providers: [PartnersService, PartnerWriteService, AuditService, SettingsService],
  exports: [PartnersService, PartnerWriteService],
})
export class PartnersModule {}
