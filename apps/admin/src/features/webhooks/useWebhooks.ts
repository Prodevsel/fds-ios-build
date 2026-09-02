import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Webhooks data layer (API-02).
 *
 * CONFIG (0037 webhook_config, one row per company): the SPA reads `target_url` +
 * `active` under RLS and writes them via a prior-read insert-or-update (the
 * project-wide ON CONFLICT ban on RLS tables). The per-company HMAC-SHA256
 * signing secret is generated at CREATE time and returned to the caller EXACTLY
 * ONCE (shown once, never re-displayed — mirrors the reveal-once discipline).
 *
 * EVENT LOG (0039 webhook_events): a read-only outbox the dispatcher (05-08)
 * drives. The SPA reads it under RLS (select-only; events are machine-generated,
 * no INSERT/UPDATE policy for `authenticated`). dead_letter rows sort FIRST (the
 * operator's focal point). REDELIVERY resets a dead_letter row to pending, which
 * is blocked by the terminal-immutable trigger for any non-service-role writer —
 * so it goes through the `webhook-redeliver` service-role Edge Function (a
 * follow-up endpoint), never a direct SPA write.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WebhookConfig {
  id: string;
  target_url: string;
  active: boolean;
}

export const webhookConfigQueryKey = (companyId: string | null) =>
  ['webhook-config', companyId] as const;

export function useWebhookConfig(companyId: string | null) {
  return useQuery({
    queryKey: webhookConfigQueryKey(companyId),
    enabled: Boolean(companyId),
    queryFn: async (): Promise<WebhookConfig | null> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('webhook_config')
        .select('id, target_url, active')
        .eq('company_id', companyId as string)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return (data as WebhookConfig | null) ?? null;
    },
  });
}

/** Cryptographically-random per-company webhook signing secret (hex). */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Persist the webhook target. Insert-or-update by a prior read (no ON CONFLICT).
 * On CREATE a fresh HMAC secret is generated and returned ONCE; on UPDATE the
 * existing secret is untouched and `secret` is null (never re-revealed).
 */
export function useSaveWebhookConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      companyId: string;
      targetUrl: string;
    }): Promise<{ secret: string | null }> => {
      const supabase = getSupabase();
      const { data: existing, error: readError } = await supabase
        .from('webhook_config')
        .select('id')
        .eq('company_id', input.companyId)
        .maybeSingle();
      if (readError) {
        throw readError;
      }
      if (existing?.id) {
        const { error } = await supabase
          .from('webhook_config')
          .update({ target_url: input.targetUrl, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) {
          throw error;
        }
        return { secret: null };
      }
      const secret = generateWebhookSecret();
      const { error } = await supabase.from('webhook_config').insert({
        company_id: input.companyId,
        target_url: input.targetUrl,
        webhook_secret: secret,
      });
      if (error) {
        throw error;
      }
      return { secret };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: webhookConfigQueryKey(variables.companyId) });
    },
  });
}

/**
 * Lightweight reachability probe for the configured target. A browser cannot read
 * a cross-origin response body/status (and the AUTHORITATIVE signed delivery is
 * the dispatcher's job), so this fires a `no-cors` POST and reports success when
 * the request leaves without a network-level error (host resolves / reachable)
 * and failure on a network error. It is a smoke test, not a signed delivery.
 */
