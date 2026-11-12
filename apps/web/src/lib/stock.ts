import { apiJson } from '@/lib/problem';

export interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface MovementRow {
  id: string;
  qty: string;
  type: string;
  typeLabel: string;
  unitCost: string | null;
  note: string | null;
  refType: string | null;
  refId: string | null;
  at: string;
  product: Ref;
  warehouse: Ref;
  userName: string | null;
}

export interface LevelRow {
  id: string;
  onHand: string;
  reserved: string;
  available: string;
  minStock: string;
  belowMin: boolean;
  unitCode: string | null;
  product: Ref;
  warehouse: Ref;
}

export interface ReceiptRow {
  id: string;
  number: string;
  date: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  totalCost: string;
  currency: string;
  reference: string | null;
  warehouse: Ref;
  supplier: Ref | null;
  lineCount: number;
}

export interface ReceiptLine {
  id: string;
  lineNo: number;
  qty: string;
  unitId: string | null;
  unitFactor: string;
  unitCost: string;
  lineTotal: string;
  note: string | null;
  product: Ref;
  unitCode: string | null;
}

export interface ReceiptDetail extends Omit<ReceiptRow, 'lineCount'> {
  version: number;
  note: string | null;
  exchangeRate: string;
  postedAt: string | null;
  postedByName: string | null;
  lines: ReceiptLine[];
}

export interface CountRow {
  id: string;
  number: string;
  date: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  warehouse: Ref;
  lineCount: number;
}

export interface CountLine {
  id: string;
  lineNo: number;
  systemQty: string;
  countedQty: string;
  diff: string;
  note: string | null;
  product: Ref;
  unitCode: string | null;
}

export interface CountDetail extends Omit<CountRow, 'lineCount'> {
  version: number;
  note: string | null;
  postedAt: string | null;
  postedByName: string | null;
  lines: CountLine[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};

export const fetchMovements = (params: Record<string, string | number | undefined>) =>
  apiJson<Page<MovementRow>>(`/api/v1/stock/movements?${qs(params)}`);

export const fetchLevels = (params: Record<string, string | number | boolean | undefined>) =>
  apiJson<Page<LevelRow>>(`/api/v1/stock/levels?${qs(params)}`);

export const fetchReceipts = (params: Record<string, string | number | undefined>) =>
  apiJson<Page<ReceiptRow>>(`/api/v1/stock/receipts?${qs(params)}`);

export const fetchReceipt = (id: string) => apiJson<ReceiptDetail>(`/api/v1/stock/receipts/${id}`);

export const fetchCounts = (params: Record<string, string | number | undefined>) =>
  apiJson<Page<CountRow>>(`/api/v1/stock/counts?${qs(params)}`);

export const fetchCount = (id: string) => apiJson<CountDetail>(`/api/v1/stock/counts/${id}`);

export const fetchWarehouses = () =>
  apiJson<{ items: Ref[] }>('/api/v1/warehouses?pageSize=100');
