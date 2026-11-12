'use client';

import { Suspense } from 'react';
import { ShipmentScreen } from '@/components/shipments/shipment-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <ShipmentScreen />
    </Suspense>
  );
}
