'use client';

import { Suspense } from 'react';
import { ImportWizard } from '@/components/documents/import-wizard';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <ImportWizard />
    </Suspense>
  );
}
