import { SalesStatus, SalesDocumentType, type Permission } from '../enums/index.js';

/** Side-effects a transition asks the service layer to perform. */
export const TransitionEffect = {
  SET_SENT_AT: 'SET_SENT_AT',
  CREATE_ORDER: 'CREATE_ORDER',
  RESERVE_STOCK: 'RESERVE_STOCK',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  ENQUEUE_WAREHOUSE: 'ENQUEUE_WAREHOUSE',
  START_WAREHOUSE_TASK: 'START_WAREHOUSE_TASK',
  SET_READY_AT: 'SET_READY_AT',
  POST_STOCK_SALE: 'POST_STOCK_SALE',
  /** Customer return: write RETURN_IN movements and put the goods back (P05). */
  POST_STOCK_RETURN: 'POST_STOCK_RETURN',
  SET_APPROVED_AT: 'SET_APPROVED_AT',
  SET_CANCELLED_AT: 'SET_CANCELLED_AT',
} as const;
export type TransitionEffect = (typeof TransitionEffect)[keyof typeof TransitionEffect];

/** Context available to a transition guard. */
export interface GuardContext {
  /** Now, for time-based guards (e.g. EXPIRED requires validUntil in the past). */
  now?: Date;
  validUntil?: Date | null;
  /** Whether every line has been fully shipped (drives SHIPPED vs PARTIALLY_SHIPPED completion). */
  allLinesShipped?: boolean;
  /** Whether stock could be reserved (allowNegativeStock or sufficient available). */
  canReserve?: boolean;
  /** Document margin is at/above Setting.minMarginPct, or the actor may approve low margin. */
  marginOk?: boolean;
  /** Partner stays within creditLimit, or the actor may override credit. */
  creditOk?: boolean;
}

/**
 * Guard shared by every "→ APPROVED" transition: stock must be reservable and
 * both business checks must pass. A missing flag counts as OK so callers that
 * do not run the checks (unit tests, system jobs) are not blocked; the sales
 * service always fills all three from real data.
 */
export const approvalGuard = (ctx: GuardContext): boolean =>
  ctx.canReserve !== false && ctx.marginOk !== false && ctx.creditOk !== false;

export interface Transition {
  from: SalesStatus;
  to: SalesStatus;
  docTypes: SalesDocumentType[];
  /** Permission required; null means system/automatic (no user permission). */
  permission: Permission | null;
  effects: TransitionEffect[];
  /** Optional guard; when present it must return true for the transition to be allowed. */
  guard?: (ctx: GuardContext) => boolean;
  /** Human label (Turkish) for UI action buttons. */
  label: string;
}

const QUOTE = SalesDocumentType.QUOTE;
const ORDER = SalesDocumentType.ORDER;
const RETURN = SalesDocumentType.RETURN;

/**
 * The single source of truth for sales document transitions (CORA_MIMARI §6).
 * Services MUST NOT write `status` directly — they go through `transition()`.
 */