export function useTestPing() {
  return useMutation({
    mutationFn: async (targetUrl: string): Promise<void> => {
      await fetch(targetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'test.ping', at: new Date().toISOString() }),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type WebhookStatus = 'delivered' | 'pending' | 'dead_letter';

export interface WebhookEvent {
  id: string;
  event_id: string;
  event_type: string;
  resource_id: string | null;
  payload: unknown;
  status: WebhookStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export const webhookEventsQueryKey = (companyId: string | null) =>
  ['webhook-events', companyId] as const;

/** A company's outbox events, dead_letter first (operator focal point) then newest. */
export function useWebhookEvents(companyId: string | null) {
  return useQuery({
    queryKey: webhookEventsQueryKey(companyId),
    enabled: Boolean(companyId),
    queryFn: async (): Promise<WebhookEvent[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('webhook_events')
        .select(
          'id, event_id, event_type, resource_id, payload, status, attempts, last_error, created_at, delivered_at',
        )
        .eq('company_id', companyId as string)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as WebhookEvent[];
      // dead_letter surfaces first regardless of recency (05-UI-SPEC focal point).
      const rank = (s: WebhookStatus) => (s === 'dead_letter' ? 0 : 1);
      return [...rows].sort((a, b) => rank(a.status) - rank(b.status));
    },
  });
}

/**
 * Redeliver a dead_letter event via the `webhook-redeliver` service-role Edge
 * Function (resetting a terminal row to pending is blocked for the SPA by the
 * terminal-immutable trigger). Redelivery is scoped to dead_letter only.
 */
export function useRedeliver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { companyId: string; eventId: string }): Promise<void> => {
      const supabase = getSupabase();
      const { error } = await supabase.functions.invoke('webhook-redeliver', {
        body: { event_id: input.eventId },
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: webhookEventsQueryKey(variables.companyId) });
      // Keep the operator-wide endpoints + event log in sync after a redelivery.
      void queryClient.invalidateQueries({ queryKey: OPERATOR_WEBHOOK_EVENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPERATOR_WEBHOOK_ENDPOINTS_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Operator cross-company mode (3.2 / 4.1) — operator_webhook_endpoints /
// operator_webhook_events (0056, security_invoker). RLS-scoped to the operator's
// visible companies; NEVER expose webhook_secret / payload / signature. The
// per-event dead_letter redelivery stays unchanged (uses company_id from the row).
// ---------------------------------------------------------------------------

export const OPERATOR_WEBHOOK_ENDPOINTS_KEY = ['webhook-endpoints', 'operator'] as const;
export const OPERATOR_WEBHOOK_EVENTS_KEY = ['webhook-events', 'operator'] as const;

export interface OperatorWebhookEndpoint {
  company_id: string;
  company_name: string | null;
  target_url: string;
  active: boolean;
  delivered_count: number;
  pending_count: number;
  dead_letter_count: number;
  total_count: number;
}

export interface OperatorWebhookEvent {
  id: string;
  company_id: string;
  company_name: string | null;
  event_type: string;
  status: WebhookStatus;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

/** One row per company config + a delivered/pending/dead_letter/total rollup. */
export function useOperatorWebhookEndpoints(enabled: boolean) {
  return useQuery({
    queryKey: OPERATOR_WEBHOOK_ENDPOINTS_KEY,
    enabled,
    queryFn: async (): Promise<OperatorWebhookEndpoint[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('operator_webhook_endpoints')
        .select(
          'company_id, company_name, target_url, active, delivered_count, pending_count, dead_letter_count, total_count',
        )
        .order('dead_letter_count', { ascending: false });
      if (error) {
        throw error;
      }
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
        company_id: String(r.company_id),
        company_name: (r.company_name as string | null) ?? null,
        target_url: String(r.target_url ?? ''),
        active: Boolean(r.active),
        delivered_count: Number(r.delivered_count ?? 0),
        pending_count: Number(r.pending_count ?? 0),
        dead_letter_count: Number(r.dead_letter_count ?? 0),
        total_count: Number(r.total_count ?? 0),
      }));
    },
  });
}

/** The global event log across visible companies, dead_letter-first (view order). */
export function useOperatorWebhookEvents(enabled: boolean) {
  return useQuery({
    queryKey: OPERATOR_WEBHOOK_EVENTS_KEY,
    enabled,
    queryFn: async (): Promise<OperatorWebhookEvent[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('operator_webhook_events')
        .select(
          'id, company_id, company_name, event_type, status, attempts, last_error, delivered_at, created_at',
        );
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as unknown as OperatorWebhookEvent[];
      // dead_letter first (focal point), then newest — mirrors the per-company sort.
      const rank = (s: WebhookStatus) => (s === 'dead_letter' ? 0 : 1);
      return [...rows].sort(
        (a, b) =>
          rank(a.status) - rank(b.status) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
  });
}
