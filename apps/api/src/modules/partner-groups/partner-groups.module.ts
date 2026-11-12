import { Module } from '@nestjs/common';
import { PartnerGroupsController } from './partner-groups.controller.js';
import { PartnerGroupsService } from './partner-groups.service.js';

@Module({
  controllers: [PartnerGroupsController],
  providers: [PartnerGroupsService],
  exports: [PartnerGroupsService],
})
export class PartnerGroupsModule {}
