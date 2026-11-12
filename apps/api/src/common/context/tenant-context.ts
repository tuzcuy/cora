import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission } from '@cora/shared';

export interface RequestStore {
  tenantId?: string;
  userId?: string;
  permissions?: Permission[];
  modules?: string[];
  /** When true, tenant filtering is bypassed (auth/login, seeding, cross-tenant system ops). */
  system?: boolean;
  /** When true, soft-deleted rows are NOT filtered out ("silinenleri göster"). */
  includeDeleted?: boolean;
  /** Request metadata captured by AuditInterceptor for AuditLog rows. */
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** Thrown by the Prisma tenant extension when a tenant-scoped query runs without a tenant. */
export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tenant context yok: ${model}.${operation} kiracı bağlamı olmadan çalıştırılamaz. ` +
        'Kimliği doğrulanmış bir istek içinde olun veya TenantContext.runSystem() kullanın.',
    );
    this.name = 'TenantContextMissingError';
  }
}

const als = new AsyncLocalStorage<RequestStore>();

/**
 * Per-request tenant/user context backed by AsyncLocalStorage. The Prisma
 * extension reads `tenantId` from here to scope every query (CORA_MIMARI §4.1).
 */
export const TenantContext = {
  /**
   * Run a SYNC callback within a fresh store (the request middleware passes
   * Express `next`). For promise-returning work use runAsync — see runSystem.
   */
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn);
  },
  /**
   * Run an async callback in system mode (tenant filtering bypassed).
   *
   * The callback is awaited INSIDE the store on purpose: a Prisma query is a
   * lazy thenable that executes when `.then` is called, and if that happens in
   * the caller's scope the AsyncLocalStorage store is gone by then. Awaiting
   * here keeps the whole query lifetime inside the store.
   */
  runSystem<T>(fn: () => T | Promise<T>): Promise<T> {
    return als.run({ system: true }, async () => await fn());
  },
  /**
   * Run an async callback with soft-deleted rows visible. Inherits the current
   * store so tenant scoping stays intact — only the deletedAt filter is lifted.
   * Awaited inside the store for the same reason as runSystem.
   */
  withDeleted<T>(fn: () => T | Promise<T>): Promise<T> {
    const current = als.getStore() ?? {};
    return als.run({ ...current, includeDeleted: true }, async () => await fn());
  },
  /** Async-safe variant of run(): use for anything that returns a promise. */
  runAsync<T>(store: RequestStore, fn: () => T | Promise<T>): Promise<T> {
    return als.run(store, async () => await fn());
  },
  getStore(): RequestStore | undefined {
    return als.getStore();
  },
  getTenantId(): string | undefined {
    return als.getStore()?.tenantId;
  },
  requireTenantId(): string {
    const id = als.getStore()?.tenantId;
    if (!id) throw new Error('Tenant context yok: tenantId gerekli.');
    return id;
  },
  getUserId(): string | undefined {
    return als.getStore()?.userId;
  },
  /** Mutate the current request store in place (used by the auth guard). */
  set(patch: Partial<RequestStore>): void {
    const store = als.getStore();
    if (store) Object.assign(store, patch);
  },
};
