import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { netPriceNote, withNetNote } from './netPriceNote';
import { t } from '../../i18n';

describe('netPriceNote (H02/D-5: display only, never arithmetic)', () => {
  it('returns the i18n net-price note', () => {
    expect(netPriceNote()).toBe(t('price.netNote'));
  });

  it('appends the note to a formatted price without touching the number', () => {
    expect(withNetNote('99,00 €')).toBe(`99,00 € ${t('price.netNote')}`);
  });

  it('leaves the input string byte-identical apart from the appended note', () => {
    const price = '1.234,56 €';
    expect(withNetNote(price).startsWith(price)).toBe(true);
  });

  /**
   * The whole point of D-5: this is a DISCLOSURE, not a calculation. Whether
   * net advertising is even permissible is an open question for the
   * Fachanwalt — but what must never happen is that the app quietly starts
   * computing a gross price from a note. Asserted against the source text so
   * a future edit that introduces a tax factor fails here, not at a door.
   */
  it('the module source contains no VAT arithmetic', () => {
    const source = readFileSync(join(__dirname, 'netPriceNote.ts'), 'utf8');
    expect(source).not.toMatch(/1\.19|0\.19|1\.07|0\.07/);
    expect(source).not.toMatch(/[*/]\s*1\./);
  });
});
