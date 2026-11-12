'use client';

import { Suspense } from 'react';
import { PricingScreen } from '@/components/pricing/pricing-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <PricingScreen />
    </Suspense>
  );
}
