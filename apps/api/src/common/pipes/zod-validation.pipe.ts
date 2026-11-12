import {
  PipeTransform,
  Injectable,
  BadRequestException,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Formats a zod issue path the way forms address fields: `lines[2].qty`.
 * The web form layer reads `errors[path]` and renders it under the input.
 */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, '');
}

/**
 * Validates and parses a payload against a Zod schema. Usage:
 *  `@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto`.
 *
 * On failure the problem+json body carries BOTH shapes:
 *  - `errors`: `{ "lines[2].qty": "Miktar 0'dan büyük olmalı" }` — field map for forms
 *  - `issues`: the raw list, for clients that want every message per path
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, metadata?: ArgumentMetadata): unknown {
    // Query strings carry empty values for "no filter" (e.g. ?status=&q=). Treat
    // '' as absent so optional enums/filters don't fail validation. Scoped to
    // query params only — a body may legitimately send '' to clear a field.
    let input = value;
    if (
      metadata?.type === 'query' &&
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input)
    ) {
      input = Object.fromEntries(
        Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== ''),
      );
    }
    const result = this.schema.safeParse(input);
    if (!result.success) {
      const errors: Record<string, string> = {};
      const issues = result.error.issues.map((i) => {
        const path = formatIssuePath(i.path) || '_';
        // First message per field wins; forms show one line per input.
        if (!(path in errors)) errors[path] = i.message;
        return { path, message: i.message };
      });
      throw new BadRequestException({
        error: 'ValidationError',
        message: 'Doğrulama hatası',
        errors,
        issues,
      });
    }
    return result.data;
  }
}
