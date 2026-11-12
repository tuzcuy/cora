import { apiFetch } from '@/lib/api-client';

/** RFC 7807 body as emitted by apps/api ProblemJsonFilter. */
export interface Problem {
  status: number;
  title: string;
  detail?: string;
  /** Field → Turkish message, e.g. { "name": "Marka adı gerekli", "lines[2].qty": "…" }. `_` is form-level. */
  errors?: Record<string, string>;
  /** Present on 409 VersionConflict so the UI can offer a reload. */
  currentVersion?: number;
}

export class ApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail ?? problem.title ?? `HTTP ${problem.status}`);
    this.name = 'ApiError';
  }
  get status() {
    return this.problem.status;
  }
  get isVersionConflict() {
    return this.problem.status === 409 && this.problem.currentVersion !== undefined;
  }
  get fieldErrors(): Record<string, string> {
    return this.problem.errors ?? {};
  }
}

async function readProblem(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Partial<Problem>;
    return { status: res.status, title: body.title ?? res.statusText, ...body };
  } catch {
    return { status: res.status, title: res.statusText || `HTTP ${res.status}` };
  }
}

/** JSON request that throws ApiError on non-2xx. Returns parsed body (or undefined on 204). */
export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await apiFetch(path, {
    ...rest,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) throw new ApiError(await readProblem(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Converts an API path like `lines[2].qty` into react-hook-form's `lines.2.qty`.
 */
export function toFormPath(apiPath: string): string {
  return apiPath.replace(/\[(\d+)\]/g, '.$1');
}
