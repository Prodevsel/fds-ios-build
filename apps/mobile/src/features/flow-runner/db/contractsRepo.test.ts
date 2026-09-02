import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-crypto module (mirrors flowDraftsRepo.test.ts's pattern).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'ab12cd34-ef56-7890-abcd-ef1234567890') }));

import { t } from '../../../i18n';
import {
  auditPackageHasGps,
  createContractsRepo,
  deriveContractCustomerName,
  deriveContractSyncState,
  extractIbanFromAnswers,
  generateDealReference,
  maskIban,
  parseNumericText,
  toContractDetailRow,
} from './contractsRepo';

interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function fakeDb(rows: unknown[] = []): FakeDb {
  return {
    execute: vi.fn(async () => ({})),
    getAll: vi.fn(async () => rows),
  };
}

describe('generateDealReference (D-12, pure helper)', () => {
  it('produces FDS-YYYYMMDD-XXXXXXXX (8 uppercase hex chars) exactly', () => {
    const date = new Date(Date.UTC(2026, 6, 23)); // 2026-07-23
    const reference = generateDealReference(date, 'ab12cd34-ef56-7890-abcd-ef1234567890');

    expect(reference).toBe('FDS-20260723-AB12CD34');
  });

  it('pads single-digit month/day with a leading zero', () => {
    const date = new Date(Date.UTC(2026, 0, 5)); // 2026-01-05
    const reference = generateDealReference(date, '11112222-3333-4444-5555-666677778888');

    expect(reference).toBe('FDS-20260105-11112222');
  });
});

describe('contractsRepo (append-only insert, D-10/D-12/D-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseInput = {
    companyId: 'company-1',
    repId: 'rep-1',
    teamId: 'team-1',
    productDefinitionId: 'product-1',
    productVersion: 3,
    termsId: 'terms-1',
    termsVersion: 2,
    answers: { deviceCount: 'few' },
    snapshot: {
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'Nur heute an Ihrer Tür...',
    },
    auditPackage: { deviceId: 'device-1', confirmedGates: [{ blockId: 'belehrung-1' }] },
    packageHashSha256: 'abc123hash',
    signatureAttachmentId: 'attachment-1',
    signedAtIso: '2026-07-23T09:00:00.000Z',
  };

  it('insertContract writes a single INSERT with status=signed and a generated deal_reference', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    const result = await repo.insertContract(baseInput);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql] = db.execute.mock.calls[0] as [string, unknown[]];
    // CR-02: `OR IGNORE` on the PK is what makes a retry with the same
    // deterministic id idempotent — still no ON CONFLICT ... UPDATE clause
    // is ever used (append-only, D-10/D-22).
    expect(sql).toContain('INSERT OR IGNORE INTO contracts');
    expect(sql).toContain("'signed'");
    expect(sql).not.toMatch(/ON CONFLICT|upsert/i);
    expect(result.id).toBe('ab12cd34-ef56-7890-abcd-ef1234567890');
    expect(result.dealReference).toMatch(/^FDS-\d{8}-[0-9A-F]{8}$/);
  });

  it('CR-02: a retried insertContract with the same supplied id is idempotent — the ALREADY-persisted row (not the retry call\'s fresh dealReference) is returned', async () => {
    // Simulates the id already existing locally (first attempt already
    // succeeded) — db.getAll (the post-insert re-read) returns that row.
    const db = fakeDb([{ id: 'draft-derived-id', deal_reference: 'FDS-20260101-ORIGINAL' }]);
    const repo = createContractsRepo({ db: db as never });

    const result = await repo.insertContract({
      ...baseInput,
      id: 'draft-derived-id',
      dealReference: 'FDS-20260202-RETRY',
    });

    // execute is still called once — INSERT OR IGNORE is a SQL-level no-op
    // when the row already exists, the repo itself never skips the call.
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('draft-derived-id');
    // The RETURNED result reflects the row actually persisted (from the
    // first successful attempt), never the retry's fresh dealReference.
    expect(result.id).toBe('draft-derived-id');
    expect(result.dealReference).toBe('FDS-20260101-ORIGINAL');
  });

  it('JSON.stringifies audit_package and answers before writing', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    await repo.insertContract(baseInput);

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    const answersParam = params.find((p) => typeof p === 'string' && p.includes('deviceCount'));
    const auditPackageParam = params.find((p) => typeof p === 'string' && p.includes('confirmedGates'));
    expect(answersParam).toBe(JSON.stringify(baseInput.answers));
    expect(auditPackageParam).toBe(JSON.stringify(baseInput.auditPackage));
  });

  it('forwards snapshot/product/terms fields unchanged (freeze-copy, D-10), never recomputing them', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    await repo.insertContract(baseInput);

    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(
      expect.arrayContaining([
        'company-1',
        'rep-1',
        'team-1',
        'product-1',
        3,
        'terms-1',
        2,
        34.99,
        49.99,
        15.0,
        'Nur heute an Ihrer Tür...',
        'abc123hash',
        'attachment-1',
        '2026-07-23T09:00:00.000Z',
      ]),
    );
  });

  it('uses the supplied dealReference verbatim when provided, never regenerating it', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    const result = await repo.insertContract({ ...baseInput, dealReference: 'FDS-20260101-DEADBEEF' });

    expect(result.dealReference).toBe('FDS-20260101-DEADBEEF');
    const [, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('FDS-20260101-DEADBEEF');
  });

  it('DSGN-03: a direct-sign insert carries direct_sign_template_id in the INSERT params', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    await repo.insertContract({ ...baseInput, directSignTemplateId: 'template-1' });

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('direct_sign_template_id');
    expect(params).toContain('template-1');
  });

  it('DSGN-03: a flow-form insert (no directSignTemplateId) leaves the column null', async () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    await repo.insertContract(baseInput);

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('direct_sign_template_id');
    // Last bound param is direct_sign_template_id (appended after created_at) —
    // must be null, never an empty-string placeholder (nullifyEmptyUuidColumns
    // upload-boundary trap, connector.ts).
    expect(params[params.length - 1]).toBeNull();
  });

  it('exposes only insertContract + read methods — no update/save/delete method (append-only)', () => {
    const db = fakeDb();
    const repo = createContractsRepo({ db: db as never });

    expect(Object.keys(repo).sort()).toEqual(
      ['insertContract', 'listContracts', 'watchContracts', 'getContractDetail'].sort(),
    );
  });
});

