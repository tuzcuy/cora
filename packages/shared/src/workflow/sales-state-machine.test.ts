import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  availableTransitions,
  isTerminal,
  TransitionError,
  TransitionEffect,
} from './sales-state-machine.js';
import { SalesStatus, SalesDocumentType } from '../enums/index.js';

const QUOTE = SalesDocumentType.QUOTE;
const ORDER = SalesDocumentType.ORDER;

describe('canTransition (permissions)', () => {
  it('allows QUOTE DRAFT -> SENT with quote.send', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.SENT,
        permissions: ['quote.send'],
      }),
    ).toBe(true);
  });

  it('forbids QUOTE DRAFT -> SENT without permission', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.SENT,
        permissions: [],
      }),
    ).toBe(false);
  });

  it('rejects an undefined transition (DRAFT -> SHIPPED)', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.SHIPPED,
        permissions: ['quote.approve'],
      }),
    ).toBe(false);
  });

  it('accepts a Set of permissions', () => {
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.READY,
        to: SalesStatus.SHIPPED,
        permissions: new Set(['shipment.post']),
      }),
    ).toBe(true);
  });
});

describe('transition (effects + errors)', () => {
  it('QUOTE SENT -> APPROVED creates order and reserves stock', () => {
    const { to, effects } = transition({
      docType: QUOTE,
      from: SalesStatus.SENT,
      to: SalesStatus.APPROVED,
      permissions: ['quote.approve'],
    });
    expect(to).toBe(SalesStatus.APPROVED);
    expect(effects).toContain(TransitionEffect.CREATE_ORDER);
    expect(effects).toContain(TransitionEffect.RESERVE_STOCK);
  });

  it('ORDER READY -> SHIPPED posts stock sale and releases reservation', () => {
    const { effects } = transition({
      docType: ORDER,
      from: SalesStatus.READY,
      to: SalesStatus.SHIPPED,
      permissions: ['shipment.post'],
    });
    expect(effects).toContain(TransitionEffect.POST_STOCK_SALE);
    expect(effects).toContain(TransitionEffect.RELEASE_RESERVATION);
  });

  it('throws INVALID_TRANSITION for an impossible move', () => {
    expect(() =>
      transition({
        docType: ORDER,
        from: SalesStatus.DRAFT,
        to: SalesStatus.SHIPPED,
        permissions: ['order.write'],
      }),
    ).toThrowError(TransitionError);
    try {
      transition({ docType: ORDER, from: SalesStatus.DRAFT, to: SalesStatus.SHIPPED });
    } catch (e) {
      expect((e as TransitionError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('throws FORBIDDEN when permission missing', () => {
    try {
      transition({
        docType: QUOTE,
        from: SalesStatus.SENT,
        to: SalesStatus.APPROVED,
        permissions: [],
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TransitionError).code).toBe('FORBIDDEN');
    }
  });
});

describe('guards', () => {
  it('QUOTE SENT -> EXPIRED passes only when validUntil is in the past', () => {
    const past = new Date('2020-01-01');
    const now = new Date('2026-01-01');
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.SENT,
        to: SalesStatus.EXPIRED,
        guardContext: { validUntil: past, now },
      }),
    ).toBe(true);
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.SENT,
        to: SalesStatus.EXPIRED,
        guardContext: { validUntil: new Date('2999-01-01'), now },
      }),
    ).toBe(false);
  });

  it('ORDER READY -> SHIPPED fails when not all lines shipped', () => {
    try {
      transition({
        docType: ORDER,
        from: SalesStatus.READY,
        to: SalesStatus.SHIPPED,
        permissions: ['shipment.post'],
        guardContext: { allLinesShipped: false },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as TransitionError).code).toBe('GUARD_FAILED');
    }
  });
});

describe('cancellation rules', () => {
  it('allows cancelling an APPROVED order (releases reservation)', () => {
    const { effects } = transition({
      docType: ORDER,
      from: SalesStatus.APPROVED,
      to: SalesStatus.CANCELLED,
      permissions: ['order.cancel'],
    });
    expect(effects).toContain(TransitionEffect.RELEASE_RESERVATION);
  });

  it('does NOT allow cancelling a SHIPPED order', () => {
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.SHIPPED,
        to: SalesStatus.CANCELLED,
        permissions: ['order.cancel'],
      }),
    ).toBe(false);
  });
});

describe('availableTransitions & terminal', () => {
  it('lists user-permitted transitions from a status', () => {
    const tos = availableTransitions(QUOTE, SalesStatus.DRAFT, ['quote.send']).map((t) => t.to);
    expect(tos).toContain(SalesStatus.SENT);
    expect(tos).not.toContain(SalesStatus.APPROVED); // needs quote.approve
    expect(tos).not.toContain(SalesStatus.REJECTED); // needs quote.write
  });

  it('flags terminal statuses', () => {
    expect(isTerminal(SalesStatus.COMPLETED)).toBe(true);
    expect(isTerminal(SalesStatus.CANCELLED)).toBe(true);
    expect(isTerminal(SalesStatus.DRAFT)).toBe(false);
  });
});

