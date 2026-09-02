import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: never load the native expo-crypto module — only its
// randomUUID export is used, stubbed deterministically (mirrors
// flowDraftsRepo.test.ts / scanTelemetryRepo tests).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixed-lead-uuid') }));

import { endConsultationAsLead, type EndAsLeadDb } from './useEndAsLead';

// `ReturnType<typeof vi.fn>` is the untyped Mock, which does not satisfy
// EndAsLeadDb's call signature — it made every fakeDb() call site a typecheck
// error (part of the standing baseline). Typing the mock to the method it
// stands in for fixes all of them at the source.
interface FakeDb extends EndAsLeadDb {
  execute: ReturnType<typeof vi.fn<EndAsLeadDb['execute']>>;
}

function fakeDb(): FakeDb {
  return { execute: vi.fn<EndAsLeadDb['execute']>(async () => ({})) };
}

const BASE = {
  companyId: 'company-1',
  repId: 'rep-1',
  teamId: 'team-1',
  territoryId: 'territory-1',
  contact: { name: 'Erika Mustermann', phone: '+49 170 0000000', email: 'e@example.de' },
  productInterest: 'Glasfaser 1000',
  termsVersion: 3,
};

describe('endConsultationAsLead (D-17 consent-gated lead capture)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws and inserts nothing when the consent block was NOT confirmed (abandonment ≠ consent)', async () => {
    const db = fakeDb();
    await expect(
      endConsultationAsLead(db, { ...BASE, consent: { confirmed: false } }),
    ).rejects.toThrow(/consent/i);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('with a confirmed consent block queues exactly one leads row with consent_given=true and rep attribution', async () => {
    const db = fakeDb();

    const id = await endConsultationAsLead(db, { ...BASE, consent: { confirmed: true } });

    expect(id).toBe('fixed-lead-uuid');
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO leads');
    expect(sql).not.toMatch(/ON CONFLICT|upsert/i);
    expect(params).toEqual([
      'fixed-lead-uuid',
      'company-1',
      'rep-1',
      'team-1',
      'Erika Mustermann',
      '+49 170 0000000',
      'e@example.de',
      'Glasfaser 1000',
      1,
      3,
      'territory-1',
      expect.any(String),
      null,
      null,
      null,
    ]);
  });

  it('carries the offer code, deadline and frozen snapshot when the rep sends an offer (§5.2)', async () => {
    const db = fakeDb();

    await endConsultationAsLead(db, {
      ...BASE,
      consent: { confirmed: true },
      offerCode: 'FDS-ABCD-2345',
      offerExpiresAtIso: '2026-09-09T10:00:00.000Z',
      offerSnapshot: { doorPrice: 249, productSlug: 'smaica-social-media' },
    });

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(params.slice(-3)).toEqual([
      'FDS-ABCD-2345',
      '2026-09-09T10:00:00.000Z',
      '{"doorPrice":249,"productSlug":"smaica-social-media"}',
    ]);
  });

  it('omitted optional contact/product/territory fields are written as null', async () => {
    const db = fakeDb();

    await endConsultationAsLead(db, {
      companyId: 'company-1',
      repId: 'rep-1',
      teamId: 'team-1',
      consent: { confirmed: true },
      contact: {},
    });

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    // contact_name, contact_phone, contact_email, product_interest, terms_version, territory_id → null
    expect(params.slice(4, 8)).toEqual([null, null, null, null]);
    expect(params[8]).toBe(1); // consent_given always true when reached
    expect(params[9]).toBeNull(); // terms_version
    expect(params[10]).toBeNull(); // territory_id
  });
});
