'use client';

import { Suspense } from 'react';
import { RiskScreen } from '@/components/partners/risk-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <RiskScreen />
    </Suspense>
  );
}
