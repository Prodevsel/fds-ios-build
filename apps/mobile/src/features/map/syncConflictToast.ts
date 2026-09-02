import type { SyncConflict } from '../../lib/db/connector';
import type { TranslationKey } from '../../i18n';

/**
 * Which i18n key (if any) a server-authoritative sync conflict is worth
 * telling the rep about, on the map's existing non-blocking toast.
 *
 * Pure and exported for the same reason `mapChrome.ts` and `houseList.ts` are:
 * this used to be four lines inside `MapScreen`'s `handleSyncConflict`, where
 * no test in this repo can reach them — and the defect this module exists to
 * fix was precisely a decision made in those unreachable four lines.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `applyContractOperation` stopped THROWING on a 23505 (2181874) because a
 * throw wedges the strictly-ordered upload queue forever: every contract
 * signed afterwards sits behind an op that can never succeed. Correct. It
 * consumes the op and reports it via `onConflict` instead. But the only
 * consumer opened with `if (conflict.table !== 'territories') return;`, so the
 * report went nowhere: when a customer signed the same offer in the browser
 * while the rep was offline, the rep's contract was dropped in perfect
 * silence. The rep walks away believing the deal is theirs, sees no deal in
 * "Abschlüsse", and has no sentence anywhere in the app explaining why.
 *
 * ── Why exactly one of the two contract reasons is shown ────────────────────
 * The connector emits two, and they are not the same news:
 *
 *   * `redeemed_lead_id` (idx_contracts_redeemed_lead_id_once, 0098) — the
 *     customer already signed this offer themselves. The rep's copy is gone
 *     and will never land. That is a real, un-retryable outcome about a deal
 *     the rep just closed at a door, and it MUST reach them.
 *
 *   * a primary-key duplicate — the same contract already landed on an
 *     earlier attempt whose acknowledgement was lost. The row is safe, the
 *     deal is fine, the retry was idempotent exactly as designed. Alarming a
 *     rep about a successful write teaches them to ignore the toast, which
 *     costs us the first case above.
 *
 * So the second returns null — deliberately silent, not overlooked.
 */
export function resolveSyncConflictToastKey(conflict: SyncConflict): TranslationKey | null {
  if (conflict.table === 'territories') {
    // Unchanged behaviour (T-02-07-04): boundary/lock denials. `invalid`
    // matches the invalid-geometry verdict; every other territory denial is
    // "someone else has this area".
    return conflict.reason.includes('invalid')
      ? 'errorState.invalidGeometry'
      : 'map.lockedTerritoryToast';
  }

  if (conflict.table === 'contracts') {
    // Matched on the substring the connector's own reason string carries
    // ('contract rejected: this offer was already signed by the customer').
    // Substring rather than equality so a later edit to the sentence's tail
    // degrades to the silent branch instead of crashing — but the test below
    // pins the connector's literal strings so such an edit fails loudly first.
    return conflict.reason.includes('already signed by the customer')
      ? 'map.contractSupersededToast'
      : null;
  }

  // Everything else the connector reports (sync_demo, app_users, teams) is
  // machinery a rep at a door can neither act on nor understand.
  return null;
}
