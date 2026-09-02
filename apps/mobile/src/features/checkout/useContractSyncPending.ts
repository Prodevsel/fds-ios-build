import { useEffect, useState } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { deriveContractSyncPending } from '../flow-runner/db/contractsRepo';

/**
 * The minimum a caller must hand over to answer "has this contract left the
 * device yet?" — a read-only peek at the local CRUD upload queue plus the
 * status listener that says when to peek again. Narrowed rather than taking
 * the whole database so `DirectSignFlowScreen`, which never had a full
 * PowerSync handle, can supply one without growing a dependency it does not
 * otherwise need.
 */
export type ContractSyncSource = Pick<
  AbstractPowerSyncDatabase,
  'getCrudBatch' | 'registerListener'
>;

/**
 * Live "is this contract still queued for upload?" for the success screen.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `SuccessScreen`'s transfer card was fed a HARDCODED `syncPending: true`, at
 * both call sites, justified in a comment as "always true right after an
 * offline insert". That is true offline and false online — and online is the
 * ordinary case. So the one screen a rep sees after every single deal always
 * said "Wird übertragen, sobald Netz da ist", on a device that was online and
 * had already uploaded. It reads as noise, and worse, as the app doubting the
 * rep. The component already renders the truthful alternative
 * (`checkout.successTransferDone`) the moment the prop stops lying.
 *
 * ── Where the truth comes from ──────────────────────────────────────────────
 * The SAME source the sync pill, "Meine Abschlüsse" and the Abschluss-Detail
 * banner already use (D-22): the local PowerSync CRUD upload queue, peeked
 * read-only via `getCrudBatch` and never `.complete()`d here. Deliberately NOT
 * `status.connected` / `dataFlowStatus.uploading` — those describe the
 * CONNECTION, and a connected client with this contract still queued is
 * exactly the case the card must keep warning about. The queue answers the
 * question the card actually asks, and it answers it per contract.
 *
 * Starts at `true`. The first peek is asynchronous, and for the fraction of a
 * second before it resolves, "still transferring" is the claim that cannot be
 * wrong: the insert did just happen. Flipping the other way would flash
 * "Übertragen" at a rep whose upload had not started.
 *
 * A null `contractId` (no completion yet) or a null `db` (a call site with no
 * PowerSync handle) also holds at `true` — the previous, unconditional
 * behaviour, kept as the degradation rather than a cheerful guess.
 */
export function useContractSyncPending(
  db: ContractSyncSource | null | undefined,
  contractId: string | null,
): boolean {
  const [pending, setPending] = useState(true);

  useEffect(() => {
    if (!db || !contractId) {
      setPending(true);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      // 1000 is the peek window every other D-22 call site uses
      // (ContractListScreen, AbschlussDetailScreen) — kept identical so the
      // success screen and the list can never disagree about one contract.
      const batch = await db.getCrudBatch(1000);
      if (cancelled) return;
      setPending(deriveContractSyncPending(contractId, batch?.crud ?? []));
    };
    void refresh();
    // statusChanged is what fires when the queue drains — same subscription
    // shape as AbschlussDetailScreen's banner, so both settle together.
    const unsubscribe = db.registerListener({ statusChanged: () => void refresh() });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [db, contractId]);

  return pending;
}