describe('extractIbanFromAnswers + maskIban (Abschluss-Detail Bankverbindung)', () => {
  it('finds an IBAN-shaped answer value and ignores non-IBAN strings', () => {
    expect(
      extractIbanFromAnswers({ q1: 'yes', iban_block: 'DE44 5001 0517 5407 3249 31', name: 'Erika' }),
    ).toBe('DE44500105175407324931');
  });

  it('returns null when no answer looks like an IBAN', () => {
    expect(extractIbanFromAnswers({ q1: 'yes', q2: '3500' })).toBeNull();
    expect(extractIbanFromAnswers(null)).toBeNull();
  });

  it('masks an IBAN keeping country+check digits and the final two chars', () => {
    expect(maskIban('DE44500105175407324931')).toBe('DE44 … 31');
    expect(maskIban('DE44 5001 0517 5407 3249 31')).toBe('DE44 … 31');
  });

  it('returns null for an empty/too-short IBAN', () => {
    expect(maskIban(null)).toBeNull();
    expect(maskIban('DE44')).toBeNull();
  });
});

describe('parseNumericText + auditPackageHasGps (detail projection helpers)', () => {
  it('parses numeric text, guarding null/NaN to null', () => {
    expect(parseNumericText('36.5')).toBe(36.5);
    expect(parseNumericText(null)).toBeNull();
    expect(parseNumericText('not-a-number')).toBeNull();
  });

  it('detects a present GPS fix in the frozen audit package, false otherwise', () => {
    expect(auditPackageHasGps(JSON.stringify({ gps: { lat: 1, lng: 2, accuracyM: 5 } }))).toBe(true);
    expect(auditPackageHasGps(JSON.stringify({ gps: null }))).toBe(false);
    expect(auditPackageHasGps(null)).toBe(false);
    expect(auditPackageHasGps('not-json{{')).toBe(false);
  });
});