export const TRANSITIONS: Transition[] = [
  // ---- Quote lifecycle ----
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.SENT,
    docTypes: [QUOTE],
    permission: 'quote.send',
    effects: [TransitionEffect.SET_SENT_AT],
    label: 'Müşteriye Gönder',
  },
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.APPROVED,
    docTypes: [QUOTE],
    permission: 'quote.approve',
    effects: [
      TransitionEffect.SET_APPROVED_AT,
      TransitionEffect.CREATE_ORDER,
      TransitionEffect.RESERVE_STOCK,
    ],
    guard: approvalGuard,
    label: 'Onayla',
  },
  {
    from: SalesStatus.SENT,
    to: SalesStatus.APPROVED,
    docTypes: [QUOTE],
    permission: 'quote.approve',
    effects: [
      TransitionEffect.SET_APPROVED_AT,
      TransitionEffect.CREATE_ORDER,
      TransitionEffect.RESERVE_STOCK,
    ],
    guard: approvalGuard,
    label: 'Onayla',
  },
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.REJECTED,
    docTypes: [QUOTE],
    permission: 'quote.write',
    effects: [],
    label: 'Reddet',
  },
  {
    from: SalesStatus.SENT,
    to: SalesStatus.REJECTED,
    docTypes: [QUOTE],
    permission: 'quote.write',
    effects: [],
    label: 'Reddet',
  },
  {
    from: SalesStatus.SENT,
    to: SalesStatus.EXPIRED,
    docTypes: [QUOTE],
    permission: null,
    effects: [],
    guard: (ctx) => !!ctx.validUntil && !!ctx.now && ctx.validUntil.getTime() < ctx.now.getTime(),
    label: 'Süresi Doldu',
  },
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.EXPIRED,
    docTypes: [QUOTE],
    permission: null,
    effects: [],
    guard: (ctx) => !!ctx.validUntil && !!ctx.now && ctx.validUntil.getTime() < ctx.now.getTime(),
    label: 'Süresi Doldu',
  },

  // ---- Order lifecycle ----
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.APPROVED,
    docTypes: [ORDER],
    permission: 'order.write',
    effects: [TransitionEffect.SET_APPROVED_AT, TransitionEffect.RESERVE_STOCK],
    guard: approvalGuard,
    label: 'Onayla',
  },
  {
    from: SalesStatus.APPROVED,
    to: SalesStatus.SENT_TO_WAREHOUSE,
    docTypes: [ORDER],
    permission: 'order.write',
    effects: [TransitionEffect.ENQUEUE_WAREHOUSE],
    label: 'Depoya İlet',
  },
  {
    from: SalesStatus.SENT_TO_WAREHOUSE,
    to: SalesStatus.PICKING,
    docTypes: [ORDER],
    permission: 'warehouse.pick',
    effects: [TransitionEffect.START_WAREHOUSE_TASK],
    label: 'Hazırlamaya Başla',
  },
  {
    from: SalesStatus.PICKING,
    to: SalesStatus.READY,
    docTypes: [ORDER],
    permission: 'warehouse.pick',
    effects: [TransitionEffect.SET_READY_AT],
    label: 'Hazır',
  },
  {
    from: SalesStatus.READY,
    to: SalesStatus.SHIPPED,
    docTypes: [ORDER],
    permission: 'shipment.post',
    effects: [TransitionEffect.POST_STOCK_SALE, TransitionEffect.RELEASE_RESERVATION],
    guard: (ctx) => ctx.allLinesShipped !== false,
    label: 'Sevk Et',
  },
  {
    from: SalesStatus.READY,
    to: SalesStatus.PARTIALLY_SHIPPED,
    docTypes: [ORDER],
    permission: 'shipment.post',
    effects: [TransitionEffect.POST_STOCK_SALE],
    label: 'Kısmi Sevk',
  },
  {
    from: SalesStatus.PARTIALLY_SHIPPED,
    to: SalesStatus.PARTIALLY_SHIPPED,
    docTypes: [ORDER],
    permission: 'shipment.post',
    effects: [TransitionEffect.POST_STOCK_SALE],
    guard: (ctx) => ctx.allLinesShipped !== true,
    label: 'Kısmi Sevk',
  },
  {
    from: SalesStatus.PARTIALLY_SHIPPED,
    to: SalesStatus.SHIPPED,
    docTypes: [ORDER],
    permission: 'shipment.post',
    effects: [TransitionEffect.POST_STOCK_SALE, TransitionEffect.RELEASE_RESERVATION],
    guard: (ctx) => ctx.allLinesShipped !== false,
    label: 'Sevki Tamamla',
  },
  {
    from: SalesStatus.SHIPPED,
    to: SalesStatus.COMPLETED,
    docTypes: [ORDER],
    permission: null,
    effects: [],
    label: 'Tamamlandı',
  },
  // Shipping shortcut: SHIPPABLE (shipments.service.ts) also permits creating a
  // shipment from APPROVED / SENT_TO_WAREHOUSE / PICKING (small orders shipped
  // without formal picking). Posting must then advance the order too, otherwise
  // it is stranded despite the stock having moved. Stock effects are applied by
  // the shipment service (skipStockPosting), so these mirror READY → SHIPPED.
  ...(
    [SalesStatus.APPROVED, SalesStatus.SENT_TO_WAREHOUSE, SalesStatus.PICKING] as SalesStatus[]
  ).flatMap((from): Transition[] => [
    {
      from,
      to: SalesStatus.SHIPPED,
      docTypes: [ORDER],
      permission: 'shipment.post',
      effects: [TransitionEffect.POST_STOCK_SALE, TransitionEffect.RELEASE_RESERVATION],
      guard: (ctx) => ctx.allLinesShipped !== false,
      label: 'Sevk Et',
    },
    {
      from,
      to: SalesStatus.PARTIALLY_SHIPPED,
      docTypes: [ORDER],
      permission: 'shipment.post',
      effects: [TransitionEffect.POST_STOCK_SALE],
      label: 'Kısmi Sevk',
    },
  ]),

  // ---- Approval pending (margin under threshold / credit over limit) ----
  // The service routes an approval here when approvalGuard would fail for the
  // actor but a manager could still approve. From here a manager approves, or
  // the document goes back to DRAFT for rework.
  ...([QUOTE, ORDER] as SalesDocumentType[]).flatMap((docType): Transition[] => [
    {
      from: SalesStatus.DRAFT,
      to: SalesStatus.APPROVAL_PENDING,
      docTypes: [docType],
      permission: docType === QUOTE ? 'quote.approve' : 'order.write',
      effects: [],
      label: 'Onaya Gönder',
    },
    {
      from: SalesStatus.APPROVAL_PENDING,
      to: SalesStatus.APPROVED,
      docTypes: [docType],
      permission: 'sales.approve_low_margin',
      effects:
        docType === QUOTE
          ? [
              TransitionEffect.SET_APPROVED_AT,
              TransitionEffect.CREATE_ORDER,
              TransitionEffect.RESERVE_STOCK,
            ]
          : [TransitionEffect.SET_APPROVED_AT, TransitionEffect.RESERVE_STOCK],
      // A manager may accept low margin / credit, but never missing stock.
      guard: (ctx) => ctx.canReserve !== false,
      label: 'Yönetici Onayı',
    },
    {
      from: SalesStatus.APPROVAL_PENDING,
      to: SalesStatus.DRAFT,
      docTypes: [docType],
      permission: docType === QUOTE ? 'quote.write' : 'order.write',
      effects: [],
      label: 'Taslağa Geri Al',
    },
    {
      from: SalesStatus.APPROVAL_PENDING,
      to: SalesStatus.CANCELLED,
      docTypes: [docType],
      permission: docType === QUOTE ? 'quote.write' : 'order.cancel',
      effects: [TransitionEffect.SET_CANCELLED_AT],
      label: 'İptal Et',
    },
  ]),
  {
    from: SalesStatus.SENT,
    to: SalesStatus.APPROVAL_PENDING,
    docTypes: [QUOTE],
    permission: 'quote.approve',
    effects: [],
    label: 'Onaya Gönder',
  },
  {
    from: SalesStatus.APPROVAL_PENDING,
    to: SalesStatus.REJECTED,
    docTypes: [QUOTE],
    permission: 'quote.write',
    effects: [],
    label: 'Reddet',
  },

  // ---- Cancellation (both document types) ----
  ...(
    [
      SalesStatus.DRAFT,
      SalesStatus.APPROVED,
      SalesStatus.SENT_TO_WAREHOUSE,
      SalesStatus.PICKING,
      SalesStatus.READY,
    ] as SalesStatus[]
  ).map((from): Transition => ({
    from,
    to: SalesStatus.CANCELLED,
    docTypes: [ORDER],
    permission: 'order.cancel',
    effects: [TransitionEffect.RELEASE_RESERVATION, TransitionEffect.SET_CANCELLED_AT],
    label: 'İptal Et',
  })),
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.CANCELLED,
    docTypes: [QUOTE],
    permission: 'quote.write',
    effects: [TransitionEffect.SET_CANCELLED_AT],
    label: 'İptal Et',
  },

  // ---- Return lifecycle (P05): approving a return puts the goods back ----
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.APPROVED,
    docTypes: [RETURN],
    permission: 'return.write',
    effects: [TransitionEffect.SET_APPROVED_AT, TransitionEffect.POST_STOCK_RETURN],
    label: 'İadeyi Onayla',
  },
  {
    from: SalesStatus.APPROVED,
    to: SalesStatus.COMPLETED,
    docTypes: [RETURN],
    permission: 'return.write',
    effects: [],
    label: 'Tamamlandı',
  },
  {
    from: SalesStatus.DRAFT,
    to: SalesStatus.CANCELLED,
    docTypes: [RETURN],
    permission: 'return.write',
    effects: [TransitionEffect.SET_CANCELLED_AT],
    label: 'İptal Et',
  },
  {
    from: SalesStatus.SENT,
    to: SalesStatus.CANCELLED,
    docTypes: [QUOTE],
    permission: 'quote.write',
    effects: [TransitionEffect.SET_CANCELLED_AT],
    label: 'İptal Et',
  },
];

