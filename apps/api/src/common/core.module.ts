import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditService } from './audit/audit.service.js';
import { DocumentNumberService } from './numbering/document-number.service.js';

/**
 * Cross-cutting write infrastructure, global so every feature module can inject
 * it without re-importing: audit trail, document numbering, and Nest's
 * DiscoveryService (used by the bootstrap write-route scan).
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [AuditService, DocumentNumberService],
  exports: [AuditService, DocumentNumberService, DiscoveryModule],
})
export class CoreModule {}
