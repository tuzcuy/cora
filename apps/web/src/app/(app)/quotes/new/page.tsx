'use client';

import { DocumentEditor } from '@/components/sales/document-editor';

export default function Page() {
  return <DocumentEditor type="QUOTE" basePath="/quotes/" />;
}
