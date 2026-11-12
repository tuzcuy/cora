'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trDateTime } from '@/components/doc-status';
import { apiJson, ApiError } from '@/lib/problem';

interface SendResult {
  ok: boolean;
  status: 'SENT' | 'QUEUED' | 'FAILED';
  message: string;
  smtpConfigured: boolean;
}

interface LogEntry {
  id: string; to: string; subject: string; status: string; error: string | null;
  sentAt: string | null; createdAt: string;
}

const STATUS_LABEL: Record<string, string> = { SENT: 'Gönderildi', QUEUED: 'Kuyrukta', FAILED: 'Başarısız' };

/** Belgeyi PDF ekiyle e-posta ile gönder + gönderim log'u (P06). */
export function EmailDialog({
  open,
  onClose,
  documentId,
  documentNumber,
  defaultTo,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  documentNumber: string;
  defaultTo?: string | null;
  onSent?: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const log = useQuery({
    queryKey: ['mail-log', documentId, result?.status],
    queryFn: () => apiJson<{ items: LogEntry[]; smtpConfigured: boolean }>(`/api/v1/mail/log?documentId=${documentId}`),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setTo(defaultTo ?? '');
      setSubject(`${documentNumber} — teklifimiz`);
      setBody('');
      setResult(null);
      setError(null);
    }
  }, [open, defaultTo, documentNumber]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const res = await apiJson<SendResult>(`/api/v1/mail/documents/${documentId}/send`, {
        method: 'POST',
        json: { to, subject, body: body || undefined, attachPdf: attach },
      });
      setResult(res);
      if (res.status !== 'FAILED') onSent?.();
      void log.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fieldErrors)[0] ?? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="E-posta ile gönder"
      description={`${documentNumber} PDF eki ile gönderilir; taslak teklif "Gönderildi" durumuna geçer.`}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button onClick={() => void send()} disabled={busy || !to.trim()} data-testid="email-send">
            {busy ? 'Gönderiliyor…' : 'Gönder'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm" data-testid="email-dialog">
        {log.data && !log.data.smtpConfigured && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            SMTP sunucusu tanımlı değil: gönderim kuyruğa yazılır, sunucu ayarlanınca iletilir.
          </p>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Alıcı</span>
          <Input value={to} onChange={(e) => setTo(e.target.value)} type="email" aria-label="Alıcı e-posta" data-testid="email-to" placeholder="satinalma@musteri.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Konu</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Konu" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Mesaj (boş bırakılırsa hazır metin kullanılır)</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Mesaj" className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> PDF ekle
        </label>

        {error && <p className="text-destructive">{error}</p>}
        {result && (
          <p data-testid="email-result" className={`rounded-md border p-2 ${result.status === 'SENT' ? 'border-emerald-500/40 bg-emerald-500/10' : result.status === 'QUEUED' ? 'border-amber-500/40 bg-amber-500/10' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
            {result.message}
          </p>
        )}

        {(log.data?.items.length ?? 0) > 0 && (
          <div className="rounded-md border">
            <p className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">Gönderim geçmişi</p>
            <ul className="max-h-40 overflow-auto text-xs" data-testid="email-log">
              {log.data!.items.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-0">
                  <span className="truncate">{e.to}</span>
                  <span className="whitespace-nowrap text-muted-foreground">{STATUS_LABEL[e.status] ?? e.status} · {trDateTime(e.sentAt ?? e.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
