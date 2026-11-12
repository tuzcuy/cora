import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** Tenant settings the sales flow depends on, with their defaults (seed.ts + P04). */
export interface SalesSettings {
  allowNegativeStock: boolean;
  /** Below this document margin (%) approval needs sales.approve_low_margin (P04 D3). */
  minMarginPct: number;
  defaultVatRate: number;
  quoteValidityDays: number;
  autoSendToWarehouse: boolean;
}

const DEFAULTS: SalesSettings = {
  allowNegativeStock: false,
  minMarginPct: 15,
  defaultVatRate: 20,
  quoteValidityDays: 15,
  autoSendToWarehouse: true,
};

/**
 * Reads the JSON key/value Setting rows of the current tenant (scoped by the
 * extension). Missing keys fall back to DEFAULTS, so a tenant seeded before a
 * setting existed keeps working — minMarginPct was introduced in P04.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(): Promise<SalesSettings> {
    const rows = await this.prisma.db.setting.findMany({
      where: { key: { in: Object.keys(DEFAULTS) } },
      select: { key: true, value: true },
    });
    const out: SalesSettings = { ...DEFAULTS };
    for (const r of rows) {
      const k = r.key as keyof SalesSettings;
      if (r.value === null || r.value === undefined) continue;
      const bag = out as unknown as Record<string, unknown>;
      if (typeof DEFAULTS[k] === 'number') bag[k] = Number(r.value);
      else if (typeof DEFAULTS[k] === 'boolean') bag[k] = Boolean(r.value);
    }
    return out;
  }
}
