import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { OpsService } from './ops.service.js';

const RetentionSchema = z.object({
  auditLogDays: z.coerce.number().int().min(0).max(3650).optional(),
  emailLogDays: z.coerce.number().int().min(0).max(3650).optional(),
  documentDays: z.coerce.number().int().min(0).max(7300).optional(),
  deletedPartnerDays: z.coerce.number().int().min(0).max(3650).optional(),
});
const AnonymiseSchema = z.object({
  reason: z.string().trim().min(3, 'Sebep zorunlu (KVKK talebi kaydı)').max(300),
});

/** /api/v1/ops — notifications, performance, KVKK and the backup drill (P10). */
@ApiTags('ops')
@Controller({ path: 'ops', version: '1' })
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('notifications')
  @RequirePermission('order.read')
  @ApiOperation({ summary: 'Kritik stok, süresi dolan teklif, bekleyen sipariş, limit aşımı, e-belge kuyruğu' })
  notifications() {
    return this.ops.notifications();
  }

  @Get('explain')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Ana sorgular için EXPLAIN ANALYZE — seq scan var mı?' })
  explain() {
    return this.ops.explain();
  }

  @Get('db-stats')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Tablo boyutları ve kullanılmayan indeksler' })
  dbStats() {
    return this.ops.dbStats();
  }

  @Get('retention')
  @RequirePermission('settings.manage')
  retention() {
    return this.ops.retention();
  }

  @Post('retention')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'KVKK saklama sürelerini kaydet' })
  setRetention(@Body(new ZodValidationPipe(RetentionSchema)) dto: z.infer<typeof RetentionSchema>) {
    return this.ops.setRetention(dto);
  }

  @Post('retention/run')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Saklama süresini uygula (apply=false ise yalnız önizleme)' })
  runRetention(@Query('apply') apply?: string) {
    return this.ops.runRetention(apply === 'true');
  }

  @Get('personal-data/:kind/:id')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'KVKK erişim talebi: bir cari veya kullanıcı hakkındaki tüm veri' })
  personalData(@Param('kind') kind: string, @Param('id') id: string) {
    return this.ops.personalData(kind === 'user' ? 'user' : 'partner', id);
  }

  @Post('personal-data/partner/:id/anonymise')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'KVKK silme talebi: kişisel alanları anonimleştir, ticari kayıt kalır' })
  anonymise(@Param('id') id: string, @Body(new ZodValidationPipe(AnonymiseSchema)) dto: z.infer<typeof AnonymiseSchema>) {
    return this.ops.anonymisePartner(id, dto.reason);
  }

  @Get('backup-report')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Yedekten geri yükleme tatbikatı için sayım ve adımlar' })
  backupReport() {
    return this.ops.backupReport();
  }
}
