# Cora — engineering invariants

These are the non-negotiable rules of the codebase. Code comments cite them by number
(e.g. "INVARIANTS.md rule 5"). The long-form architecture document is
[`docs/CORA_MIMARI.md`](CORA_MIMARI.md) (Turkish); if the two ever disagree, the
architecture document wins.

## Language rule

- UI strings are **Turkish** (`apps/web/messages/tr.json`); code, database schema, API and commit messages are **English**.
- Domain names follow the glossary: Product, BusinessPartner, SalesDocument (QUOTE|ORDER), Shipment, Warehouse, StockLevel, StockMovement, StockReceipt, WarehouseTask.

## Hard rules

1. Every business table carries `tenantId`, and every query is tenant-filtered. The Prisma client extension enforces this — never bypass the extension.
2. Money, quantities and FX rates are always `Decimal` (`decimal.js` / Prisma Decimal). Never do money math with `number`.
3. Price, discount, VAT, total and margin calculations live **only** in `packages/shared/src/pricing/`. The UI and the API call the same functions.
4. Document status is never written directly; transitions go through `packages/shared/src/workflow/sales-state-machine.ts`. A new transition means a new table entry plus a test.
5. Authorization: controllers carry `@RequirePermission(...)` guards; cost/profit fields are **deleted** in the serializer when the caller lacks `cost.view`.
6. Every service that writes documents or cards records an `AuditLog` entry (with a field-level diff). Deletion is soft delete (`deletedAt`).
7. Documents carry a `version` for optimistic locking; on conflict the API returns 409 and the UI shows a "record changed, reload" message.
8. Stock changes only through the `StockMovement` ledger; `StockLevel` is never updated directly.
9. Document numbers are generated inside a transaction from `DocumentSequence` with `SELECT … FOR UPDATE`.
10. Secrets never enter the repository. `.env.example` is kept up to date.
11. Lists are server-side paginated/filtered/sorted; the indexes needed for 100k products and 1M order lines are defined in migrations.
12. Turkish text search uses a folded-lowercase `searchText` column with a `pg_trgm` GIN index — never an `ILIKE` full-table scan.

## Definition of done (per module)

- Prisma schema + migration + seed data
- NestJS module: zod DTOs, service, controller, guards, OpenAPI annotations
- Vitest: unit tests for calculations/business rules; integration tests for services
- Next.js screens: virtualized list, card/form, empty/error/loading states
- Keyboard support: ↑↓/Enter in lists, Ctrl+S save, Esc close in forms
- Playwright coverage for the main flow
- `pnpm lint && pnpm typecheck && pnpm test` green
