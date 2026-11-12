'use client';

import { useCallback, useEffect } from 'react';

/**
 * Warns before losing a dirty form: browser navigation/refresh via
 * `beforeunload`, and in-app close attempts via the returned `guard`, which
 * asks for confirmation only when `dirty` is true.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome requires returnValue to be set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return useCallback(
    (proceed: () => void) => {
      if (!dirty || window.confirm('Kaydedilmemiş değişiklikler var. Kapatmak istiyor musunuz?')) {
        proceed();
      }
    },
    [dirty],
  );
}