describe('getContractDetail + toContractDetailRow (design SSOT 10b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rawDetail = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'contract-1',
    deal_reference: 'FDS-20260723-AB12CD34',
    answers: JSON.stringify({
      identity: { surname: 'Krüger', givenNames: 'Sabine' },
      bank: 'DE44 5001 0517 5407 3249 31',
    }),
    product_slug: 'strom-24',
    signed_at: '2026-07-27T09:00:00.000Z',
    created_at: '2026-07-27T09:00:01.000Z',
    door_price: '36.5',
    comparison_price: '42.9',
    discount_amount: '6.4',
    rate: '30',
    rate_type: 'flat_eur',
    base: null,
    audit_package: JSON.stringify({ gps: { lat: 1, lng: 2, accuracyM: 5 } }),
    rep_id: 'rep-1',
    advisor_name: 'Max Mustermann',
    direct_sign_template_id: null,
    cancelled_at: null,
    ...overrides,
  });

  it('maps every detail field from the frozen contract row + status events', () => {
    const detail = toContractDetailRow(rawDetail() as never);
    expect(detail.customerName).toBe('Sabine Krüger');
    expect(detail.productName).toBe('strom-24');
    expect(detail.doorPriceEur).toBe(36.5);
    expect(detail.comparisonPriceEur).toBe(42.9);
    expect(detail.discountAmountEur).toBe(6.4);
    expect(detail.commissionEur).toBe(30);
    expect(detail.ibanMasked).toBe('DE44 … 31');
    expect(detail.gpsPresent).toBe(true);
    expect(detail.addressLine).toBeNull();
    expect(detail.cancelledAtIso).toBeNull();
  });

  it('maps a non-empty advisor_name (app_users.full_name, LEFT JOIN on c.rep_id) to advisorName', () => {
    expect(toContractDetailRow(rawDetail() as never).advisorName).toBe('Max Mustermann');
  });

  it('maps a null or whitespace-only advisor_name to null — no placeholder is invented at the repo layer', () => {
    expect(toContractDetailRow(rawDetail({ advisor_name: null }) as never).advisorName).toBeNull();
    expect(toContractDetailRow(rawDetail({ advisor_name: '   ' }) as never).advisorName).toBeNull();
  });

  it('trims a padded advisor_name rather than passing the padding through to the UI', () => {
    expect(toContractDetailRow(rawDetail({ advisor_name: '  Max Mustermann ' }) as never).advisorName).toBe(
      'Max Mustermann',
    );
  });

  it('sets isDirectSign exactly when direct_sign_template_id is a non-empty string', () => {
    expect(toContractDetailRow(rawDetail() as never).isDirectSign).toBe(false);
    expect(toContractDetailRow(rawDetail({ direct_sign_template_id: '' }) as never).isDirectSign).toBe(false);
    expect(toContractDetailRow(rawDetail({ direct_sign_template_id: 'tpl-1' }) as never).isDirectSign).toBe(true);
  });

  // completeDirectSign.ts writes `snapshot: { doorPrice: 0, ... }` as a
  // sentinel meaning "this path has no price block". contracts is
  // append-only, so signed rows cannot be corrected — the read projection is
  // the only honest place to translate the sentinel back to "no price".
  it("reads the direct-sign door_price sentinel '0' back as null, never as a price of zero", () => {
    const detail = toContractDetailRow(
      rawDetail({ direct_sign_template_id: 'tpl-1', door_price: '0' }) as never,
    );
    expect(detail.doorPriceEur).toBeNull();
  });

  it('leaves a real flow-path door price untouched', () => {
    const detail = toContractDetailRow(rawDetail({ door_price: '39.90' }) as never);
    expect(detail.doorPriceEur).toBe(39.9);
    expect(detail.isDirectSign).toBe(false);
  });

  // Structural, not a data gap: houses.address exists (0083) but contracts
  // has no house_id and no draft reference — only flow_drafts.house_id links
  // a draft to a house, and the contract keeps no pointer back to its draft.
  // There is no join to write, on any record.
  it('leaves addressLine null on every record — a contract has no reachable house/draft link', () => {
    expect(toContractDetailRow(rawDetail() as never).addressLine).toBeNull();
    expect(
      toContractDetailRow(rawDetail({ direct_sign_template_id: 'tpl-1' }) as never).addressLine,
    ).toBeNull();
  });

  it('surfaces a Widerruf reversal time when a cancelled event exists', () => {
    const detail = toContractDetailRow(
      rawDetail({ cancelled_at: '2026-08-01T12:00:00.000Z' }) as never,
    );
    expect(detail.cancelledAtIso).toBe('2026-08-01T12:00:00.000Z');
  });

  it('getContractDetail returns null when no row matches the id', async () => {
    const db = fakeDb([]);
    const repo = createContractsRepo({ db: db as never });
    expect(await repo.getContractDetail('missing')).toBeNull();
  });

  it('getContractDetail returns the mapped detail for a present row', async () => {
    const db = fakeDb([rawDetail()]);
    const repo = createContractsRepo({ db: db as never });
    const detail = await repo.getContractDetail('contract-1');
    expect(detail?.dealReference).toBe('FDS-20260723-AB12CD34');
  });

  it('joins app_users for the advisor name instead of leaving it permanently null', async () => {
    const db = fakeDb([rawDetail()]);
    const repo = createContractsRepo({ db: db as never });
    await repo.getContractDetail('contract-1');
    const sql = String(db.getAll.mock.calls[0]?.[0] ?? '');
    expect(sql).toMatch(/LEFT JOIN app_users/i);
    expect(sql).toMatch(/direct_sign_template_id/i);
  });
});

