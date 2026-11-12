import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { EDocsService } from './edocs.service.js';

const ListQuery = z.object({
  status: z.enum(['DRAFT', 'QUEUED', 'SENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'ERROR']).optional(),
  kind: z.enum(['E_INVOICE', 'E_ARCHIVE', 'E_DESPATCH']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const QueueInvoice = z.object({
  documentId: z.string().trim().min(1),
  kind: z.enum(['E_INVOICE', 'E_ARCHIVE']).default('E_INVOICE'),
});
const QueueDespatch = z.object({ shipmentId: z.string().trim().min(1) });
const CancelBody = z.object({ reason: z.string().trim().min(3, 'Sebep zorunlu').max(300) });

/** /api/v1/edocs — e-invoice / e-despatch queue and provider status (P09). */
@ApiTags('edocs')
@Controller({ path: 'edocs', version: '1' })
export class EDocsController {
  constructor(private readonly edocs: EDocsService) {}

  @Get('status')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Entegratör bağlı mı?' })
  status() {
    return this.edocs.status();
  }

  @Get()
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'e-Belge kuyruğu' })
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.edocs.list(q);
  }

  @Get('incoming')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Gelen e-belgeler (entegratörden)' })
  incoming() {
    return this.edocs.incoming();
  }

  @Get(':id')
  @RequirePermission('order.read')
  detail(@Param('id') id: string) {
    return this.edocs.detail(id);
  }

  @Post('despatch')
  @RequirePermission('shipment.post')
  @ApiOperation({ summary: 'İşlenmiş irsaliyeyi e-İrsaliye kuyruğuna al' })
  queueDespatch(@Body(new ZodValidationPipe(QueueDespatch)) dto: z.infer<typeof QueueDespatch>) {
    return this.edocs.queueDespatch(dto.shipmentId);
  }

  @Post('invoice')
  @RequirePermission('order.write')
  @ApiOperation({ summary: 'Siparişi e-Fatura / e-Arşiv kuyruğuna al' })
  queueInvoice(@Body(new ZodValidationPipe(QueueInvoice)) dto: z.infer<typeof QueueInvoice>) {
    return this.edocs.queueInvoice(dto.documentId, dto.kind);
  }

  @Post(':id/send')
  @RequirePermission('shipment.post')
  @ApiOperation({ summary: 'Kuyruktaki belgeyi entegratöre gönder' })
  send(@Param('id') id: string) {
    return this.edocs.send(id);
  }

  @Post('send-queue')
  @RequirePermission('shipment.post')
  @ApiOperation({ summary: 'Kuyruğu topluca gönder' })
  sendQueue() {
    return this.edocs.sendQueue();
  }

  @Post(':id/refresh')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Entegratörden durum sorgula' })
  refresh(@Param('id') id: string) {
    return this.edocs.refresh(id);
  }

  @Post(':id/cancel')
  @RequirePermission('shipment.cancel')
  cancel(@Param('id') id: string, @Body(new ZodValidationPipe(CancelBody)) dto: z.infer<typeof CancelBody>) {
    return this.edocs.cancel(id, dto.reason);
  }
}
