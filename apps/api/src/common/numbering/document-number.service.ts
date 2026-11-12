import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../context/tenant-context.js';

export type DocType = 'QUOTE' | 'ORDER' | 'SHIPMENT' | 'STOCK_RECEIPT' | 'STOCK_COUNT' | 'RETURN';

/** Only the raw-SQL surface is needed, so both the base and the extended tx client fit. */
export type RawTx = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

const DEFAULT_PREFIX: Record<DocType, string> = {
  QUOTE: 'TEK',
  ORDER: 'SIP',
  SHIPMENT: 'IRS',
  STOCK_RECEIPT: 'GIR',
  STOCK_COUNT: 'SAY',
  RETURN: 'IAD',
};

/**
 * Document numbering (INVARIANTS.md rule 9): one DocumentSequence row per
 * tenant/docType/year, bumped under `SELECT … FOR UPDATE` inside the caller's
 * transaction. Two concurrent writers serialise on the row lock, so numbers are
 * gap-free and unique; the concurrency test in security.spec.ts proves it.
 *
 * Raw SQL is not covered by the tenant extension, so tenantId is bound here
 * explicitly on every statement.
 */
@Injectable()
export class DocumentNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Like next(), but skips numbers already taken. A data import (or an old
   * seed) can write documents without touching DocumentSequence; without this
   * the next real write would fail forever on the unique constraint.
   */
  async nextAvailable(
    tx: RawTx,
    docType: DocType,
    isTaken: (number: string) => Promise<boolean>,
    opts: { year?: number; prefix?: string; maxTries?: number } = {},
  ): Promise<{ number: string; seq: number; year: number }> {
    const maxTries = opts.maxTries ?? 20;
    for (let i = 0; i < maxTries; i += 1) {
      const candidate = await this.next(tx, docType, opts);
      if (!(await isTaken(candidate.number))) return candidate;
    }
    throw new Error(`Boş belge numarası bulunamadı: ${docType} (${maxTries} deneme)`);
  }

  /** Format: `{prefix}{YYYY}-{seq padded to 4}` e.g. TEK2026-0042. */
  format(prefix: string, year: number, n: number): string {
    return `${prefix}${year}-${String(n).padStart(4, '0')}`;
  }

  /**
   * Allocate the next number. MUST be called with the interactive transaction
   * that also writes the document, otherwise the lock is released before the
   * document exists and a crash leaves a gap.
   */
  async next(
    tx: RawTx,
    docType: DocType,
    opts: { year?: number; prefix?: string } = {},
  ): Promise<{ number: string; seq: number; year: number }> {
    const tenantId = TenantContext.requireTenantId();
    const year = opts.year ?? new Date().getFullYear();
    const prefix = opts.prefix ?? DEFAULT_PREFIX[docType];

    // Ensure the row exists without racing another creator.
    await tx.$executeRaw(Prisma.sql`
      insert into "DocumentSequence" ("id", "tenantId", "docType", "year", "prefix", "lastNumber")
      values (${cuid()}, ${tenantId}, ${docType}::"DocumentType", ${year}, ${prefix}, 0)
      on conflict ("tenantId", "docType", "year") do nothing
    `);

    // Lock, then bump. RETURNING gives us the value we own.
    const rows = await tx.$queryRaw<{ lastNumber: number; prefix: string }[]>(Prisma.sql`
      update "DocumentSequence"
         set "lastNumber" = "lastNumber" + 1
       where "id" = (
         select "id" from "DocumentSequence"
          where "tenantId" = ${tenantId} and "docType" = ${docType}::"DocumentType" and "year" = ${year}
          for update
       )
      returning "lastNumber", "prefix"
    `);
    const row = rows[0];
    if (!row) throw new Error(`DocumentSequence satırı kilitlenemedi: ${docType}/${year}`);
    const seq = Number(row.lastNumber);
    return { number: this.format(row.prefix || prefix, year, seq), seq, year };
  }
}

/** cuid-shaped id for the raw insert (Prisma's @default(cuid()) is client-side). */
function cuid(): string {
  const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'c';
  for (let i = 0; i < 24; i += 1) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}