export interface TransitionQuery {
  docType: SalesDocumentType;
  from: SalesStatus;
  to: SalesStatus;
  /** Permissions the acting user holds. Omit for system/automatic transitions. */
  permissions?: Permission[] | Set<Permission>;
  guardContext?: GuardContext;
}

function hasPermission(
  required: Permission | null,
  held?: Permission[] | Set<Permission>,
): boolean {
  if (required == null) return true;
  if (!held) return false;
  return held instanceof Set ? held.has(required) : held.includes(required);
}

/** Find the matching transition definition (ignoring permission/guard). */
export function findTransition(
  docType: SalesDocumentType,
  from: SalesStatus,
  to: SalesStatus,
): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && t.docTypes.includes(docType));
}

/** Whether a transition is allowed for the given user permissions and guard context. */
export function canTransition(query: TransitionQuery): boolean {
  const t = findTransition(query.docType, query.from, query.to);
  if (!t) return false;
  if (!hasPermission(t.permission, query.permissions)) return false;
  if (t.guard && !t.guard(query.guardContext ?? {})) return false;
  return true;
}

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_TRANSITION' | 'FORBIDDEN' | 'GUARD_FAILED',
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

/**
 * Perform a transition: validates it exists, permission is held and guard passes,
 * then returns the target status and the effects the service must apply.
 * Throws TransitionError otherwise.
 */
