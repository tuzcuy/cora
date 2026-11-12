import type { FieldErrors, FieldValues, Resolver, ResolverResult } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * Minimal zod → react-hook-form resolver. @hookform/resolvers is not a
 * dependency and 20 lines cover what we use: parse, then map each issue to
 * its dotted path so `errors.name?.message` renders under the input.
 */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values): Promise<ResolverResult<T>> => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.') || '_';
      if (!(path in errors)) errors[path] = { type: issue.code, message: issue.message };
    }
    // ResolverError requires an empty `values` object, not the rejected input.
    return { values: {}, errors: errors as unknown as FieldErrors<T> };
  };
}
