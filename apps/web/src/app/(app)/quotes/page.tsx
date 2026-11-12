'use client';

import { Suspense } from 'react';
import { DocumentsScreen } from '@/components/documents-screen';

export default function Page() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Yükleniyor…</div>}>
      <DocumentsScreen type="QUOTE" title="Teklifler" />
    </Suspense>
  );
}
