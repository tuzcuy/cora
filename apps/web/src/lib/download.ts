import { apiFetch } from '@/lib/api-client';

/**
 * Downloads a file from an authenticated API route. The static export cannot
 * rely on a plain <a href> here: the session cookie is fine, but the API lives
 * on another origin and we need the server's filename, so fetch → blob → click.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) {
    let message = `Dosya alınamadı (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string; title?: string };
      message = body.detail ?? body.title ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Opens a PDF in a new tab instead of saving it (print preview flow). */
export async function openPdf(path: string): Promise<void> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`PDF alınamadı (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
