import { describe, expect, it } from 'vitest';

import {
  buildCustomers,
  searchCustomers,
  type CustomerContractInput,
  type CustomerLeadInput,
} from './customerSearch';

function contract(overrides: Partial<CustomerContractInput> = {}): CustomerContractInput {
  return {
    id: 'contract-1',
    customer_name: 'Anna Müller',
    deal_reference: 'FDS-20260801-ABCD1234',
    product_definition_id: 'glasfaser-1000',
    signed_at: '2026-08-01T10:00:00.000Z',
    created_at: '2026-08-01T10:00:00.000Z',
    snapshot_door_price: '49.90',
    ...overrides,
  };
}

function lead(overrides: Partial<CustomerLeadInput> = {}): CustomerLeadInput {
  return {
    id: 'lead-1',
    contact_name: 'Anna Müller',
    contact_phone: '+49 176 1234567',
    contact_email: 'anna.mueller@example.de',
    product_interest: 'glasfaser',
    created_at: '2026-07-20T08:00:00.000Z',
    converted_contract_id: null,
    ...overrides,
  };
}

describe('buildCustomers — 1: one person, one entry', () => {
  it('groups by normalised e-mail: casing and padding are not two customers', () => {
    const customers = buildCustomers(
      [],
      [
        lead({ id: 'l1', contact_email: '  Anna.Mueller@Example.DE ' }),
        lead({ id: 'l2', contact_email: 'anna.mueller@example.de', contact_name: 'A. Müller' }),
      ],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.key).toBe('email:anna.mueller@example.de');
  });

  it('falls back to the normalised name when a row carries no e-mail', () => {
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: 'Anna Müller' })],
      [lead({ id: 'l1', contact_email: null, contact_name: '  anna   müller ' })],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.key).toBe('name:anna muller');
  });

  it('joins a contract to its lead via the name→e-mail alias (a contract has no e-mail column)', () => {
    // The whole point of the alias pass: `contracts` structurally cannot carry
    // a contact address, so without it the signed deal and the lead it came
    // from would show up as two people.
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: 'Anna Müller' })],
      [lead({ id: 'l1' })],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.key).toBe('email:anna.mueller@example.de');
    expect(customers[0]?.contractCount).toBe(1);
  });

  it('refuses the alias when one name maps to two different e-mails', () => {
    // Merging two real people is worse than listing one person twice, so an
    // ambiguous name is never merged — the name-only row stays its own entry.
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: 'Anna Müller' })],
      [
        lead({ id: 'l1', contact_email: 'anna1@example.de' }),
        lead({ id: 'l2', contact_email: 'anna2@example.de' }),
      ],
    );

    expect(customers.map((c) => c.key).sort()).toEqual([
      'email:anna1@example.de',
      'email:anna2@example.de',
      'name:anna muller',
    ]);
  });

  it('produces NO customer for a row with neither an e-mail nor a name', () => {
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: null })],
      [lead({ id: 'l1', contact_name: null, contact_email: null })],
    );

    expect(customers).toEqual([]);
  });

  it('never emits an anonymous catch-all bucket alongside real customers', () => {
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: '   ' }), contract({ id: 'c2' })],
      [],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.displayName).toBe('Anna Müller');
  });
});