describe('listContracts (read query, D-18/D-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rawRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'contract-1',
    deal_reference: 'FDS-20260723-AB12CD34',
    answers: JSON.stringify({ identity: { surname: 'Muster', givenNames: 'Erika' } }),
    product_slug: 'fiber-100',
    signed_at: '2026-07-23T09:00:00.000Z',
    ...overrides,
  });

  it('orders newest-first (relies on the ORDER BY created_at DESC in the SQL, rows returned as given)', async () => {
    const rowA = rawRow({ id: 'contract-a', signed_at: '2026-07-23T09:00:00.000Z' });
    const rowB = rawRow({ id: 'contract-b', signed_at: '2026-07-23T10:00:00.000Z' });
    const db = fakeDb([rowB, rowA]); // simulates DB already returning newest-first
    const repo = createContractsRepo({ db: db as never });

    const rows = await repo.listContracts();

    expect(rows.map((r) => r.id)).toEqual(['contract-b', 'contract-a']);
    const [sql] = db.getAll.mock.calls[0] as [string];
    expect(sql).toMatch(/ORDER BY .*created_at.* DESC/i);
  });

  it('derives customerName from the frozen answers identity object (surname + givenNames)', async () => {
    const db = fakeDb([rawRow()]);
    const repo = createContractsRepo({ db: db as never });

    const rows = await repo.listContracts();

    expect(rows[0]!.customerName).toBe('Erika Muster');
    expect(rows[0]!.dealReference).toBe('FDS-20260723-AB12CD34');
    expect(rows[0]!.signedAtIso).toBe('2026-07-23T09:00:00.000Z');
    expect(rows[0]!.productName).toBe('fiber-100');
  });

  it('falls back to a placeholder customerName when the identity answer is absent (never throws)', async () => {
    const db = fakeDb([rawRow({ answers: JSON.stringify({ someOtherField: 'x' }) })]);
    const repo = createContractsRepo({ db: db as never });

    const rows = await repo.listContracts();

    expect(rows[0]!.customerName).toBe('Unbekannter Kunde');
  });

  it('never throws on malformed answers JSON', async () => {
    const db = fakeDb([rawRow({ answers: 'not-json{{' })]);
    const repo = createContractsRepo({ db: db as never });

    const rows = await repo.listContracts();

    expect(rows[0]!.customerName).toBe('Unbekannter Kunde');
  });

  it('handles a null product_slug (no matching product_definitions row) as null productName', async () => {
    const db = fakeDb([rawRow({ product_slug: null })]);
    const repo = createContractsRepo({ db: db as never });

    const rows = await repo.listContracts();

    expect(rows[0]!.productName).toBeNull();
  });
});

