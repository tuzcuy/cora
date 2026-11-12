import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { ReportsService } from './reports.service.js';

const canViewCost = (u: AuthUser) => u.permissions.includes('cost.view');

@ApiTags('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('ping')
  @ApiOperation({ summary: 'Modül sağlık kontrolü' })
  ping() {
    return { module: 'reports', ok: true };
  }

  @Get('dashboard')
  @RequirePermission('report.view')
  @ApiOperation({ summary: 'Panel — KPI, 18 aylık ciro, en çok satanlar, temsilci performansı' })
  dashboard(@CurrentUser() user: AuthUser) {
    return this.reports.dashboard(canViewCost(user));
  }

  @Get('sales')
  @RequirePermission('report.view')
  @ApiOperation({ summary: 'Satış raporu — month | product | customer | rep kırılımı' })
  sales(@Query('groupBy') groupBy: string, @CurrentUser() user: AuthUser) {
    const g = (['month', 'product', 'customer', 'rep'] as const).includes(groupBy as never)
      ? (groupBy as 'month' | 'product' | 'customer' | 'rep')
      : 'month';
    return this.reports.sales(g, canViewCost(user));
  }
}
