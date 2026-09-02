import type { Appointment } from './db/appointmentsRepo';
import { formatDatePill, formatTimeHHmm, localDayDelta } from '../../lib/datetime/format';

/**
 * Pure view-model builder for the Termine tab (design SSOT screen 12).
 * Deterministic in `nowMs` (the caller anchors it to the device clock), so it
 * is unit-testable without touching the global clock — mirrors
 * WalletScreen.buildWalletView. No `react-native` import: pure data → view
 * strings, so the test needs no RN mock.
 */

/** One Termine card, reduced to display strings + its derived flags. */
export interface TermineRowView {
  id: string;
  houseId: string | null;
  /** Date-pill label: "Heute" / "Morgen" / "Fr, 31.7.". */
  pill: string;
  /** `HH:MM` time. */
  time: string;
  address: string | null;
  floorLabel: string | null;
  note: string | null;
  /** True when today (drives the amber/ink date-pill accent). */
  isToday: boolean;
  /**
   * Callback-verification chip label (design: "Rückruf-Verifizierung (74 J.)"),
   * or null for a normal follow-up. Age suffix omitted when unknown.
   */
  callbackLabel: string | null;
}

export interface TermineViewModel {
  rows: TermineRowView[];
  /** Total number of appointments (Folgetermine). */
  total: number;
  /** How many fall on the current local day. */
  todayCount: number;
}

/** Chip copy (German legal/domain term kept as-is per CLAUDE.md language policy). */
function callbackLabelFor(appointment: Appointment): string | null {
  if (appointment.kind !== 'callback_verification') return null;
  return appointment.customerAge === null
    ? 'Rückruf-Verifizierung'
    : `Rückruf-Verifizierung (${appointment.customerAge} J.)`;
}

export function buildTermineView(appointments: Appointment[], nowMs: number): TermineViewModel {
  const rows: TermineRowView[] = appointments.map((appointment) => {
    const isToday = localDayDelta(nowMs, new Date(appointment.scheduledAtIso).getTime()) === 0;
    return {
      id: appointment.id,
      houseId: appointment.houseId,
      pill: formatDatePill(nowMs, appointment.scheduledAtIso),
      time: formatTimeHHmm(appointment.scheduledAtIso),
      address: appointment.address,
      floorLabel: appointment.floorLabel,
      note: appointment.note,
      isToday,
      callbackLabel: callbackLabelFor(appointment),
    };
  });

  return {
    rows,
    total: rows.length,
    todayCount: rows.filter((r) => r.isToday).length,
  };
}