export function transition(query: TransitionQuery): {
  to: SalesStatus;
  effects: TransitionEffect[];
} {
  const t = findTransition(query.docType, query.from, query.to);
  if (!t) {
    throw new TransitionError(
      `Geçersiz durum geçişi: ${query.from} → ${query.to} (${query.docType})`,
      'INVALID_TRANSITION',
    );
  }
  if (!hasPermission(t.permission, query.permissions)) {
    throw new TransitionError(`Bu geçiş için yetki yok: ${t.permission}`, 'FORBIDDEN');
  }
  if (t.guard && !t.guard(query.guardContext ?? {})) {
    throw new TransitionError(
      `Geçiş koşulu sağlanmadı: ${query.from} → ${query.to}`,
      'GUARD_FAILED',
    );
  }
  return { to: t.to, effects: t.effects };
}

/** All transitions available from a status for a doc type, optionally filtered by permissions. */
export function availableTransitions(
  docType: SalesDocumentType,
  from: SalesStatus,
  permissions?: Permission[] | Set<Permission>,
): Transition[] {
  return TRANSITIONS.filter(
    (t) =>
      t.from === from &&
      t.docTypes.includes(docType) &&
      (permissions === undefined || hasPermission(t.permission, permissions)),
  );
}

/** Terminal statuses that allow no further transitions. */
export const TERMINAL_STATUSES: SalesStatus[] = [
  SalesStatus.COMPLETED,
  SalesStatus.CANCELLED,
  SalesStatus.REJECTED,
  SalesStatus.EXPIRED,
];

export function isTerminal(status: SalesStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
