'use client';

import { useState } from 'react';
import { STATUS_LABEL, StatusBadge, trDateTime } from '@/components/doc-status';

export interface HistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
  note: string | null;
  userName: string | null;
}

/** The 8-step happy path (CORA_MIMARI §6); side states render as a badge next to it. */
const STEPS = ['DRAFT', 'SENT', 'APPROVED', 'SENT_TO_WAREHOUSE', 'PICKING', 'READY', 'SHIPPED', 'COMPLETED'];
const SIDE = new Set(['APPROVAL_PENDING', 'REJECTED', 'EXPIRED', 'CANCELLED', 'PARTIALLY_SHIPPED']);

export function StatusStepper({
  type,
  status,
  history,
}: {
  type: 'QUOTE' | 'ORDER';
  status: string;
  history: HistoryRow[];
}) {
  const [openStep, setOpenStep] = useState<string | null>(null);
  // Quotes stop at APPROVED — the order continues in its own document.
  const steps = type === 'QUOTE' ? STEPS.slice(0, 3) : STEPS.filter((s) => s !== 'SENT');
  const reached = new Set(history.map((h) => h.toStatus));
  const currentIdx = steps.indexOf(status);
  const side = SIDE.has(status) ? status : null;

  return (
    <div className="space-y-2" data-testid="status-stepper">
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((s, i) => {
          const done = reached.has(s) || (currentIdx >= 0 && i < currentIdx);
          const current = s === status;
          const entries = history.filter((h) => h.toStatus === s);
          const clickable = entries.length > 0;
          return (
            <li key={s} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => setOpenStep(openStep === s ? null : s)}
                data-step={s}
                data-state={current ? 'current' : done ? 'done' : 'todo'}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  current
                    ? 'border-primary bg-primary text-primary-foreground'
                    : done
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-border text-muted-foreground'
                } ${clickable ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${current ? 'bg-primary-foreground' : done ? 'bg-emerald-500' : 'bg-border'}`} />
                {STATUS_LABEL[s] ?? s}
              </button>
              {i < steps.length - 1 && <span className="h-px w-4 bg-border" />}
            </li>
          );
        })}
        {side && (
          <li className="ml-2">
            <StatusBadge status={side} />
          </li>
        )}
      </ol>
      {openStep && (
        <div className="rounded-md border bg-card p-3 text-sm shadow-sm" role="dialog" aria-label={`${STATUS_LABEL[openStep]} geçmişi`}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{STATUS_LABEL[openStep] ?? openStep}</p>
          {history
            .filter((h) => h.toStatus === openStep)
            .map((h) => (
              <p key={h.id} className="text-muted-foreground">
                <span className="text-foreground">{h.userName ?? 'Sistem'}</span> · {trDateTime(h.at)}
                {h.note ? <span> · {h.note}</span> : null}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
