'use client';

import { Suspense } from 'react';
import { CountScreen } from '@/components/stock/count-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <CountScreen />
    </Suspense>
  );
}
