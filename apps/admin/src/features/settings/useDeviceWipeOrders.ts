import { useReps } from '@/features/reps/useReps';
import { getSupabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/**
 * Admin remote-wipe data layer (SEC-08, D-02/D-03). SELECTs `device_wipe_orders`
 * (0079) with NO client-side ownership `WHERE` clause — migration 0079's RLS
 * policy (`device_wipe_orders_select`) already scopes the visible rows to the
 * device-owning rep or a team lead/org-admin of the order's team, and
 * re-filtering client-side would duplicate that RLS predicate in a second
 * place (CLAUDE.md SSOT). This is the exact reasoning
 * `apps/mobile/src/features/settings/db/settingsPolicyRepo.ts` recorded in
 * plan 13-03 for the same shape of decision.
 *
 * `issue` and `forcePurge` call the two SECURITY DEFINER RPCs from
 * `supabase/migrations/0080_device_wipe_order_rpcs.sql`
 * (`issue_device_wipe_order` / `force_purge_device_wipe_order`) and return
 * their discriminated string verdict UNCHANGED — never a direct table
 * a direct table UPDATE, INSERT, or DELETE call. The table carries no write
 * policy at all (0079); adding one, or writing to the table directly from
 * this file, would be a defect.
 *
 * Rep display names come from the existing roster hook (`useReps`), not a
 * second query. `device_wipe_orders.device_owner_rep_id` references
 * `app_users(id)` (0079) — the membership's OWN `user_id`, not the
 * membership row's own `id`. `useReps()`'s `Rep.id` is the membership id, so
 * this file joins on `Rep.userId` (added to `useReps.ts` by this plan
 * specifically to make this join possible without a duplicate roster query).
 */

export type WipeStatus = 'queued' | 'locked_draining' | 'locked_stalled' | 'purged_complete';

const KNOWN_STATUSES: readonly WipeStatus[] = [
  'queued',
  'locked_draining',
  'locked_stalled',
  'purged_complete',
];

export type StallReason = 'queue' | 'unverified_path';
const KNOWN_STALL_REASONS: readonly StallReason[] = ['queue', 'unverified_path'];

export interface DeviceWipeOrderRow {
  id: string;
  repId: string;
  repName: string;
  deviceId: string | null;
  status: WipeStatus;
  /** Non-null only when `status === 'locked_stalled'`. */
  stallReason: StallReason | null;
  pendingArtifactCount: number;
  issuedAt: string;
  lastProgressAt: string | null;
  completedAt: string | null;
  forcedByName: string | null;
  forcedAt: string | null;
  forcedDiscardedCount: number | null;
}

/** Raw shape returned by `select * from device_wipe_orders` — snake_case,
 *  unknown-typed until parsed. */
interface RawWipeOrderRow {
  id?: unknown;
  device_owner_rep_id?: unknown;
  device_id?: unknown;
  status?: unknown;
  stall_reason?: unknown;
  pending_artifact_count?: unknown;
  issued_at?: unknown;
  last_progress_at?: unknown;
  completed_at?: unknown;
  forced_by?: unknown;
  forced_at?: unknown;
  forced_discarded_count?: unknown;
}

/** `{userId: repName}` — resolved from `useReps()`'s roster, never a second query. */
type RepDirectory = ReadonlyMap<string, string>;

/**
 * Pure parser: narrows a raw table row plus the rep directory into a
 * `DeviceWipeOrderRow`, or `null` if it fails a required-field/type guard.
 * Defensive against an unknown/malformed `status` or `stall_reason` — this is
 * a database-enforced enum (0079's `check` constraints), but the client never
 * trusts that alone: an unrecognized `status` normalizes to `'queued'`/
 * neutral rather than crashing or, worse, rendering as complete (D-02 — a
 * silent "wiped" claim is the single worst outcome this whole surface
 * exists to prevent). An unrecognized `stall_reason` normalizes to `null`
 * (the generic queue-stall copy), never to `'unverified_path'` — an absent
 * or unrecognized reason must not be guessed as the rarer, more alarming
 * cause (see `deriveWipeBadge`'s header for why that direction matters).
 */
export function parseDeviceWipeOrderRow(
  raw: RawWipeOrderRow,
  repDirectory: RepDirectory,
): DeviceWipeOrderRow | null {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.device_owner_rep_id !== 'string' || raw.device_owner_rep_id.length === 0) return null;
  if (typeof raw.issued_at !== 'string') return null;

  const status: WipeStatus =
    typeof raw.status === 'string' && (KNOWN_STATUSES as readonly string[]).includes(raw.status)
      ? (raw.status as WipeStatus)
      : 'queued';

  const stallReason: StallReason | null =
    typeof raw.stall_reason === 'string' &&
    (KNOWN_STALL_REASONS as readonly string[]).includes(raw.stall_reason)
      ? (raw.stall_reason as StallReason)
      : null;

  const pendingArtifactCount =
    typeof raw.pending_artifact_count === 'number' && Number.isFinite(raw.pending_artifact_count)
      ? raw.pending_artifact_count
      : 0;

  return {
    id: raw.id,
    repId: raw.device_owner_rep_id,
    repName: repDirectory.get(raw.device_owner_rep_id) ?? raw.device_owner_rep_id,
    deviceId: typeof raw.device_id === 'string' ? raw.device_id : null,
    status,
    stallReason,
    pendingArtifactCount,
    issuedAt: raw.issued_at,
    lastProgressAt: typeof raw.last_progress_at === 'string' ? raw.last_progress_at : null,
    completedAt: typeof raw.completed_at === 'string' ? raw.completed_at : null,
    forcedByName:
      typeof raw.forced_by === 'string' ? (repDirectory.get(raw.forced_by) ?? raw.forced_by) : null,
    forcedAt: typeof raw.forced_at === 'string' ? raw.forced_at : null,
    forcedDiscardedCount:
      typeof raw.forced_discarded_count === 'number' && Number.isFinite(raw.forced_discarded_count)
        ? raw.forced_discarded_count
        : null,
  };
}