describe('deriveContractSyncState (pure, D-22 — no DB status column)', () => {
  it('returns pending when the contract id is present in the upload-queue id set', () => {
    expect(deriveContractSyncState('contract-1', new Set(['contract-1', 'contract-2']))).toBe('pending');
  });

  it('returns synced when the contract id is absent from the upload-queue id set', () => {
    expect(deriveContractSyncState('contract-1', new Set(['contract-2']))).toBe('synced');
  });

  it('returns synced for an empty queue', () => {
    expect(deriveContractSyncState('contract-1', new Set())).toBe('synced');
  });
});

/**
 * QUICK-GTI Befund 2 — `contracts.customer_name` at INSERT.
 *
 * The column exists (0055:38, "set by the client at INSERT") and the client
 * never set it, so every contract closed live in the app shows a dash in
 * /abschluesse while a seeded demo row shows a name. `contracts` is
 * append-only (0004 triggers): there is NO later UPDATE that can repair a
 * row, so the value is present in the INSERT or it is lost for that deal
 * forever.
 *
 * The load-bearing asymmetry this function exists for: at INSERT time an
 * id-scan answer is a JSON STRING (serializeIdFields), while after a read it
 * is a parsed OBJECT. `parseCustomerName` handles only the object form, so it
 * cannot be reused here.
 */
describe('deriveContractCustomerName (QUICK-GTI, Befund 2)', () => {
  it('reads an id-scan answer in its INSERT-time JSON STRING form', () => {
    expect(
      deriveContractCustomerName({
        idScan: '{"surname":"Meier","givenNames":"Anna"}',
      }),
    ).toBe('Anna Meier');
  });

  it('reads an id-scan answer in its already-parsed OBJECT form', () => {
    expect(
      deriveContractCustomerName({ idScan: { surname: 'Meier', givenNames: 'Anna' } }),
    ).toBe('Anna Meier');
  });

  it('falls back to a trimmed customerName answer', () => {
    expect(deriveContractCustomerName({ customerName: '  Anna Meier  ' })).toBe('Anna Meier');
  });

  it('returns null for an email answer — a local part is NOT a name', () => {
    expect(deriveContractCustomerName({ email: 'anna@example.de' })).toBeNull();
  });

  it.each([
    ['an empty answers map', {}],
    ['null', null],
    ['undefined', undefined],
    ['a non-JSON string answer', { note: 'not json' }],
    ['an unrelated numeric answer', { x: 5 }],
    ['a JSON string that parses but carries no identity', { idScan: '{"foo":1}' }],
    ['a blank customerName', { customerName: '   ' }],
  ])('returns null (never throws, never a placeholder) for %s', (_label, answers) => {
    expect(deriveContractCustomerName(answers)).toBeNull();
  });

  it('NEVER returns the contracts.unknownCustomer placeholder', () => {
    // A placeholder frozen into an append-only legal row cannot be corrected
    // later. Null is the honest value; /abschluesse already renders a dash.
    const placeholder = t('contracts.unknownCustomer');
    expect(deriveContractCustomerName({})).not.toBe(placeholder);
    expect(deriveContractCustomerName({ x: 5 })).not.toBe(placeholder);
  });
});

