'use client';

import { Suspense } from 'react';
import { HealthScreen } from '@/components/ops/health-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <HealthScreen />
    </Suspense>
  );
}
