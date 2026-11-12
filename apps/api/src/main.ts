import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { DiscoveryService, NestFactory } from '@nestjs/core';
import { Logger as NestLogger, VersioningType } from '@nestjs/common';
import { assertWriteRoutesGuarded } from './common/security/write-route-scan.js';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { TenantContext } from './common/context/tenant-context.js';
import type { Env } from './config/env.schema.js';

/**
 * When RUN_MIGRATIONS=true (managed/host deploy with no SSH step), apply pending
 * migrations before the app serves traffic. Uses the local prisma CLI via npx and
 * the DIRECT_URL from prisma.config.ts. Failures are logged but do not crash the
 * process (so /api/health stays reachable for debugging).
 */
function maybeRunMigrations(): void {
  if (process.env.RUN_MIGRATIONS !== 'true') return;
  const log = new NestLogger('Migrate');
  log.log('RUN_MIGRATIONS=true → prisma migrate deploy');
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    log.error(
      `migrate deploy başarısız (exit ${result.status ?? 'signal'}). Uygulama yine de başlıyor.`,
    );
  } else {
    log.log('Migration tamam.');
  }
}

async function bootstrap(): Promise<void> {
  maybeRunMigrations();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Refuse to start if any POST/PUT/PATCH/DELETE lacks @RequirePermission
  // (INVARIANTS.md rule 5). Cheaper to fail here than to ship an open write route.
  const controllers = app
    .get(DiscoveryService)
    .getControllers()
    .map((w) => w.metatype)
    .filter((c): c is NonNullable<typeof c> => typeof c === 'function');
  const writeRoutes = assertWriteRoutesGuarded(controllers);
  new NestLogger('Security').log(`${writeRoutes.length} yazma ucu tarandı, hepsi yetki korumalı.`);

  // Establish a per-request tenant store before guards run; the JWT guard fills it.
  app.use((_req: unknown, _res: unknown, next: () => void) => TenantContext.run({}, next));
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const config = app.get(ConfigService) as ConfigService<Env, true>;
  const origins = config
    .get('WEB_ORIGIN', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cora API')
    .setDescription('Cora — ticari yönetim ve satış sistemi API (v1)')
    .setVersion('1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Host-provided PORT (Hostinger/managed) wins; bind all interfaces for reverse proxies.
  const port = process.env.PORT
    ? Number(process.env.PORT)
    : config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`Cora API çalışıyor: 0.0.0.0:${port}/api (docs: /api/docs)`);
}

void bootstrap();
