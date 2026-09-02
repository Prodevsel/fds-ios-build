import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: walletRepo transitively imports contractsRepo
// (parseCustomerName), which imports the native expo-crypto module — mock it
// so the native react-native chain is never loaded (mirrors contractsRepo.test).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'stub-uuid') }));

import { createWalletRepo } from './walletRepo';

interface FakeDb {
  getAll: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
}

function fakeDb(rows: unknown[] = []): FakeDb {
  return {
    getAll: vi.fn(async () => rows),
    // Mirrors AbstractPowerSyncDatabase.watch: fires onResult once with the
    // PowerSync result shape ({ rows: { _array } }) then respects the signal.
    watch: vi.fn((_sql, _params, callbacks) => {
      callbacks.onResult({ rows: { _array: rows } });
    }),
  };
}

/**
 * Raw synced record shape (all TEXT — PowerSync serializes numeric/boolean as
 * text). rate/base are numeric→text, is_test is boolean→text.
 */
const rawRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'contract-1',
  deal_reference: 'FDS-20260723-AB12CD34',
  answers: JSON.stringify({ identity: { surname: 'Muster', givenNames: 'Erika' } }),
  signed_at: '2026-07-23T09:00:00.000Z',
  rate: '100',
  rate_type: 'flat_eur',
  base: '2000',
  cancelled_at: null,
  ...overrides,
});

describe('walletRepo WALLET_QUERY shape (tester exclusion T-06-03, earliest-cancelled, rep-scoped)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds rep_id as a parameter and excludes tester rows for BOTH synced boolean text forms', async () => {
    const db = fakeDb([]);
    const repo = createWalletRepo({ db: db as never });

    await repo.getWallet('rep-1');

    const [sql, params] = db.getAll.mock.calls[0] as [string, unknown[]];
    // rep_id is a bound UI filter, never string-interpolated.
    expect(sql).toMatch(/WHERE[\s\S]*c\.rep_id = \?/i);
    expect(params).toEqual(['rep-1']);
    // Tester exclusion must reject '1' AND 'true' (mixed serializer forms —
    // mirrors flowDraftsRepo's `=== '1' || === 'true'` truthiness).
    expect(sql).toContain("'1'");
    expect(sql).toContain("'true'");
    expect(sql).toMatch(/is_test/i);
  });

  it('LEFT JOINs the cancelled events and takes the earliest occurred_at per deal', async () => {
    const db = fakeDb([]);
    const repo = createWalletRepo({ db: db as never });

    await repo.getWallet('rep-1');

    const [sql] = db.getAll.mock.calls[0] as [string];
    expect(sql).toMatch(/LEFT JOIN contract_status_events/i);
    expect(sql).toMatch(/event_type = 'cancelled'/i);
    expect(sql).toMatch(/MIN\(ev\.occurred_at\)/i);
    expect(sql).toMatch(/GROUP BY c\.id/i);
    expect(sql).toMatch(/ORDER BY c\.signed_at DESC/i);
  });
});

describe('walletRepo mapper (PowerSync text-type trap T-06-08, D-07 commission)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flat_eur: commissionEur = the parsed rate (100)', async () => {
    const repo = createWalletRepo({
      db: fakeDb([rawRow({ rate: '100', rate_type: 'flat_eur' })]) as never,
    });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.commissionEur).toBe(100);
  });

  it('percent: commissionEur = base * rate / 100 (2000 * 10 / 100 = 200)', async () => {
    const repo = createWalletRepo({
      db: fakeDb([rawRow({ rate: '10', rate_type: 'percent', base: '2000' })]) as never,
    });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.commissionEur).toBe(200);
  });

  it('never returns NaN — an unparseable rate text yields commissionEur = null', async () => {
    const repo = createWalletRepo({
      db: fakeDb([rawRow({ rate: 'NaN', rate_type: 'flat_eur' })]) as never,
    });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.commissionEur).toBeNull();
    expect(Number.isNaN(deals[0]?.commissionEur as number)).toBe(false);
  });

  it('null rate snapshot (no commission row frozen) yields commissionEur = null', async () => {
    const repo = createWalletRepo({
      db: fakeDb([rawRow({ rate: null, rate_type: null, base: null })]) as never,
    });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.commissionEur).toBeNull();
  });

  it('derives customerName from the frozen answers identity (reuses parseCustomerName)', async () => {
    const repo = createWalletRepo({ db: fakeDb([rawRow()]) as never });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.customerName).toBe('Erika Muster');
  });

  it('never throws on malformed answers JSON — falls back to the placeholder', async () => {
    const repo = createWalletRepo({ db: fakeDb([rawRow({ answers: 'not-json{{' })]) as never });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.customerName).toBe('Unbekannter Kunde');
  });

  it('passes MIN(occurred_at) through as cancelledAtIso, or null when not cancelled', async () => {
    const cancelledRepo = createWalletRepo({
      db: fakeDb([rawRow({ cancelled_at: '2026-07-25T12:00:00.000Z' })]) as never,
    });
    const openRepo = createWalletRepo({ db: fakeDb([rawRow({ cancelled_at: null })]) as never });

    const [cancelledDeal] = await cancelledRepo.getWallet('rep-1');
    const [openDeal] = await openRepo.getWallet('rep-1');

    expect(cancelledDeal?.cancelledAtIso).toBe('2026-07-25T12:00:00.000Z');
    expect(openDeal?.cancelledAtIso).toBeNull();
  });

  it('surfaces dealReference and signedAtIso verbatim', async () => {
    const repo = createWalletRepo({ db: fakeDb([rawRow()]) as never });

    const deals = await repo.getWallet('rep-1');

    expect(deals[0]?.dealReference).toBe('FDS-20260723-AB12CD34');
    expect(deals[0]?.signedAtIso).toBe('2026-07-23T09:00:00.000Z');
  });
});

describe('walletRepo.watchWallet (reactive, D-05)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('subscribes via db.watch, emits mapped rows on result, and returns an unsubscribe', () => {
    const db = fakeDb([rawRow()]);
    const repo = createWalletRepo({ db: db as never });
    const onChange = vi.fn();

    const unsubscribe = repo.watchWallet('rep-1', onChange);

    expect(db.watch).toHaveBeenCalledTimes(1);
    const [, params] = db.watch.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['rep-1']);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [firstCall] = onChange.mock.calls;
    const emitted = (firstCall?.[0] ?? []) as Array<{ commissionEur: number | null }>;
    expect(emitted[0]?.commissionEur).toBe(100);
    expect(typeof unsubscribe).toBe('function');
  });

  it('exposes only getWallet + watchWallet (read-only read model)', () => {
    const repo = createWalletRepo({ db: fakeDb() as never });
    expect(Object.keys(repo).sort()).toEqual(['getWallet', 'watchWallet']);
  });
});
