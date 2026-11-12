'use client';

import { Suspense } from 'react';
import { ReceiptScreen } from '@/components/stock/receipt-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <ReceiptScreen />
    </Suspense>
  );
}
