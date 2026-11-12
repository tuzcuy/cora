'use client';

import { Suspense } from 'react';
import { ReturnScreen } from '@/components/shipments/return-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <ReturnScreen />
    </Suspense>
  );
}
