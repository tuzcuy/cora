import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { AuthUser } from '../decorators/current-user.decorator.js';

/**
 * Cost and profit fields never leave the API for a caller without `cost.view`
 * (INVARIANTS.md rule 5, CORA_MIMARI §4.6). They are DELETED from the payload —
 * not nulled, not hidden — so `JSON.stringify` of the response has no such key.
 *
 * Services already omit these fields; this interceptor is the backstop that
 * makes the guarantee hold for every route, including ones written later.
 */
export const COST_FIELDS = new Set([
  'purchasePrice',
  'unitCost',
  'unitCostLocal',
  'costTotalLocal',
  'lineCostLocal',
  'profit',
  'profitLocal',
  'lineProfitLocal',
  'marginPct',
  'margin',
  'monthProfit',
  'totalProfit',
]);

export function stripCostFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripCostFields) as T;
  if (value && typeof value === 'object') {
    // Decimal / Date / Buffer are leaves, not containers.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (COST_FIELDS.has(k)) continue;
      out[k] = stripCostFields(v);
    }
    return out as T;
  }
  return value;
}

@Injectable()
export class CostFieldsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (user?.permissions?.includes('cost.view')) return next.handle();
    return next.handle().pipe(map((body) => stripCostFields(body)));
  }
}
