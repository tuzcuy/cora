'use client';

import { useEffect, useRef, type ReactNode, useId } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Modal built on the native <dialog>: focus trap, backdrop, Esc handling and
 * inert page come from the platform — no Radix dependency on the static host.
 * Esc is routed through `onClose` so an unsaved-changes guard can veto it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Native Esc fires `cancel`; intercept so the caller decides.
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`w-[calc(100%-2rem)] ${width} rounded-xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40 open:animate-in`}
      onClick={(e) => {
        // click on the backdrop (outside the panel) closes
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="p-6">
        <div className="mb-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}

/** Yes/no confirmation. `danger` colours the confirm button for deletes. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Evet',
  cancelLabel = 'Vazgeç',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className={danger ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
            autoFocus
          >
            {busy ? 'Bekleyin…' : confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-muted-foreground">{description}</div>}
    </Dialog>
  );
}
