'use client';

import { Suspense } from 'react';
import { EDocsScreen } from '@/components/edocs/edocs-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <EDocsScreen />
    </Suspense>
  );
}