function parseDeviceWipeOrderRows(
  rows: readonly RawWipeOrderRow[],
  repDirectory: RepDirectory,
): DeviceWipeOrderRow[] {
  const parsed: DeviceWipeOrderRow[] = [];
  for (const row of rows) {
    const order = parseDeviceWipeOrderRow(row, repDirectory);
    if (order) parsed.push(order);
  }
  return parsed;
}

export type BadgeVariant = 'neutral' | 'active' | 'invited' | 'removed';

/**
 * D-02: status must never collapse into a binary. Five distinguishable
 * presentations (queued / draining / stalled-queue / stalled-unverified-path
 * / complete) each get their own copy key, so an operator scanning a device
 * list can distinguish the states in grayscale too — the Accessibility
 * Contract's colour-is-never-the-only-signal rule.
 *
 * `locked_stalled` further splits on `stallReason` because "queue blocked"
 * and "device storage location unconfirmed" are both stalls, but they need
 * OPPOSITE operator responses: the first is resolved by connectivity and
 * time (wait), the second is resolved only by engineering escalation
 * (waiting fixes nothing — the purge never reached the queue check).
 * Rendering the queue sentence for a path stall would assert a specific,
 * false cause — a D-02 violation that is worse than showing no cause at
 * all, because the admin then confidently takes the WRONG action (waiting)
 * and the device sits locked forever. A `null` or unrecognized
 * `stallReason` therefore falls back to the generic queue copy, never to
 * the rarer, more alarming unverified-path copy — an absent reason must
 * never be guessed as the rarer cause.
 */
