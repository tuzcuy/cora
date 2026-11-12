const API_BASE = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Server-side fetch to the Cora API. */
export async function apiFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
}

export { API_BASE };
