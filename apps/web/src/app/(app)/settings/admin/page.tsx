'use client';

import { Suspense } from 'react';
import { AdminScreen } from '@/components/admin/admin-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <AdminScreen />
    </Suspense>
  );
}