describe('APPROVAL_PENDING (P04 D2/D3) ve onay guard’ları', () => {
  it('marj düşükse (marginOk=false) DRAFT -> APPROVED guard’da kalır', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVED,
        permissions: ['quote.approve'],
        guardContext: { marginOk: false },
      }),
    ).toBe(false);
    expect(() =>
      transition({
        docType: ORDER,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVED,
        permissions: ['order.write'],
        guardContext: { creditOk: false },
      }),
    ).toThrow(TransitionError);
  });

  it('bayrak verilmezse onay engellenmez (sistem/test çağrıları)', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVED,
        permissions: ['quote.approve'],
      }),
    ).toBe(true);
  });

  it('stok rezerve edilemiyorsa hiçbir onay geçmez — yönetici onayı dahil', () => {
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVED,
        permissions: ['order.write'],
        guardContext: { canReserve: false },
      }),
    ).toBe(false);
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.APPROVAL_PENDING,
        to: SalesStatus.APPROVED,
        permissions: ['sales.approve_low_margin'],
        guardContext: { canReserve: false },
      }),
    ).toBe(false);
  });

  it('DRAFT/SENT -> APPROVAL_PENDING satışçının kendi yetkisiyle açılır', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVAL_PENDING,
        permissions: ['quote.approve'],
      }),
    ).toBe(true);
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.SENT,
        to: SalesStatus.APPROVAL_PENDING,
        permissions: ['quote.approve'],
      }),
    ).toBe(true);
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.DRAFT,
        to: SalesStatus.APPROVAL_PENDING,
        permissions: ['order.write'],
      }),
    ).toBe(true);
  });

  it('APPROVAL_PENDING -> APPROVED yalnız sales.approve_low_margin ile, onay etkileriyle', () => {
    expect(
      canTransition({
        docType: QUOTE,
        from: SalesStatus.APPROVAL_PENDING,
        to: SalesStatus.APPROVED,
        permissions: ['quote.approve'],
      }),
    ).toBe(false);
    const q = transition({
      docType: QUOTE,
      from: SalesStatus.APPROVAL_PENDING,
      to: SalesStatus.APPROVED,
      permissions: ['sales.approve_low_margin'],
    });
    expect(q.effects).toEqual([
      TransitionEffect.SET_APPROVED_AT,
      TransitionEffect.CREATE_ORDER,
      TransitionEffect.RESERVE_STOCK,
    ]);
    const o = transition({
      docType: ORDER,
      from: SalesStatus.APPROVAL_PENDING,
      to: SalesStatus.APPROVED,
      permissions: ['sales.approve_low_margin'],
    });
    expect(o.effects).toEqual([TransitionEffect.SET_APPROVED_AT, TransitionEffect.RESERVE_STOCK]);
  });

  it('APPROVAL_PENDING: taslağa geri / iptal / red mümkün, SHIPPED değil; terminal değil', () => {
    expect(
      availableTransitions(QUOTE, SalesStatus.APPROVAL_PENDING)
        .map((t) => t.to)
        .sort(),
    ).toEqual(
      [SalesStatus.APPROVED, SalesStatus.CANCELLED, SalesStatus.DRAFT, SalesStatus.REJECTED].sort(),
    );
    expect(
      availableTransitions(ORDER, SalesStatus.APPROVAL_PENDING)
        .map((t) => t.to)
        .sort(),
    ).toEqual([SalesStatus.APPROVED, SalesStatus.CANCELLED, SalesStatus.DRAFT].sort());
    expect(
      canTransition({
        docType: ORDER,
        from: SalesStatus.APPROVAL_PENDING,
        to: SalesStatus.SHIPPED,
        permissions: ['shipment.post'],
      }),
    ).toBe(false);
    expect(isTerminal(SalesStatus.APPROVAL_PENDING)).toBe(false);
  });
});

describe('shipping shortcut: posting from an early SHIPPABLE state advances the order', () => {
  for (const from of [SalesStatus.APPROVED, SalesStatus.SENT_TO_WAREHOUSE, SalesStatus.PICKING]) {
    it(`ORDER ${from} -> SHIPPED with shipment.post when all lines shipped`, () => {
      expect(
        canTransition({
          docType: ORDER,
          from,
          to: SalesStatus.SHIPPED,
          permissions: ['shipment.post'],
          guardContext: { allLinesShipped: true },
        }),
      ).toBe(true);
    });
    it(`ORDER ${from} -> PARTIALLY_SHIPPED with shipment.post`, () => {
      expect(
        canTransition({
          docType: ORDER,
          from,
          to: SalesStatus.PARTIALLY_SHIPPED,
          permissions: ['shipment.post'],
        }),
      ).toBe(true);
    });
    it(`ORDER ${from} -> SHIPPED forbidden without shipment.post`, () => {
      expect(
        canTransition({
          docType: ORDER,
          from,
          to: SalesStatus.SHIPPED,
          permissions: [],
          guardContext: { allLinesShipped: true },
        }),
      ).toBe(false);
    });
  }
});