export function deriveWipeBadge(
  row: Pick<DeviceWipeOrderRow, 'status' | 'stallReason'>,
): { variant: BadgeVariant; copyKey: string } {
  switch (row.status) {
    case 'locked_draining':
      return { variant: 'invited', copyKey: 'wipe.statusDraining' };
    case 'locked_stalled':
      return row.stallReason === 'unverified_path'
        ? { variant: 'removed', copyKey: 'wipe.statusStalledUnverifiedPath' }
        : { variant: 'removed', copyKey: 'wipe.statusStalled' };
    case 'purged_complete':
      return { variant: 'active', copyKey: 'wipe.statusComplete' };
    default:
      return { variant: 'neutral', copyKey: 'wipe.statusQueued' };
  }
}

/**
 * D-03: the destructive escape hatch is reachable ONLY once a device is
 * genuinely locked (`locked_draining`/`locked_stalled`) — nothing has
 * happened yet for `queued`, and `purged_complete` is already closed — AND
 * only for role `operator` (mirrors `GovernanceTab.tsx`'s `role !==
 * 'operator'` gate). This is UX scoping only; the server independently
 * re-derives entitlement in `force_purge_device_wipe_order` (0080).
 */
export function canForcePurge(row: Pick<DeviceWipeOrderRow, 'status'>, role: string): boolean {
  if (role !== 'operator') return false;
  return row.status === 'locked_draining' || row.status === 'locked_stalled';
}

const QUERY_KEY = ['admin-device-wipe-orders'];

async function fetchDeviceWipeOrders(): Promise<RawWipeOrderRow[]> {
  // No client-side ownership filter — RLS on 0079 is the single enforcement
  // point (CLAUDE.md SSOT); see the file header.
  const { data, error } = await getSupabase()
    .from('device_wipe_orders')
    .select(
      'id, device_owner_rep_id, device_id, status, stall_reason, pending_artifact_count, issued_at, last_progress_at, completed_at, forced_by, forced_at, forced_discarded_count',
    )
    .order('issued_at', { ascending: false });
  if (error) {
    throw error;
  }
  return (data as RawWipeOrderRow[] | null) ?? [];
}

export type IssueOutcome = 'queued' | 'not_entitled' | 'already_pending';
export type ForcePurgeOutcome = 'forced' | 'not_entitled' | 'not_pending';

export interface UseDeviceWipeOrdersResult {
  rows: DeviceWipeOrderRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  issue: (repId: string) => Promise<IssueOutcome>;
  forcePurge: (orderId: string, discardedCount: number) => Promise<ForcePurgeOutcome>;
}

export function useDeviceWipeOrders(): UseDeviceWipeOrdersResult {
  const queryClient = useQueryClient();
  const { data: reps } = useReps();

  const repDirectory: RepDirectory = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const rep of reps ?? []) {
      if (rep.userId && rep.name) {
        map.set(rep.userId, rep.name);
      }
    }
    return map;
  }, [reps]);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchDeviceWipeOrders,
  });

  const rows = React.useMemo(
    () => parseDeviceWipeOrderRows(query.data ?? [], repDirectory),
    [query.data, repDirectory],
  );

  const refresh = React.useCallback(() => {
    void query.refetch();
  }, [query]);

  const issue = React.useCallback(
    async (repId: string): Promise<IssueOutcome> => {
      const { data, error } = await getSupabase().rpc('issue_device_wipe_order', { p_rep_id: repId });
      if (error) {
        throw error;
      }
      await query.refetch();
      return data as IssueOutcome;
    },
    [query],
  );

  const forcePurge = React.useCallback(
    async (orderId: string, discardedCount: number): Promise<ForcePurgeOutcome> => {
      const { data, error } = await getSupabase().rpc('force_purge_device_wipe_order', {
        p_order_id: orderId,
        p_discarded_count: discardedCount,
      });
      if (error) {
        throw error;
      }
      await query.refetch();
      return data as ForcePurgeOutcome;
    },
    [query],
  );

  React.useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: QUERY_KEY });
    };
  }, [queryClient]);

  return {
    rows,
    loading: query.isLoading,
    error: query.isError ? 'error' : null,
    refresh,
    issue,
    forcePurge,
  };
}
