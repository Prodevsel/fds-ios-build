import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/auth/supabase';
import {
  createTenantIdentityCache,
  type TenantIdentityCache,
  type TenantIdentityRow,
  type TenantKind,
} from './tenantIdentityCache';

/**
 * useTenantIdentity — SEC-10/D-16: resolves "which tenant is this rep logged
 * into" cache-first (`tenantIdentityCache.ts`, MMKV, outside PowerSync) with
 * a refresh from `public.my_tenant_identity()` (plan 14-02). Mirrors
 * `useSessionIdentity.ts`'s `useState` + `useEffect` + `cancelled`-guard +
 * `ready` shape.
 *
 * Per the STATE.md 12-04 rule, the cache is a render accelerator only — a
 * successful RPC result always overwrites it; a failed RPC (offline) falls
 * back to whatever was cached rather than blanking a previously-known tenant
 * name; a zero-row RPC result is deliberately never cached and resolves to
 * the unready/unknown state (never an invented default, never a blank name
 * treated as valid — T-14-09-03).
 */

export interface TenantIdentityState {
  ready: boolean;
  tenantName: string | null;
  tenantKind: TenantKind | null;
  /** The RPC's full row set, in the RPC's own order — a user can hold
   * memberships across teams, so a future surface may render more than one;
   * callers must not assume exactly one row. */
  all: TenantIdentityRow[];
  /** True when this state came from the on-device cache rather than a fresh
   * RPC response (e.g. offline at a cold start). */
  fromCache: boolean;
}

const UNKNOWN_STATE: TenantIdentityState = {
  ready: false,
  tenantName: null,
  tenantKind: null,
  all: [],
  fromCache: false,
};

/** Raw shape returned by `supabase.rpc('my_tenant_identity')` — snake_case, unknown-typed until parsed. */
interface RawTenantIdentityRow {
  tenant_kind?: unknown;
  tenant_id?: unknown;
  tenant_name?: unknown;
}

/**
 * Pure parser: narrows a raw RPC row into a `TenantIdentityRow`, or `null`
 * if it fails a required-field/type guard — drops rather than guesses
 * (mirrors `sessionsRepo.ts`'s `parseSessionRow` convention). An empty
 * `tenant_name` is dropped, never rendered as a blank-but-valid name.
 */
export function parseTenantIdentityRow(raw: RawTenantIdentityRow): TenantIdentityRow | null {
  if (raw.tenant_kind !== 'company' && raw.tenant_kind !== 'sales_org') return null;
  if (typeof raw.tenant_id !== 'string' || raw.tenant_id.length === 0) return null;
  if (typeof raw.tenant_name !== 'string' || raw.tenant_name.length === 0) return null;
  return { tenantKind: raw.tenant_kind, tenantId: raw.tenant_id, tenantName: raw.tenant_name };
}

function parseTenantIdentityRows(rows: readonly RawTenantIdentityRow[]): TenantIdentityRow[] {
  const parsed: TenantIdentityRow[] = [];
  for (const row of rows) {
    const identity = parseTenantIdentityRow(row);
    if (identity) parsed.push(identity);
  }
  return parsed;
}

/** Deterministic display value: the first row after the RPC's own ordering
 * (`order by tenant_kind, tenant_name` in 0078) — never an arbitrary pick. */
function toState(rows: TenantIdentityRow[] | null, fromCache: boolean): TenantIdentityState {
  const first = rows?.[0];
  if (!rows || rows.length === 0 || !first) return UNKNOWN_STATE;
  return {
    ready: true,
    tenantName: first.tenantName,
    tenantKind: first.tenantKind,
    all: rows,
    fromCache,
  };
}

export interface ResolveTenantIdentityOptions {
  cache: TenantIdentityCache;
  /** Injectable for tests (mirrors `sessionsRepo.ts`'s `Pick<SupabaseClient, 'rpc'>` DI). */
  rpc: () => PromiseLike<{ data: unknown; error: unknown }>;
  userId: string;
}

/**
 * Pure/DI'd core, tested directly against fakes (no component mounting):
 * reads the per-user cache, then calls the RPC.
 * - RPC succeeds with >=1 row: overwrites the cache, wins outright
 *   (`fromCache: false`).
 * - RPC succeeds with 0 rows: NOT cached, resolves to the unready/unknown
 *   state — even if a stale cache entry exists (T-14-09-03: a zero-row
 *   result is itself information, not a transport failure to paper over).
 * - RPC fails (network/transport error): the cache is left untouched; a
 *   pre-existing cached value is returned (`fromCache: true`) — a stale
 *   real name beats no name for informational chrome — but no cache entry
 *   is ever created out of nothing.
 */
export async function resolveTenantIdentity({
  cache,
  rpc,
  userId,
}: ResolveTenantIdentityOptions): Promise<TenantIdentityState> {
  const cached = cache.get(userId);

  let rpcRows: TenantIdentityRow[] | null = null;
  let rpcFailed = false;
  try {
    const { data, error } = await rpc();
    if (error) {
      rpcFailed = true;
    } else {
      rpcRows = parseTenantIdentityRows(((data as RawTenantIdentityRow[] | null) ?? []));
    }
  } catch {
    rpcFailed = true;
  }

  if (rpcRows !== null) {
    if (rpcRows.length > 0) {
      cache.set(userId, rpcRows);
      return toState(rpcRows, false);
    }
    // Zero-row result: deliberately not cached (see doc comment above).
    return UNKNOWN_STATE;
  }

  if (rpcFailed && cached && cached.length > 0) {
    return toState(cached, true);
  }

  return UNKNOWN_STATE;
}

export interface UseTenantIdentityOptions {
  userId: string | null;
}

export function useTenantIdentity({ userId }: UseTenantIdentityOptions): TenantIdentityState {
  const [state, setState] = useState<TenantIdentityState>(UNKNOWN_STATE);

  useEffect(() => {
    if (!userId) {
      setState(UNKNOWN_STATE);
      return;
    }
    let cancelled = false;
    const cache = createTenantIdentityCache();
    void resolveTenantIdentity({
      cache,
      rpc: () => getSupabase().rpc('my_tenant_identity'),
      userId,
    }).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}
