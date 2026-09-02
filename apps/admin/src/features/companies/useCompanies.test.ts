import { describe, expect, it } from 'vitest';
import { type CommissionEntry, type ExistingCommissionRate, diffCommissionEntries } from './useCompanies';

/**
 * QUICK-GTI Befund 5 — a wizard re-entry must not append duplicate rates.
 *
 * `useSaveCommission` was a plain `.insert(rows)` with no notion of what is
 * already stored, and `commission_rates` has no unique constraint (0047:64-72),
 * so every pass through the final wizard step appended a full set of rows.
 *
 * Scope of the damage, stated honestly: duplicates do NOT corrupt commission
 * amounts on contracts. `freeze_contract_commission` (0049:88-96) takes
 * `order by cr.created_at desc limit 1`, so the newest row wins
 * deterministically and every contract still freezes the right rate. What
 * duplication costs is an unbounded, ever-growing rate list that shows each
 * product N times after N wizard runs.
 *
 * The comparison below MUST use the same recency rule as
 * `freeze_contract_commission`, or the UI and the freeze would disagree about
 * which rate is current.
 */

function existing(
  overrides: Partial<ExistingCommissionRate> & Pick<ExistingCommissionRate, 'product_definition_id'>,
): ExistingCommissionRate {
  return {
    rate: 15,
    rate_type: 'percent',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('diffCommissionEntries (QUICK-GTI, Befund 5)', () => {
  it('omits an entry identical to the NEWEST existing row — the re-entry case', () => {
    const result = diffCommissionEntries(
      [existing({ product_definition_id: 'p1', rate: 15 })],
      [{ product_definition_id: 'p1', rate: 15 }],
    );
    expect(result).toEqual([]);
  });

  it('includes an entry whose rate differs — a real edit still appends', () => {
    // Append-on-change is deliberate: it preserves the recency history the
    // freeze depends on, and D-02 requires rates to stay editable.
    const result = diffCommissionEntries(
      [existing({ product_definition_id: 'p1', rate: 15 })],
      [{ product_definition_id: 'p1', rate: 18 }],
    );
    expect(result).toEqual([{ product_definition_id: 'p1', rate: 18 }]);
  });

  it('includes an entry for a product with no existing row', () => {
    const result = diffCommissionEntries([], [{ product_definition_id: 'p1', rate: 15 }]);
    expect(result).toHaveLength(1);
  });

  it('omits an entry with a blank product_definition_id', () => {
    const result = diffCommissionEntries([], [{ product_definition_id: '', rate: 15 }]);
    expect(result).toEqual([]);
  });

  it('compares only the NEWEST row per product, chosen by created_at desc', () => {
    // Deliberately unsorted, several rows per product. If this compared
    // against the OLDEST (or an arbitrary) row, the UI and
    // freeze_contract_commission (0049:88-96) would disagree about which rate
    // is current — the freeze takes `order by created_at desc limit 1`.
    const rows = [
      existing({ product_definition_id: 'p1', rate: 10, created_at: '2026-08-01T00:00:00Z' }),
      existing({ product_definition_id: 'p1', rate: 22, created_at: '2026-08-20T00:00:00Z' }),
      existing({ product_definition_id: 'p1', rate: 14, created_at: '2026-08-10T00:00:00Z' }),
    ];
    expect(diffCommissionEntries(rows, [{ product_definition_id: 'p1', rate: 22 }])).toEqual([]);
    expect(diffCommissionEntries(rows, [{ product_definition_id: 'p1', rate: 10 }])).toHaveLength(1);
  });

  it('returns [] when every entry is unchanged', () => {
    const rows = [
      existing({ product_definition_id: 'p1', rate: 15 }),
      existing({ product_definition_id: 'p2', rate: 20 }),
    ];
    const result = diffCommissionEntries(rows, [
      { product_definition_id: 'p1', rate: 15 },
      { product_definition_id: 'p2', rate: 20 },
    ]);
    expect(result).toEqual([]);
  });

  it('treats null and undefined rates as equal on both sides', () => {
    // A drafted, unset rate re-saved is still a no-op.
    expect(
      diffCommissionEntries(
        [existing({ product_definition_id: 'p1', rate: null })],
        [{ product_definition_id: 'p1', rate: null }],
      ),
    ).toEqual([]);
  });

  it('treats a numeric rate returned as a STRING as equal to the same number', () => {
    // PostgREST serialises Postgres `numeric` as a JSON string. Comparing
    // '15.00' to 15 with === would report a change on EVERY re-save and defeat
    // the entire fix while looking like it worked.
    expect(
      diffCommissionEntries(
        [{ product_definition_id: 'p1', rate: '15.00', rate_type: 'percent', created_at: 'x' }],
        [{ product_definition_id: 'p1', rate: 15 }],
      ),
    ).toEqual([]);
  });

  it('includes an entry whose rate_type differs from the newest existing row', () => {
    const result = diffCommissionEntries(
      [existing({ product_definition_id: 'p1', rate: 15, rate_type: 'percent' })],
      [{ product_definition_id: 'p1', rate: 15, rate_type: 'fixed' }],
    );
    expect(result).toHaveLength(1);
  });

  it('ignores rate_type when the entry does not name one', () => {
    // The wizard's entries carry no rate_type; the column default applies
    // server-side. Comparing undefined against 'percent' would report a change
    // on every save.
    const result = diffCommissionEntries(
      [existing({ product_definition_id: 'p1', rate: 15, rate_type: 'percent' })],
      [{ product_definition_id: 'p1', rate: 15 }],
    );
    expect(result).toEqual([]);
  });
});

describe('diffCommissionEntries preserves the no-schema-change contract', () => {
  it('never mutates its inputs', () => {
    const rows: ExistingCommissionRate[] = [existing({ product_definition_id: 'p1', rate: 15 })];
    const entries: CommissionEntry[] = [{ product_definition_id: 'p1', rate: 18 }];
    diffCommissionEntries(rows, entries);
    expect(rows).toHaveLength(1);
    expect(entries).toEqual([{ product_definition_id: 'p1', rate: 18 }]);
  });
});
