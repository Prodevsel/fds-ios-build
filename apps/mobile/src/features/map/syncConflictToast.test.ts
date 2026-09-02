import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolveSyncConflictToastKey } from './syncConflictToast';
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';

const conflict = (table: string, reason: string) => ({
  table,
  entryId: 'ec8b1d1e-0000-4000-8000-000000000001',
  op: 'PUT',
  reason,
});

// The two reasons applyContractOperation emits, copied verbatim. The last
// test in this file proves they are still the connector's literal strings —
// this module matches on them, and a silent drift would restore the exact
// defect it was written to fix.
const OFFER_TAKEN = 'contract rejected: this offer was already signed by the customer';
const DUPLICATE_INSERT = 'contract already persisted: duplicate insert consumed';

describe('resolveSyncConflictToastKey — contracts (the conflict nobody could see)', () => {
  it('tells the rep when the customer already signed the offer themselves', () => {
    expect(resolveSyncConflictToastKey(conflict('contracts', OFFER_TAKEN))).toBe(
      'map.contractSupersededToast',
    );
  });

  it('stays SILENT on an idempotent duplicate insert — the row is safe and the deal is fine', () => {
    expect(resolveSyncConflictToastKey(conflict('contracts', DUPLICATE_INSERT))).toBeNull();
  });

  it('the two contract reasons never resolve to the same copy', () => {
    expect(resolveSyncConflictToastKey(conflict('contracts', OFFER_TAKEN))).not.toBe(
      resolveSyncConflictToastKey(conflict('contracts', DUPLICATE_INSERT)),
    );
  });
});

describe('resolveSyncConflictToastKey — territories (unchanged T-02-07-04 behaviour)', () => {
  it('maps an invalid-geometry denial to the geometry error', () => {
    expect(
      resolveSyncConflictToastKey(
        conflict('territories', 'create_territory_boundary denied: boundary geometry is invalid'),
      ),
    ).toBe('errorState.invalidGeometry');
  });

  it('maps every other territory denial to "already assigned"', () => {
    expect(
      resolveSyncConflictToastKey(
        conflict('territories', 'lock_territory denied: territory is locked by another rep'),
      ),
    ).toBe('map.lockedTerritoryToast');
  });
});

describe('resolveSyncConflictToastKey — everything else', () => {
  it('says nothing about machinery a rep cannot act on', () => {
    expect(
      resolveSyncConflictToastKey(
        conflict('sync_demo', 'sync_demo deletes are not supported server-side'),
      ),
    ).toBeNull();
  });
});

describe('the keys and reasons this module depends on still exist', () => {
  it('every key it can return is present in BOTH locale bundles', () => {
    const keys = [
      'map.contractSupersededToast',
      'map.lockedTerritoryToast',
      'errorState.invalidGeometry',
    ];
    for (const key of keys) {
      expect(de).toHaveProperty(key);
      expect(en).toHaveProperty(key);
    }
  });

  it('the connector still emits the two contract reasons verbatim', () => {
    // Source-level: importing connector.ts here would drag PowerSync's native
    // modules into a pure test. The strings are the contract between the two
    // files, so the string is what gets asserted.
    const connector = readFileSync(
      fileURLToPath(new URL('../../lib/db/connector.ts', import.meta.url)),
      'utf-8',
    );
    expect(connector).toContain(OFFER_TAKEN);
    expect(connector).toContain(DUPLICATE_INSERT);
  });
});