describe('buildCustomers — 2: what a customer carries', () => {
  it('carries key, name, contact block, deals, count and the newest contract date', () => {
    const customers = buildCustomers(
      [
        contract({
          id: 'c1',
          deal_reference: 'FDS-20260801-AAAA1111',
          product_definition_id: 'glasfaser-1000',
          signed_at: '2026-08-01T10:00:00.000Z',
          snapshot_door_price: '49.90',
        }),
        contract({
          id: 'c2',
          deal_reference: 'FDS-20260810-BBBB2222',
          product_definition_id: 'strom-oeko',
          signed_at: '2026-08-10T09:00:00.000Z',
          snapshot_door_price: '19',
        }),
      ],
      [lead({ id: 'l1' })],
    );

    expect(customers).toHaveLength(1);
    const customer = customers[0];
    expect(customer?.key).toBe('email:anna.mueller@example.de');
    expect(customer?.displayName).toBe('Anna Müller');
    expect(customer?.email).toBe('anna.mueller@example.de');
    expect(customer?.phone).toBe('+49 176 1234567');
    expect(customer?.contractCount).toBe(2);
    expect(customer?.lastContractAtIso).toBe('2026-08-10T09:00:00.000Z');
    // Newest deal first inside the customer, for the same reason the list is.
    expect(customer?.contracts).toEqual([
      {
        id: 'c2',
        dealReference: 'FDS-20260810-BBBB2222',
        productName: 'strom-oeko',
        signedAtIso: '2026-08-10T09:00:00.000Z',
        priceEur: 19,
      },
      {
        id: 'c1',
        dealReference: 'FDS-20260801-AAAA1111',
        productName: 'glasfaser-1000',
        signedAtIso: '2026-08-01T10:00:00.000Z',
        priceEur: 49.9,
      },
    ]);
  });

  it('reports a null price for a deal whose row carries none (direct-sign writes no price)', () => {
    const customers = buildCustomers([contract({ snapshot_door_price: null })], []);

    expect(customers[0]?.contracts[0]?.priceEur).toBeNull();
  });

  it('leaves a lead-only customer with no contracts and no contract date', () => {
    const customers = buildCustomers([], [lead({ id: 'l1' })]);

    expect(customers[0]?.contracts).toEqual([]);
    expect(customers[0]?.contractCount).toBe(0);
    expect(customers[0]?.lastContractAtIso).toBeNull();
  });

  it('falls back to created_at when a contract row has no signed_at', () => {
    const customers = buildCustomers(
      [contract({ signed_at: null, created_at: '2026-08-05T12:00:00.000Z' })],
      [],
    );

    expect(customers[0]?.lastContractAtIso).toBe('2026-08-05T12:00:00.000Z');
  });
});

describe('buildCustomers — 3 (ordering): who the rep just dealt with comes first', () => {
  it('sorts by most recent contract, with lead-only customers below everyone who signed', () => {
    const customers = buildCustomers(
      [
        contract({
          id: 'c-old',
          customer_name: 'Bernd Alt',
          signed_at: '2026-06-01T10:00:00.000Z',
        }),
        contract({
          id: 'c-new',
          customer_name: 'Clara Neu',
          signed_at: '2026-08-30T10:00:00.000Z',
        }),
      ],
      [
        lead({
          id: 'l1',
          contact_name: 'Dora Lead',
          contact_email: 'dora@example.de',
          created_at: '2026-08-31T10:00:00.000Z',
        }),
      ],
    );

    expect(customers.map((c) => c.displayName)).toEqual(['Clara Neu', 'Bernd Alt', 'Dora Lead']);
  });
});

describe('searchCustomers — 3: what the search box matches', () => {
  const customers = buildCustomers(
    [contract({ id: 'c1', customer_name: 'Anna Müller' })],
    [
      lead({ id: 'l1' }),
      lead({
        id: 'l2',
        contact_name: 'Björn Straße',
        contact_email: 'bjoern@example.com',
        contact_phone: '030 998877',
        created_at: '2026-07-01T08:00:00.000Z',
      }),
    ],
  );

  it('returns everything for an empty or whitespace-only query', () => {
    expect(searchCustomers(customers, '')).toHaveLength(2);
    expect(searchCustomers(customers, '   ')).toHaveLength(2);
  });

  it('matches the name case-insensitively', () => {
    expect(searchCustomers(customers, 'MÜLL').map((c) => c.displayName)).toEqual(['Anna Müller']);
  });

  it('matches the name without the diacritic the rep did not long-press for', () => {
    expect(searchCustomers(customers, 'muller').map((c) => c.displayName)).toEqual(['Anna Müller']);
    expect(searchCustomers(customers, 'bjorn').map((c) => c.displayName)).toEqual(['Björn Straße']);
  });

  it('folds ß to ss, so "Strasse" finds "Straße"', () => {
    expect(searchCustomers(customers, 'strasse').map((c) => c.displayName)).toEqual([
      'Björn Straße',
    ]);
  });

  it('matches the e-mail', () => {
    expect(searchCustomers(customers, 'anna.mueller@ex').map((c) => c.email)).toEqual([
      'anna.mueller@example.de',
    ]);
  });

  it('matches the phone number digits-against-digits, ignoring the formatting', () => {
    expect(searchCustomers(customers, '1761234567').map((c) => c.displayName)).toEqual([
      'Anna Müller',
    ]);
    expect(searchCustomers(customers, '030 99').map((c) => c.displayName)).toEqual([
      'Björn Straße',
    ]);
  });

  it('returns nothing for a query that matches no field', () => {
    expect(searchCustomers(customers, 'zzzz')).toEqual([]);
  });

  it('keeps the most-recent-contract-first order of the input list', () => {
    // The customer with a signed deal stays ahead of the lead-only one.
    expect(searchCustomers(customers, '').map((c) => c.displayName)).toEqual([
      'Anna Müller',
      'Björn Straße',
    ]);
  });
});

