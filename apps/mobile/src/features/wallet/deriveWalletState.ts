/**
 * Wallet commission lifecycle state (D-01).
 *
 * - `in_review`  — the 14-day statutory Widerrufsfrist (withdrawal period) is
 *                  still running (< 14 days since signature).
 * - `secured`    — 14 days elapsed with NO cancellation event; time-based,
 *                  computed on-device.
 * - `reversed`   — a `contract.cancelled` event arrived → shown as a visible
 *                  reversal line, NEVER silently removed (transparency).
 */
export type WalletState = 'in_review' | 'secured' | 'reversed';

/** 14-day statutory Widerrufsfrist, measured from the signature timestamp. */
const WIDERRUF_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pure, side-effect-free state classifier (offline, device/server-anchored clock).
 *
 * Reversal is checked FIRST (D-01): a cancelled deal is `reversed` even once
 * 14 days have passed — it must never silently roll into `secured`.
 *
 * @param signedAtIso    ISO timestamp of the contract signature (the timer's t0).
 * @param nowMs          Current time in epoch milliseconds (caller supplies the anchor).
 * @param cancelledAtIso ISO timestamp of the cancellation event, or null if none.
 */
export function deriveWalletState(
  signedAtIso: string,
  nowMs: number,
  cancelledAtIso: string | null,
): WalletState {
  if (cancelledAtIso) return 'reversed'; // D-01: reversal wins, always visible.
  const elapsed = nowMs - new Date(signedAtIso).getTime();
  return elapsed >= WIDERRUF_MS ? 'secured' : 'in_review';
}
