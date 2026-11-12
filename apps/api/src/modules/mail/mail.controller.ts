import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { MailService } from './mail.service.js';

const SendSchema = z.object({
  to: z.string().trim().email('Geçerli bir e-posta girin').or(z.literal('')).optional(),
  cc: z.string().trim().email('Geçerli bir e-posta girin').or(z.literal('')).optional(),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().max(5000).optional(),
  attachPdf: z.boolean().optional(),
  markSent: z.boolean().optional(),
});

const TestSchema = z.object({
  to: z.string().trim().email('Geçerli bir e-posta girin'),
});

/** /api/v1/mail — sending documents by e-mail and the delivery log (P06). */
@ApiTags('mail')
@Controller({ path: 'mail', version: '1' })
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('log')
  @RequirePermission('quote.read')
  @ApiOperation({ summary: 'Gönderim log’u' })
  log(@Query('documentId') documentId?: string) {
    return this.mail.history(documentId);
  }

  @Post('documents/:id/send')
  @RequirePermission('quote.send')
  @ApiOperation({ summary: 'Belgeyi PDF ekiyle gönder; taslak teklif SENT’e geçer' })
  send(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendSchema)) dto: z.infer<typeof SendSchema>,
  ) {
    return this.mail.sendDocument(id, { ...dto, to: dto.to ?? '' });
  }

  @Post('test')
  @RequirePermission('quote.send')
  @ApiOperation({ summary: 'SMTP ayarını doğrula ve verilen adrese test e-postası gönder' })
  test(@Body(new ZodValidationPipe(TestSchema)) dto: z.infer<typeof TestSchema>) {
    return this.mail.sendTest(dto.to);
  }
}
