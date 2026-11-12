/** Shared status vocabulary for quotes, orders and the warehouse board. */

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Taslak',
  SENT: 'Gönderildi',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
  SENT_TO_WAREHOUSE: 'Depoya iletildi',
  PICKING: 'Hazırlanıyor',
  READY: 'Hazır',
  PARTIALLY_SHIPPED: 'Kısmi sevk',
  SHIPPED: 'Sevk edildi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal',
};

const TONE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SENT: 'bg-primary/10 text-primary',
  APPROVED: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-destructive/10 text-destructive',
  EXPIRED: 'bg-amber-500/12 text-amber-700 dark:text-amber-500',
  SENT_TO_WAREHOUSE: 'bg-primary/10 text-primary',
  PICKING: 'bg-amber-500/12 text-amber-700 dark:text-amber-500',
  READY: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  PARTIALLY_SHIPPED: 'bg-amber-500/12 text-amber-700 dark:text-amber-500',
  SHIPPED: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${
        TONE[status] ?? 'bg-muted text-muted-foreground'
      } ${className}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const trDate = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export const trDateTime = (v: string | Date | null | undefined) =>
  v
    ? new Date(v).toLocaleString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
