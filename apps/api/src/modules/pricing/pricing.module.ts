import { Module } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [PricingController],
  providers: [PricingService, AuditService],
  exports: [PricingService],
})
export class PricingModule {}
