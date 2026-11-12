import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { TenantContextMissingError } from '../context/tenant-context.js';

/**
 * Global exception filter emitting RFC 7807 `application/problem+json`
 * (CORA_MIMARI §4.9). Every body has type/title/status/detail/instance; a
 * validation or conflict failure adds `errors: { "<field>": "<Türkçe mesaj>" }`
 * so forms can place messages under the right input.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = 500;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        title = exception.name;
        detail = body;
      } else if (body && typeof body === 'object') {
        const o = body as Record<string, unknown>;
        title = (o.error as string) ?? exception.name;
        detail = Array.isArray(o.message)
          ? (o.message as string[]).join('; ')
          : ((o.message as string) ?? undefined);
        if (o.errors) extra.errors = o.errors;
        if (o.issues) extra.issues = o.issues;
        if (o.currentVersion !== undefined) extra.currentVersion = o.currentVersion;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, title, detail, extra } = mapPrismaError(exception));
      if (status >= 500) this.logger.error(exception.message);
    } else if (exception instanceof TenantContextMissingError) {
      // A programming error, never a user error: surface loudly, never mask.
      status = 500;
      title = 'TenantContextMissing';
      detail = exception.message;
      this.logger.error(exception.message);
    } else if (exception instanceof Error) {
      detail = exception.message;
      this.logger.error(exception.stack ?? exception.message);
    }

    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error(`${req.method} ${req.url} -> ${status}: ${detail}`);
    }

    res
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title,
        status,
        detail,
        instance: req.url,
        ...extra,
      });
  }
}

/**
 * Prisma engine errors that a user can actually cause map to 4xx with a field
 * message; everything else stays a 500.
 */
function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
  status: number;
  title: string;
  detail: string;
  extra: Record<string, unknown>;
} {
  const meta = (e.meta ?? {}) as { target?: string[] | string; field_name?: string };
  switch (e.code) {
    case 'P2002': {
      // Unique violation. target is like ["tenantId","code"]; tenantId is never
      // the user's fault, so blame the other column.
      const cols = (Array.isArray(meta.target) ? meta.target : [meta.target ?? 'kayıt']).filter(
        (c) => c && c !== 'tenantId',
      );
      const field = cols[0] ?? 'kayıt';
      return {
        status: 409,
        title: 'Conflict',
        detail: 'Aynı değere sahip bir kayıt zaten var',
        extra: { errors: { [field]: 'Bu değer zaten kullanılıyor' } },
      };
    }
    case 'P2003':
      // FK restrict on delete/update: the row is referenced elsewhere.
      return {
        status: 409,
        title: 'Conflict',
        detail: 'Kayıt kullanımda olduğu için silinemiyor veya değiştirilemiyor',
        extra: { errors: { _: 'Bu kayda bağlı başka kayıtlar var' } },
      };
    case 'P2025':
      return { status: 404, title: 'Not Found', detail: 'Kayıt bulunamadı', extra: {} };
    default:
      return { status: 500, title: 'Database Error', detail: e.message, extra: {} };
  }
}
