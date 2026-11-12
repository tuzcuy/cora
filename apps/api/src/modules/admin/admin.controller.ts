import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { AuthService } from '../auth/auth.service.js';
import { AdminService } from './admin.service.js';
import {
  AuditQuerySchema,
  CreateUserSchema,
  ExchangeRateSchema,
  ResetPasswordSchema,
  RolePermissionsSchema,
  SettingsSchema,
  UpdateUserSchema,
  type AuditQuery,
  type CreateUserDto,
  type ExchangeRateDto,
  type ResetPasswordDto,
  type RolePermissionsDto,
  type SettingsDto,
  type UpdateUserDto,
} from './dto/admin.dto.js';

/** /api/v1/admin — users, roles, settings, exchange rates, audit log (P08). */
@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /* users */

  @Get('users')
  @RequirePermission('user.manage')
  users(@Query('q') q?: string, @Query('includeInactive') includeInactive?: string) {
    return this.admin.users({ q, includeInactive: includeInactive === 'true' });
  }

  @Post('users')
  @RequirePermission('user.manage')
  @ApiOperation({ summary: 'Kullanıcı ekle — şifre verilmezse üretilir ve bir kez gösterilir' })
  createUser(@Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto) {
    return this.admin.createUser(dto, AuthService.hashPassword);
  }

  @Patch('users/:id')
  @RequirePermission('user.manage')
  updateUser(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto) {
    return this.admin.updateUser(id, dto);
  }

  @Post('users/:id/reset-password')
  @RequirePermission('user.manage')
  @ApiOperation({ summary: 'Şifre sıfırla' })
  resetPassword(@Param('id') id: string, @Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordDto) {
    return this.admin.resetPassword(id, AuthService.hashPassword, dto.password);
  }

  @Delete('users/:id')
  @RequirePermission('user.manage')
  @ApiOperation({ summary: 'Kullanıcıyı pasifleştir (silme yok — belgeler kullanıcıya bağlı)' })
  deactivate(@Param('id') id: string) {
    return this.admin.deactivateUser(id);
  }

  /* roles */

  @Get('roles')
  @RequirePermission('user.manage')
  @ApiOperation({ summary: 'Rol–yetki matrisi' })
  roles() {
    return this.admin.roles();
  }

  @Post('roles/:id/permissions')
  @RequirePermission('user.manage')
  setRolePermissions(@Param('id') id: string, @Body(new ZodValidationPipe(RolePermissionsSchema)) dto: RolePermissionsDto) {
    return this.admin.setRolePermissions(id, dto);
  }

  /* settings */

  @Get('settings')
  @RequirePermission('settings.manage')
  settings() {
    return this.admin.settings();
  }

  @Patch('settings')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'Firma bilgileri, logo, KDV oranları, numara önekleri, iş kuralları' })
  saveSettings(@Body(new ZodValidationPipe(SettingsSchema)) dto: SettingsDto) {
    return this.admin.saveSettings(dto);
  }

  /* exchange rates */

  @Get('rates')
  @RequirePermission('settings.manage')
  rates(@Query('days') days?: string) {
    return this.admin.rates(days ? Number(days) : 30);
  }

  @Post('rates')
  @RequirePermission('settings.manage')
  setRate(@Body(new ZodValidationPipe(ExchangeRateSchema)) dto: ExchangeRateDto) {
    return this.admin.setRate(dto);
  }

  @Post('rates/fetch-tcmb')
  @RequirePermission('settings.manage')
  @ApiOperation({ summary: 'TCMB günlük kurlarını çek' })
  fetchTcmb() {
    return this.admin.fetchTcmb();
  }

  /* audit */

  @Get('audit')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'İşlem günlüğü — kim, ne, ne zaman, diff' })
  audit(@Query(new ZodValidationPipe(AuditQuerySchema)) q: AuditQuery) {
    return this.admin.auditLog(q);
  }
}
