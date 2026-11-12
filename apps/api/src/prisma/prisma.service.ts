import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantExtension } from './prisma-tenant.extension.js';
import type { Env } from '../config/env.schema.js';

const extend = (base: PrismaClient) => base.$extends(tenantExtension());
export type ExtendedPrismaClient = ReturnType<typeof extend>;

/**
 * Prisma 7 service using the pg driver adapter. Exposes `db` — the tenant-scoped
 * extended client that all services use. Never bypass it (INVARIANTS.md rule #1).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly base: PrismaClient;
  readonly db: ExtendedPrismaClient;

  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg(config.get('DATABASE_URL', { infer: true }));
    this.base = new PrismaClient({ adapter });
    this.db = extend(this.base);
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    this.logger.log('Prisma connected (pg adapter)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /** Lightweight liveness probe for /ready. */
  async ping(): Promise<boolean> {
    await this.base.$queryRaw`SELECT 1`;
    return true;
  }
}