describe('insertContract writes customer_name (QUICK-GTI, Befund 2)', () => {
  const baseInput = {
    companyId: 'company-1',
    repId: 'rep-1',
    teamId: 'team-1',
    productDefinitionId: 'product-1',
    productVersion: 1,
    termsId: '',
    termsVersion: 0,
    answers: {} as Record<string, unknown>,
    snapshot: { doorPrice: 39.9, comparisonPrice: null, discountAmount: null, termsText: '' },
    auditPackage: {},
    packageHashSha256: 'a'.repeat(64),
    signatureAttachmentId: 'sig-1',
    signedAtIso: '2026-08-27T10:00:00.000Z',
  };

  function insertCall(db: FakeDb) {
    const [sql, binds] = db.execute.mock.calls[0] as [string, unknown[]];
    return { sql, binds };
  }

  it('names customer_name in the column list with a matching placeholder count', async () => {
    const db = fakeDb([{ id: 'c1', deal_reference: 'FDS-1' }]);
    const repo = createContractsRepo({ db: db as never });
    await repo.insertContract({ ...baseInput, id: 'c1' });

    const { sql, binds } = insertCall(db);
    expect(sql).toContain('customer_name');
    // The VALUES list is POSITIONAL: a column added without its placeholder
    // shifts every subsequent bind by one and corrupts the row silently.
    const columns = (sql.match(/\(([^)]*)\)\s*VALUES/)?.[1] ?? '').split(',').length;
    const placeholders = (sql.match(/VALUES\s*\(([^)]*)\)/)?.[1] ?? '').split(',').length;
    expect(placeholders).toBe(columns);
    // 'signed' is the one literal in the VALUES list, so binds = columns - 1.
    expect(binds).toHaveLength(columns - 1);
  });

  it('derives the name from the answers when no explicit customerName is given', async () => {
    const db = fakeDb([{ id: 'c1', deal_reference: 'FDS-1' }]);
    const repo = createContractsRepo({ db: db as never });
    await repo.insertContract({
      ...baseInput,
      id: 'c1',
      answers: { idScan: '{"surname":"Meier","givenNames":"Anna"}' },
    });

    expect(insertCall(db).binds).toContain('Anna Meier');
  });

  it('lets an explicit customerName win over anything derived from answers', async () => {
    const db = fakeDb([{ id: 'c1', deal_reference: 'FDS-1' }]);
    const repo = createContractsRepo({ db: db as never });
    await repo.insertContract({
      ...baseInput,
      id: 'c1',
      answers: { idScan: '{"surname":"Meier","givenNames":"Anna"}' },
      customerName: 'Dr. Anna Meier',
    });

    const { binds } = insertCall(db);
    expect(binds).toContain('Dr. Anna Meier');
    expect(binds).not.toContain('Anna Meier');
  });

  it('binds NULL, never an empty string, when nothing is derivable', async () => {
    const db = fakeDb([{ id: 'c1', deal_reference: 'FDS-1' }]);
    const repo = createContractsRepo({ db: db as never });
    await repo.insertContract({ ...baseInput, id: 'c1', customerName: '   ' });

    // Asserted on the customer_name bind SPECIFICALLY (it is last in the
    // column list) — a blanket "no empty string anywhere" would also catch
    // snapshot_terms_text, which is legitimately '' here.
    const { binds } = insertCall(db);
    expect(binds[binds.length - 1]).toBeNull();
  });
});
