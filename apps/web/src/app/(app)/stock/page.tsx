'use client';

import { Suspense } from 'react';
import { StockScreen } from '@/components/stock/stock-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <StockScreen />
    </Suspense>
  );
}
