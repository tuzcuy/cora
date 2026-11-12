import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const query = (): ArgumentMetadata => ({ type: 'query', metatype: undefined, data: undefined });
const body = (): ArgumentMetadata => ({ type: 'body', metatype: undefined, data: undefined });

describe('ZodValidationPipe — empty query params', () => {
  const schema = z.object({
    status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']).optional(),
    q: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
  });

  it('treats empty enum query param as absent (no ValidationError)', () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ status: '', q: '', page: '1' }, query()) as {
      status?: string;
      q?: string;
      page: number;
    };
    expect(out.status).toBeUndefined();
    expect(out.q).toBeUndefined();
    expect(out.page).toBe(1);
  });

  it('keeps a real enum value on a query', () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ status: 'POSTED' }, query()) as { status?: string };
    expect(out.status).toBe('POSTED');
  });

  it('does NOT strip empty strings from a body (a form may clear a field)', () => {
    const pipe = new ZodValidationPipe(z.object({ notes: z.string() }));
    const out = pipe.transform({ notes: '' }, body()) as { notes: string };
    expect(out.notes).toBe('');
  });
});