describe('buildCustomers — 4: an anonymised row never reappears through a projection', () => {
  it('excludes a lead stamped by the 0045 retention job entirely', () => {
    // 0045_retention_jobs.sql nulls the PII and stamps anonymized_at. If a
    // stale local copy still carried the names, a projection would resurrect
    // exactly the data the job removed.
    const customers = buildCustomers(
      [],
      [lead({ id: 'l1', anonymized_at: '2026-08-01T00:00:00.000Z' })],
    );

    expect(customers).toEqual([]);
  });

  it('does not let an anonymised lead contribute a contact detail to a live customer', () => {
    const customers = buildCustomers(
      [contract({ id: 'c1', customer_name: 'Anna Müller' })],
      [lead({ id: 'l1', anonymized_at: '2026-08-01T00:00:00.000Z' })],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.key).toBe('name:anna muller');
    expect(customers[0]?.email).toBeNull();
    expect(customers[0]?.phone).toBeNull();
  });

  it('excludes an anonymised row on the contracts side too (uniform rule)', () => {
    const customers = buildCustomers(
      [contract({ id: 'c1', anonymized_at: '2026-08-01T00:00:00.000Z' })],
      [],
    );

    expect(customers).toEqual([]);
  });
});

describe('5: malformed input costs the row, never the screen', () => {
  it('never throws on nulls, wrong types or missing fields, and keeps the good rows', () => {
    const customers = buildCustomers(
      [
        null,
        undefined,
        'not a row',
        42,
        [],
        {},
        { customer_name: 123, snapshot_door_price: {} },
        contract({ id: 'c1', snapshot_door_price: 'keine Angabe' }),
      ],
      [
        null,
        { contact_email: 12345 },
        { contact_name: ['Anna'], contact_email: 'not-an-email' },
        lead({ id: 'l1' }),
      ],
    );

    expect(customers).toHaveLength(1);
    expect(customers[0]?.displayName).toBe('Anna Müller');
    expect(customers[0]?.contracts[0]?.priceEur).toBeNull();
  });

  it('treats a non-array input as an empty list rather than throwing', () => {
    expect(buildCustomers(null, undefined)).toEqual([]);
    expect(buildCustomers('nope', 7)).toEqual([]);
  });

  it('survives a non-array customer list and a non-string query', () => {
    expect(searchCustomers(null, 'anna')).toEqual([]);
    const customers = buildCustomers([], [lead({ id: 'l1' })]);
    expect(searchCustomers(customers, null)).toHaveLength(1);
    expect(searchCustomers(customers, 42)).toHaveLength(1);
  });

  it('does not throw on a customer object whose fields are the wrong type', () => {
    expect(() =>
      searchCustomers([{ displayName: 5, email: null, phone: {} }, null, 'x'], 'anna'),
    ).not.toThrow();
    expect(searchCustomers([{ displayName: 5, email: null, phone: {} }], 'anna')).toEqual([]);
  });
});
