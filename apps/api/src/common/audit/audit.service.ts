import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContext } from '../context/tenant-context.js';

export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | (string & {});

/**
 * Any client that can write AuditLog — the extended client or an interactive
 * tx. Structural on purpose: the extended client's generic `create` signature
 * is not assignable to Prisma.TransactionClient's, and we only ever call create.
 */
export interface AuditWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditLog: { create: (args: any) => Promise<unknown> };
}

/** Field names matching these never reach the audit trail in clear text. */
const SENSITIVE = /password|passwordhash|token|secret|apikey|api_key|authorization|cookie/i;
const MASK = '***';

type Plain = Record<string, unknown>;

/** Values worth comparing: Decimal → string, Date → ISO, everything else as-is. */
function normalise(v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Relations/objects: compare by JSON so nested edits still register.
    return JSON.stringify(v);
  }
  return v;
}

function mask(key: string, v: unknown): unknown {
  return SENSITIVE.test(key) && v !== null && v !== undefined ? MASK : v;
}

/**
 * Builds a diff holding ONLY the fields that changed, masked. Shape:
 *   { code: { from: 'A', to: 'B' }, passwordHash: { from: '***', to: '***' } }
 * Bookkeeping columns (updatedAt, version, searchText) are skipped — they change
 * on every write and would bury the real edit.
 */
export function buildDiff(before: Plain | null, after: Plain | null): Plain {
  const skip = new Set(['updatedAt', 'version', 'searchText']);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const diff: Plain = {};
  for (const k of keys) {
    if (skip.has(k)) continue;
    const b = before ? normalise(before[k]) : undefined;
    const a = after ? normalise(after[k]) : undefined;
    if (b === a) continue;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    diff[k] = {
      from: before ? mask(k, before[k] instanceof Prisma.Decimal ? b : before[k]) : undefined,
      to: after ? mask(k, after[k] instanceof Prisma.Decimal ? a : after[k]) : undefined,
    };
  }
  return diff;
}

/**
 * Writes AuditLog rows (INVARIANTS.md rule 6). Called by BaseCrudService inside the
 * SAME transaction as the write it describes, so an audit row can neither be
 * lost nor outlive a rolled-back change. Who/where comes from TenantContext,
 * filled by JwtAuthGuard and AuditInterceptor.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: {
      entity: string;
      entityId: string;
      action: AuditAction;
      before?: Plain | null;
      after?: Plain | null;
      /** Pre-computed diff wins over before/after when given. */
      diff?: Plain;
    },
    tx?: AuditWriter,
  ): Promise<void> {
    const store = TenantContext.getStore();
    const diff = input.diff ?? buildDiff(input.before ?? null, input.after ?? null);
    // Nothing changed → no noise in the trail (idempotent PATCH).
    if (input.action === 'update' && Object.keys(diff).length === 0) return;

    const writer = tx ?? this.prisma.db;
    await writer.auditLog.create({
      data: {
        // tenantId is injected by the tenant extension from context.
        userId: store?.userId ?? null,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        diff: diff as Prisma.InputJsonValue,
        ip: store?.ip ?? null,
        userAgent: store?.userAgent ?? null,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  }
}
