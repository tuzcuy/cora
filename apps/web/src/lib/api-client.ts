import type { SessionUser } from './types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Access token lives in memory only (never localStorage). Refresh token is an
// httpOnly cookie set by the API (cross-subdomain, D-015).
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;

/** fetch with an abort timeout so an unreachable/slow API never hangs the UI. */
async function timedFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Uploads, exports and PDFs are slower than a normal call. */
const SLOW = /\/export\/|\.xlsx|\/pdf|\/import\/|\/files\//;

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  // FormData must keep the browser's own multipart boundary — forcing
  // application/json here silently breaks every upload.
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isForm && !headers.has('content-type'))
    headers.set('content-type', 'application/json');
  const timeout = isForm || SLOW.test(path) ? 120_000 : 8000;
  return timedFetch(`${API}${path}`, { ...init, headers, credentials: 'include' }, timeout);
}

/** Fetch with automatic one-shot silent refresh on 401. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  let res = await raw(path, init);
  if (res.status === 401 && retry) {
    const user = await tryRefresh();
    if (user) res = await raw(path, init);
  }
  return res;
}

/**
 * Exchange the refresh cookie for a new access token. Returns the user or null.
 * NEVER throws — any network/CORS/parse failure resolves to null so the app
 * falls back to the login screen instead of hanging on the auth spinner.
 */
export async function tryRefresh(): Promise<SessionUser | null> {
  try {
    const res = await timedFetch(`${API}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      accessToken = null;
      return null;
    }
    const data = await res.json();
    accessToken = data.accessToken ?? null;
    return (data.user as SessionUser) ?? null;
  } catch {
    accessToken = null;
    return null;
  }
}

/** Promise-based delay for cold-start retry backoff. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The API runs on a Render free instance that sleeps when idle; a cold start
// can take ~30-60s during which requests time out or the edge returns 5xx. On
// login we retry with backoff and signal "waking up" (onWaking) so the first
// demo login doesn't look like a failure. Bad credentials (4xx) never retry.
const WAKE_STATUS = new Set([502, 503, 504]);

export async function apiLogin(
  email: string,
  password: string,
  onWaking?: () => void,
): Promise<SessionUser> {
  const backoffMs = [2_000, 4_000, 8_000, 8_000];
  const attempts = backoffMs.length + 1; // 5 tries total
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await timedFetch(
        `${API}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        },
        30_000, // generous per-attempt timeout for a cold API
      );
    } catch {
      // Timeout (AbortError) or network/CORS failure — API likely still waking.
      lastError = new Error('API sunucusuna ulaşılamadı. Lütfen tekrar deneyin.');
      if (i < attempts - 1) {
        onWaking?.();
        await sleep(backoffMs[i]);
        continue;
      }
      throw lastError;
    }

    if (WAKE_STATUS.has(res.status) && i < attempts - 1) {
      // Render edge 5xx while the instance boots — keep waiting.
      onWaking?.();
      await sleep(backoffMs[i]);
      continue;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail ?? data.message ?? 'Giriş başarısız');
    accessToken = data.accessToken;
    return data.user as SessionUser;
  }

  throw lastError ?? new Error('Giriş başarısız');
}

export async function apiLogout(): Promise<void> {
  await timedFetch(`${API}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
    () => undefined,
  );
  accessToken = null;
}
