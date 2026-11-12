import { Prisma } from '@prisma/client';
import { TenantContext, TenantContextMissingError } from '../common/context/tenant-context.js';

/**
 * Model classification comes from the generated DMMF, not a hand-kept list, so
 * a new model with a `tenantId` column is scoped the moment it exists and a
 * forgotten entry can never open a hole.
 *
 * - TENANT_MODELS: every model that has a `tenantId` field. Scoped on every
 *   operation; a missing tenant context THROWS (never a silent pass-through).
 * - TENANT_FREE_MODELS: models without `tenantId`. They are either global
 *   reference data (Tenant, Permission) or child rows reached only through a
 *   tenant-scoped parent (PartnerContact, SalesDocumentLine, StockLevel, ...).
 *   The full list is recorded in docs/DECISIONS.md (D-019).
 * - SOFT_DELETE_MODELS: models with `deletedAt`. Reads and updates get
 *   `deletedAt: null` unless the caller filters on deletedAt explicitly or the
 *   request runs inside TenantContext.withDeleted().
 */
const models = Prisma.dmmf.datamodel.models;
export const TENANT_MODELS = new Set(
  models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);
export const TENANT_FREE_MODELS = new Set(
  models.filter((m) => !m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name),
);
export const SOFT_DELETE_MODELS = new Set(
  models.filter((m) => m.fields.some((f) => f.name === 'deletedAt')).map((m) => m.name),
);

type Where = Record<string, unknown>;

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'findUnique',
  'findUniqueOrThrow',
]);
const WHERE_OPS = new Set([
  ...READ_OPS,
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/**
 * Prisma client extension enforcing tenant isolation and soft delete on every
 * query of every tenant-scoped model (INVARIANTS.md rules 1 and 6, CORA_MIMARI §4).
 *
 * Unique-key operations (findUnique/update/delete/upsert) get `tenantId` merged
 * into their `where` through Prisma's extended where-unique (GA since 5.0):
 * a unique key plus extra scalar filters. This keeps the scoping inside
 * interactive transactions — a rewrite to `findFirst` on the base client would
 * silently escape `$transaction`, which is worse than the hole it closes.
 */
/**
 * Child tables carry no `tenantId` of their own; they belong to a parent row.
 * A direct read on them (a report, a notification sweep) would otherwise see
 * every tenant's rows, so reads and mass writes are scoped through the parent
 * relation named here. Anything missing from this map is refused a bare query
 * in `assertChildScoped` below rather than silently leaking.
 */
export const CHILD_PARENT: Record<string, string> = {
  StockLevel: 'product',
  SalesDocumentLine: 'document',
  StockReceiptLine: 'receipt',
  StockCountLine: 'count',
  ShipmentLine: 'shipment',
  DocumentStatusHistory: 'document',
  WarehouseTask: 'order',
  PartnerContact: 'partner',
  PartnerAddress: 'partner',
  ProductImage: 'product',
  ProductPriceHistory: 'product',
  PriceListItem: 'priceList',
  ProductAlternative: 'product',
  RolePermission: 'role',
  UserRole: 'user',
};

export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const store = TenantContext.getStore();

          // System mode (login, seeds, cross-tenant jobs) is fully transparent.
          if (store?.system) return query(args);

          // Child tables (no tenantId of their own) are scoped through their
          // parent relation, so a bare findMany cannot cross tenants.
          if (!TENANT_MODELS.has(model)) {
            const parent = CHILD_PARENT[model];
            const childTenantId = store?.tenantId;
            if (parent && childTenantId && (WHERE_OPS.has(operation) || ['updateMany', 'deleteMany', 'update', 'delete', 'aggregate', 'groupBy', 'count'].includes(operation))) {
              const where = (args.where ?? {}) as Where;
              // Respect a filter the caller already wrote on the parent.
              if (!(parent in where)) {
                args.where = { ...where, [parent]: { tenantId: childTenantId } };
              }
            }
            return query(args);
          }

          const tenantId = store?.tenantId;
          if (!tenantId) throw new TenantContextMissingError(model, operation);

          const softDelete = SOFT_DELETE_MODELS.has(model) && !store?.includeDeleted;

          switch (operation) {
            case 'create':
              // Context wins over any tenantId the caller tried to set.
              args.data = { ...(args.data ?? {}), tenantId };
              break;

            case 'createMany': {
              const data = args.data;
              args.data = Array.isArray(data)
                ? data.map((d: Where) => ({ ...d, tenantId }))
                : { ...(data ?? {}), tenantId };
              break;
            }

            case 'upsert':
              args.where = scopeWhere(args.where, tenantId, false);
              args.create = { ...(args.create ?? {}), tenantId };
              args.update = stripTenant(args.update);
              break;

            case 'update':
            case 'updateMany':
              // A row must be live to be updated; a moved tenantId is never accepted.
              args.where = scopeWhere(args.where, tenantId, softDelete);
              args.data = stripTenant(args.data);
              break;

            case 'delete':
            case 'deleteMany':
              // Hard deletes are allowed on soft-deleted rows (purge), so only tenant.
              args.where = scopeWhere(args.where, tenantId, false);
              break;

            default:
              if (WHERE_OPS.has(operation)) {
                args.where = scopeWhere(args.where, tenantId, softDelete);
              }
              break;
          }

          return query(args);
        },
      },
    },
  });
}

/** Merge tenantId (and deletedAt: null unless the caller already filters on it). */
function scopeWhere(where: Where | undefined, tenantId: string, softDelete: boolean): Where {
  const next: Where = { ...(where ?? {}), tenantId };
  if (softDelete && !('deletedAt' in next)) next.deletedAt = null;
  return next;
}

/** Update payloads can never relocate a row to another tenant. */
function stripTenant<T extends Where | undefined>(data: T): T {
  if (data && typeof data === 'object' && 'tenantId' in data) {
    const { tenantId: _drop, ...rest } = data;
    return rest as T;
  }
  return data;
}
