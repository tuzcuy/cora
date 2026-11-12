import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import { TenantContext } from '../context/tenant-context.js';

/**
 * Captures request provenance for the audit trail. The AuditLog row itself is
 * written by AuditService from inside the service transaction (so it cannot be
 * lost or outlive a rollback); this interceptor only makes sure that write has
 * ip / userAgent / requestId available through TenantContext.
 *
 * Runs on every request, not just mutations: a read handler may still trigger
 * an audited side effect (e.g. status auto-expiry), and the cost is a few
 * property copies.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const forwarded: string | undefined = req.headers?.['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
      req.ip ||
      req.socket?.remoteAddress ||
      undefined;
    const userAgent: string | undefined = req.headers?.['user-agent'];
    const requestId: string = req.headers?.['x-request-id'] || randomUUID();

    TenantContext.set({ ip, userAgent: userAgent?.slice(0, 512), requestId });
    const res = ctx.switchToHttp().getResponse();
    if (res?.setHeader) res.setHeader('x-request-id', requestId);
    return next.handle();
  }
}
