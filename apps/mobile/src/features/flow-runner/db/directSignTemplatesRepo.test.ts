import { describe, expect, it } from 'vitest';
import { createDirectSignTemplatesRepo } from './directSignTemplatesRepo';

function fakeDb(rows: Record<string, unknown>[]) {
  return { getAll: async () => rows } as unknown as Parameters<
    typeof createDirectSignTemplatesRepo
  >[0]['db'];
}

const RAW = {
  id: 'tpl-1',
  company_id: 'co-1',
  storage_path: 'co-1/vertrag.pdf',
  sha256: 'abc',
  signature_page: '1',
  signature_x_frac: '0.3125',
  signature_y_frac: '0.8432',
  status: 'published',
};

describe('createDirectSignTemplatesRepo', () => {
  // Every synced column arrives as TEXT (schema.ts convention). Handing a
  // caller "0.3125" instead of 0.3125 would place the signature by string
  // coercion, which is exactly the kind of silent numeric bug this project
  // has been bitten by before.
  it('parses the placement fractions into numbers', async () => {
    const repo = createDirectSignTemplatesRepo({ db: fakeDb([RAW]) });
    const row = await repo.getById('tpl-1');
    expect(row?.signature_page).toBe(1);
    expect(row?.signature_x_frac).toBeCloseTo(0.3125);
    expect(row?.signature_y_frac).toBeCloseTo(0.8432);
  });

  it('reports an unplaced template as null rather than 0', async () => {
    const repo = createDirectSignTemplatesRepo({
      db: fakeDb([{ ...RAW, signature_page: null, signature_x_frac: null, signature_y_frac: null }]),
    });
    const row = await repo.getById('tpl-1');
    expect(row?.signature_page).toBeNull();
    expect(row?.signature_x_frac).toBeNull();
  });

  it('returns null when the template is not synced to this device', async () => {
    const repo = createDirectSignTemplatesRepo({ db: fakeDb([]) });
    await expect(repo.getById('missing')).resolves.toBeNull();
  });
});
