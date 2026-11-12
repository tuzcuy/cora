import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.schema.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProblemJsonFilter } from './common/filters/problem.filter.js';
import { AuditInterceptor } from './common/interceptors/audit.interceptor.js';
import { CostFieldsInterceptor } from './common/interceptors/cost-fields.interceptor.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { LicenseGuard } from './common/guards/license.guard.js';
import { CoreModule } from './common/core.module.js';

import { AuthModule } from './modules/auth/auth.module.js';
import { BrandsModule } from './modules/brands/brands.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { UnitsModule } from './modules/units/units.module.js';
import { WarehousesModule } from './modules/warehouses/warehouses.module.js';
import { PartnerGroupsModule } from './modules/partner-groups/partner-groups.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { PartnersModule } from './modules/partners/partners.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { StockModule } from './modules/stock/stock.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { EDocsModule } from './modules/edocs/edocs.module.js';
import { OpsModule } from './modules/ops/ops.module.js';
import {
  RateLimitMiddleware,
  SecurityHeadersMiddleware,
} from './common/security/security.middleware.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { WarehouseModule } from './modules/warehouse/warehouse.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { SearchModule } from './modules/search/search.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env'] }),
    JwtModule.register({ global: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    PrismaModule,
    CoreModule,
    AuthModule,
    HealthModule,
    BrandsModule,
    CategoriesModule,
    UnitsModule,
    WarehousesModule,
    PartnerGroupsModule,
    UsersModule,
    TenantsModule,
    PartnersModule,
    ProductsModule,
    StockModule,
    PricingModule,
    AdminModule,
    EDocsModule,
    OpsModule,
    SalesModule,
    WarehouseModule,
    ShipmentsModule,
    DocumentsModule,
    ReportsModule,
    FilesModule,
    MailModule,
    SearchModule,
  ],
  providers: [
    SecurityHeadersMiddleware,
    RateLimitMiddleware,
    { provide: APP_FILTER, useClass: ProblemJsonFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Backstop for INVARIANTS.md rule 5: cost/profit keys are deleted from every
    // response body unless the caller holds cost.view.
    { provide: APP_INTERCEPTOR, useClass: CostFieldsInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: LicenseGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Security headers and the per-IP rate limit wrap every route (P10).
    consumer.apply(SecurityHeadersMiddleware, RateLimitMiddleware).forRoutes('*');
  }
}
