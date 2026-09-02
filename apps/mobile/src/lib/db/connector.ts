import type { AbstractPowerSyncDatabase, CrudEntry, PowerSyncCredentials } from '@powersync/common';
import { UpdateType } from '@powersync/common';

/**
 * PowerSync backend connector (SYNC-04, Iron Rules 1 & 3).
 *
 * `uploadData()` is the ONLY path a local write takes to the server, and it
 * branches PER ENTITY — never blanket last-write-wins:
 * - contracts:   APPEND-ONLY. PUT inserts; PATCH/DELETE throw (backed by the
 *                DB trigger in 0004_conflict_functions.sql — T-01-19).
 * - territories: SERVER-AUTHORITATIVE. Lock/unlock writes are routed through
 *                the lock_territory()/unlock_territory() RPCs; any denial
 *                ('conflict' | 'not_entitled' from lock_territory, `false`
 *                from unlock_territory) is surfaced via `onConflict`, never
 *                silently dropped and never blindly retried (T-01-18). A
 *                'not_entitled' denial additionally reverts the local
 *                optimistic lock, since the unchanged server row will never
 *                replicate a correction down (WR-04).
 * - sync_demo:   documented LWW (see the table comment in 0001/0004) — PUT is
 *                a plain INSERT, PATCH a real UPDATE, same template as
 *                houses below (folded todo: migrated OFF the ON-CONFLICT
 *                upsert call, powersync-insert-not-streamed.md — ANY upsert
 *                against sync_demo's SECURITY DEFINER-visibility-gated RLS
 *                trips the same 42501 speculative-insertion trap houses hit,
 *                02-08). DELETE is NOT part of the LWW contract: the server
 *                deliberately grants only select/insert/update (0005) and
 *                defines no DELETE policy, so a local delete can never
 *                succeed server-side. It is surfaced as a consumed conflict
 *                — never uploaded, never retried (the retry-forever queue
 *                wedge was Defect 3 / 0006).
 * - houses:      LWW-ACCEPTABLE (0014_houses_and_blacklist.sql table comment)
 *                — plain upsert, same template as sync_demo. territory_id is
 *                server-computed by assign_house_territory() (0017); the
 *                client never sets it authoritatively — it's just replicated
 *                back for rendering.
 * - blacklist_entries: INSERT-ONLY (GDPR data-minimization; no update/delete
 *                RLS policy server-side). PATCH/DELETE throw, same template
 *                as contracts.
 * - territories boundary writes: SERVER-AUTHORITATIVE via the
 *                create_territory_boundary() RPC (T-02-04-02) — a PATCH whose
 *                opData carries a `boundary` field routes here instead of the
 *                lock_territory() path; a denial ('invalid_geometry' |
 *                'not_entitled') is surfaced via onConflict and the local
 *                optimistic boundary write is reverted, never blindly
 *                retried (mirrors the lock-denial revert pattern).
 * - product_definitions: SERVER-WRITTEN ONLY (published via the publish
 *                CLI, never the client) — any client write is rejected
 *                loudly, matching contracts' whitelist-throw posture but
 *                for ALL ops (not just PATCH/DELETE).
 * - discount_terms: SERVER-WRITTEN ONLY, same template as
 *                product_definitions.
 * - flow_drafts: LWW-ACCEPTABLE, device-local single-writer (D-04/D-09) —
 *                PATCH is a real UPDATE, PUT a plain INSERT tolerating a
 *                duplicate-key redelivery as already-uploaded success, same
 *                template as houses/sync_demo — NEVER an upsert call/
 *                ON CONFLICT (02-08 42501 trap).
 * - appointments: LWW-ACCEPTABLE, device-local single-writer (0058) — the rep's
 *                own follow-up calendar (design SSOT "Follow-up setzt einen
 *                Folgetermin"). PATCH is a real UPDATE, PUT a plain INSERT
 *                tolerating a duplicate-key redelivery, same template as
 *                houses/flow_drafts — NEVER an upsert/ON CONFLICT.
 * - scan_telemetry: INSERT-ONLY (CHKT-04, D-13/D-14/D-15) — same
 *                append-only-reject template as blacklist_entries; plain
 *                INSERT, PATCH/DELETE throw, NEVER an upsert/ON CONFLICT.
 * - leads:       INSERT-ONLY, consent-gated (D-17, 0033_leads.sql) — same
 *                plain-INSERT append-only-reject template; PATCH/DELETE throw,
 *                NEVER an upsert/ON CONFLICT (the standing ban). consent_given
 *                is coerced text→boolean so the leads_insert_by_rep WITH CHECK
 *                (consent_given = true, T-05-43) holds. A duplicate-key
 *                redelivery is treated as already-uploaded success.
 * - contracts (extended, 0029): applyContractOperation additionally parses
 *                the jsonb-as-text `audit_package`/`answers` columns
 *                (normalizeContractJsonb) before forwarding — same
 *                parse-before-forward precedent as normalizeFlowDraftAnswers,
 *                remains PUT-only/append-only.
 * - teams:       READ-ONLY, SERVER-WRITTEN ONLY (ROLE-01/ROLE-02, Phase 7) —
 *                provisioned via the Phase 5 rep-invite Edge Function /
 *                handle_invited_user() trigger, never a client writer at all
 *                (not even a publish-CLI path like product_definitions/
 *                discount_terms). Any client write is rejected loudly,
 *                unconditionally, for every op (T-07-03).
 * - memberships: READ-ONLY, SERVER-WRITTEN ONLY — same template as teams.
 * - org_admins:  READ-ONLY, SERVER-WRITTEN ONLY — same template as teams.
 * - territory_assignments: READ-ONLY, SERVER/RPC-WRITTEN ONLY (TASGN-01/02,
 *                Phase 8, D-04 REVISED Option B) — written exclusively via
 *                the assign_territory() RPC (Plan 04), called directly by
 *                the UI, NOT routed through this connector's CRUD upload
 *                queue. Any local write attempt is rejected loudly, same
 *                unconditional-throw template as teams.
 * - app_users:   OWN-ROW PATCH OF A FIXED PROFILE-COLUMN WHITELIST, nothing
 *                else (D-01/D-02, Phase 12, 0072_app_users_profile_columns.sql)
 *                — a rep may PATCH full_name/avatar_url/contact_phone/
 *                contact_email on their OWN row only; every other op (PUT,
 *                DELETE, PATCH of any other column, or PATCH of a foreign
 *                id) is rejected loudly. Provisioning stays server-side via
 *                handle_invited_user() (0046) — this widening is defence in
 *                depth ON TOP OF the app_users_update_own RLS policy (0072),
 *                because RLS alone permits any column of an own row to
 *                change, not just the profile-editable subset.
 * - direct_sign_templates: READ-ONLY, SERVER-WRITTEN ONLY (DSGN-01, Phase 10,
 *                T-10-10) — company-uploaded, immutable-once-published PDF
 *                templates written only via the admin dashboard upload/
 *                placement step, never the client. Any client write attempt
 *                is rejected loudly, unconditionally, for every op — same
 *                template as teams.
 * - tenant_setting_policies: READ-ONLY, SERVER-WRITTEN ONLY (SET-07/SET-09,
 *                Phase 13, D-10/D-14) — org-admin governance rows written
 *                only via the admin dashboard governance tab, never the
 *                client. Any client write attempt is rejected loudly,
 *                unconditionally, for every op — same template as
 *                direct_sign_templates.
 * - device_wipe_orders: READ-ONLY, RPC-WRITTEN ONLY (SEC-08, Phase 15,
 *                D-01/D-02, T-15-03-06) — written exclusively via
 *                issue_device_wipe_order()/force_purge_device_wipe_order()/
 *                report_wipe_progress() (0080), called directly by the UI
 *                and the device-side wipe machinery, NOT routed through this
 *                connector's CRUD upload queue. Any client write attempt is
 *                rejected loudly, unconditionally, for every op — same
 *                unconditional-throw template as territory_assignments.
 * - default:     REJECTED. Client-supplied table names are whitelisted, never
 *                forwarded (ASVS V5, T-01-20).
 */

/** Structural supabase-js surface the connector consumes (injectable for tests). */
export interface SupabaseLike {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
    upsert(values: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
    /** 0105: removing a party. The only DELETE this connector ever issues. */
    delete(): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: boolean | string | null; error: { message: string } | null }>;
  auth: {
    getSession(): Promise<{
      data: {
        session: { access_token: string; expires_at?: number; user: { id: string } } | null;
      };
      error: { message: string } | null;
    }>;
  };
}

/** A server-side conflict decision surfaced to the UI layer (never dropped). */
export interface SyncConflict {
  table: string;
  entryId: string;
  op: string;
  reason: string;
}

export interface SupabaseConnectorOptions {
  supabase: SupabaseLike;
  /** PowerSync service endpoint, e.g. http://localhost:8080 (self-hosted Open Edition, Plan 06). */
  powersyncUrl: string;
  /** Receives server-authoritative conflict decisions (e.g. territory lock denied). */
  onConflict?: (conflict: SyncConflict) => void;
}

/** Columns a client may touch on `territories` — exclusively the lock pair. */
const TERRITORY_LOCK_COLUMNS = new Set(['locked_by', 'locked_at']);

/**
 * Columns a client may PATCH on their OWN `app_users` row (D-01/D-02, Phase
 * 12, 0072_app_users_profile_columns.sql) — same closed-whitelist idiom as
 * TERRITORY_LOCK_COLUMNS above. contact_phone/contact_email are writable here
 * even though they never ride the app_users sync stream (T-12-13-03) — the
 * write goes straight to Supabase, never through a locally-synced column.
 */
const APP_USER_EDITABLE_COLUMNS = new Set(['full_name', 'avatar_url', 'contact_phone', 'contact_email']);

export class SupabaseConnector {
  private readonly supabase: SupabaseLike;
  private readonly powersyncUrl: string;
  private readonly onConflict?: (conflict: SyncConflict) => void;

  constructor(options: SupabaseConnectorOptions) {
    this.supabase = options.supabase;
    this.powersyncUrl = options.powersyncUrl;
    this.onConflict = options.onConflict;
  }

  /**
   * Supplies the PowerSync service endpoint plus the Supabase Auth JWT.
   * PowerSync validates the token against Supabase's JWKS (wired in Plan 06's
   * service.yaml `client_auth`).
   */
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error || !data.session) {
      return null;
    }
    return {
      endpoint: this.powersyncUrl,
      token: data.session.access_token,
      expiresAt: data.session.expires_at ? new Date(data.session.expires_at * 1000) : undefined,
    };
  }

  /**
   * Drains the local CRUD upload queue, applying the per-entity rules above.
   * Throws on permanent rule violations (append-only breach, unknown table) —
   * the transaction is then NOT completed, so nothing is lost silently.
   */
  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    for (const op of transaction.crud) {
      await this.applyOperation(op, database);
    }

    await transaction.complete();
  }

  private async applyOperation(op: CrudEntry, database: AbstractPowerSyncDatabase): Promise<void> {
    switch (op.table) {
      case 'contracts':
        await this.applyContractOperation(op);
        return;
      case 'territories':
        await this.applyTerritoryOperation(op, database);
        return;
      case 'sync_demo':
        await this.applySyncDemoOperation(op);
        return;
      case 'houses':
        await this.applyHousesOperation(op);
        return;
      case 'blacklist_entries':
        await this.applyBlacklistOperation(op);
        return;
      case 'product_definitions':
        await this.applyProductDefinitionOperation(op);
        return;
      case 'discount_terms':
        await this.applyDiscountTermsOperation(op);
        return;
      case 'flow_drafts':
        await this.applyFlowDraftOperation(op);
        return;
      case 'appointments':
        await this.applyAppointmentOperation(op);
        return;
      case 'scan_telemetry':
        await this.applyScanTelemetryOperation(op);
        return;
      case 'leads':
        await this.applyLeadOperation(op);
        return;
      case 'teams':
        await this.applyTeamOperation(op);
        return;
      case 'memberships':
        await this.applyMembershipOperation(op);
        return;
      case 'org_admins':
        await this.applyOrgAdminOperation(op);
        return;
      case 'territory_assignments':
        await this.applyTerritoryAssignmentReadOnly(op);
        return;
      case 'app_users':
        await this.applyAppUserOperation(op);
        return;
      case 'direct_sign_templates':
        await this.applyDirectSignTemplateReadOnly(op);
        return;
      case 'user_settings':
        await this.applyUserSettingsOperation(op);
        return;
      case 'tenant_setting_policies':
        await this.applyTenantSettingPoliciesReadOnly(op);
        return;
      case 'device_wipe_orders':
        await this.applyDeviceWipeOrderReadOnly(op);
        return;
      default:
        // ASVS V5: whitelist, never forward client-supplied table names.
        throw new Error(`upload rejected: '${op.table}' is not a whitelisted table`);
    }
  }

  private async applyContractOperation(op: CrudEntry): Promise<void> {
    if (op.op !== UpdateType.PUT) {
      throw new Error(
        `contracts are append-only: ${op.op} on contracts.id=${op.id} is not permitted post-persist`,
      );
    }
    const opData = nullifyEmptyUuidColumns(this.normalizeContractJsonb(op.opData ?? {}), [
      'terms_id',
      'signature_attachment_id',
      // DSGN-03 (0069): same empty-string-uuid upload-boundary backstop as
      // the two columns above — direct_sign_template_id is null for every
      // flow-form contract.
      'direct_sign_template_id',
      // 0084 (§5.2): null for every closing that did not redeem an offer —
      // same empty-string-uuid backstop as the three columns above.
      'redeemed_lead_id',
      // 0101: null for a contract signed outside the house flow. This column
      // has to be listed HERE, not only in schema.ts — a missing entry does
      // not fail, it silently uploads an empty string into a uuid column.
      'house_id',
    ]);
    const { error } = await this.supabase.from('contracts').insert({ ...opData, id: op.id });
    if (error) {
      // ── A unique violation here is FINAL, and treating it as retryable is
      // the worst failure this queue can have ─────────────────────────────
      // The upload queue is strictly ordered: an op that keeps throwing is
      // retried forever and every contract signed afterwards sits behind it,
      // unsent. So the only ops allowed to throw are the ones a later attempt
      // could actually succeed at. 23505 is never one of them.
      //
      // Two ways to reach it, both real:
      //
      //   * `idx_contracts_redeemed_lead_id_once` (0098) — the customer
      //     already signed the same offer in the browser while the rep was
      //     offline. The lead is closed, the deal exists, and no retry will
      //     ever make room for a second contract against it. Wedging the
      //     queue over a deal that DID close would be the exact opposite of
      //     what the index is for.
      //
      //   * the primary key — this contract already landed on a previous
      //     attempt whose acknowledgement was lost. Re-inserting is the
      //     definition of a duplicate; the row is safe, the op is done.
      //
      // Either way the server state is already correct, so the op is consumed
      // and the conflict surfaced rather than swallowed silently.
      // The narrowed error type this repo's Supabase stub declares carries
      // only `message`; PostgREST really sends `code` and `details` too, so
      // read them defensively rather than widening the stub for one branch.
      const pgError = error as { message: string; code?: string; details?: string };
      if (pgError.code === '23505' || pgError.message.includes('23505')) {
        const redeemedOfferTaken = `${pgError.message} ${pgError.details ?? ''}`.includes(
          'redeemed_lead_id',
        );
        this.onConflict?.({
          table: 'contracts',
          entryId: op.id,
          op: op.op,
          reason: redeemedOfferTaken
            ? 'contract rejected: this offer was already signed by the customer'
            : 'contract already persisted: duplicate insert consumed',
        });
        return;
      }
      throw new Error(`contracts insert failed for id=${op.id}: ${error.message}`);
    }
  }

  /**
   * 0029: `audit_package` and `answers` are the two jsonb columns on the
   * extended contracts row, mirrored client-side as text (schema.ts) —
   * forwarding them verbatim would land them in Postgres as a SCALAR STRING
   * (double-encoded) instead of an object, same failure class
   * normalizeFlowDraftAnswers fixes for flow_drafts.answers. Parse ONLY these
   * two columns; package_hash_sha256/deal_reference/snapshot_* are not jsonb
   * and PostgREST coerces them fine as-is.
   */
  private normalizeContractJsonb(opData: Record<string, unknown>): Record<string, unknown> {
    let normalized = opData;
    if ('audit_package' in normalized && typeof normalized.audit_package === 'string') {
      normalized = { ...normalized, audit_package: JSON.parse(normalized.audit_package) };
    }
    if ('answers' in normalized && typeof normalized.answers === 'string') {
      normalized = { ...normalized, answers: JSON.parse(normalized.answers) };
    }
    return normalized;
  }

  private async applyScanTelemetryOperation(op: CrudEntry): Promise<void> {
    // INSERT-ONLY (CHKT-04, D-13/D-14/D-15 — no update/delete RLS policy
    // server-side) — same template as applyBlacklistOperation/
    // applyContractOperation.
    if (op.op !== UpdateType.PUT) {
      throw new Error(
        `scan_telemetry are insert-only: ${op.op} on scan_telemetry.id=${op.id} is not permitted post-persist`,
      );
    }
    const { error } = await this.supabase.from('scan_telemetry').insert({ ...op.opData, id: op.id });
    if (error) {
      throw new Error(`scan_telemetry insert failed for id=${op.id}: ${error.message}`);
    }
  }

  /**
   * WR-04: when the server DENIES a lock without touching the row
   * ('not_entitled' — identity/visibility denial), nothing ever replicates
   * down to correct the client's optimistic local locked_by write. Revert it
   * explicitly so local state converges. (For 'conflict' the winner's lock
   * replicates down and corrects the row — no revert needed.)
   *
   * WR-11: the revert is a LOCAL-ONLY write and must NOT re-enter the upload
   * queue. PowerSync captures every write through the synced-table views
   * (INSTEAD OF triggers feeding ps_crud), so reverting via
   * `UPDATE territories ...` would enqueue a PATCH {locked_by: null} that
   * this connector would later upload as a spurious unlock_territory RPC —
   * and, when the territory is held by another rep (the plausible
   * 'not_entitled' case), surface a second, misleading "only the lock holder
   * may release" conflict for an unlock the user never requested. The
   * installed SDK (@powersync/react-native 1.x / @powersync/common 1.57)
   * exposes no local-only write API for synced tables, so we update the
   * internal storage table directly: synced rows live as JSON in
   * `ps_data__<table>` (Table.internalName), and only the VIEW carries the
   * CRUD-capture triggers. Sync stays correct — the next downloaded version
   * of the row replaces `data` wholesale.
   */
  private async revertLocalLock(op: CrudEntry, database: AbstractPowerSyncDatabase): Promise<void> {
    await database.execute(
      "UPDATE ps_data__territories SET data = json_set(data, '$.locked_by', NULL, '$.locked_at', NULL) WHERE id = ?",
      [op.id],
    );
  }

  /**
   * T-02-04-02: a 'not_entitled'/'invalid_geometry' denial means the server
   * row was never touched (create_territory_boundary returns early), so
   * nothing replicates down to correct the client's optimistic local
   * boundary write — revert it explicitly, same rationale as
   * revertLocalLock/WR-04. Uses the internal ps_data__ storage table so the
   * revert is local-only and never re-enters the CRUD upload queue (WR-11).
   */
  private async revertLocalBoundary(op: CrudEntry, database: AbstractPowerSyncDatabase): Promise<void> {
    await database.execute(
      "UPDATE ps_data__territories SET data = json_set(data, '$.boundary', NULL) WHERE id = ?",
      [op.id],
    );
  }

  private async applyTerritoryBoundaryOperation(
    op: CrudEntry,
    database: AbstractPowerSyncDatabase,
    boundary: unknown,
  ): Promise<void> {
    // PowerSync mirrors jsonb as text client-side (schema.ts) — the RPC
    // expects a jsonb argument, so parse back before sending.
    const parsedBoundary = typeof boundary === 'string' ? JSON.parse(boundary) : boundary;
    const { data, error } = await this.supabase.rpc('create_territory_boundary', {
      p_territory_id: op.id,
      p_boundary: parsedBoundary,
    });
    if (error) {
      throw new Error(
        `create_territory_boundary failed for territories.id=${op.id}: ${error.message}`,
      );
    }
    if (data === 'created') {
      return;
    }
    // 'invalid_geometry' | 'not_entitled' (or an unexpected verdict): final,
    // server-authoritative denial — surface it, never blind-retry (T-02-04-02).
    const reason =
      data === 'invalid_geometry'
        ? 'create_territory_boundary denied: boundary geometry is invalid'
        : 'create_territory_boundary denied: not entitled to set this territory boundary';
    this.onConflict?.({
      table: 'territories',
      entryId: op.id,
      op: op.op,
      reason,
    });
    await this.revertLocalBoundary(op, database);
  }

  private async applyTerritoryOperation(
    op: CrudEntry,
    database: AbstractPowerSyncDatabase,
  ): Promise<void> {
    if (op.op !== UpdateType.PATCH) {
      throw new Error(
        `territories are server-managed: ${op.op} on territories.id=${op.id} is not permitted from the client`,
      );
    }

    const opData = op.opData ?? {};
    const touchedColumns = Object.keys(opData);

    // Boundary writes are a distinct server-authoritative path (RPC, not the
    // lock_territory() flow) — route before the lock-column whitelist check.
    if (touchedColumns.includes('boundary')) {
      if (touchedColumns.some((columnName) => columnName !== 'boundary')) {
        throw new Error(
          `territories boundary writes accept only the boundary column; rejected columns: ${touchedColumns.join(', ')}`,
        );
      }
      await this.applyTerritoryBoundaryOperation(op, database, opData.boundary);
      return;
    }

    if (touchedColumns.some((columnName) => !TERRITORY_LOCK_COLUMNS.has(columnName))) {
      throw new Error(
        `territories accept only lock writes (locked_by/locked_at); rejected columns: ${touchedColumns.join(', ')}`,
      );
    }

    const lockedBy = opData.locked_by ?? null;
    if (lockedBy !== null) {
      // Lock request — server decides, never a blind write (T-01-18).
      // CR-01: the acting rep is ALWAYS the authenticated session user, never
      // the locally-written locked_by value (the server validates p_rep_id
      // against auth.uid() anyway — see 0007_lock_functions_require_auth_uid.sql).
      // A local row claiming a foreign rep id is a client-side anomaly the
      // server would deny as final; surface it as a consumed conflict instead
      // of wedging the upload queue on a permanently-denied op.
      const sessionUserId = await this.requireSessionUserId(op);
      if (lockedBy !== sessionUserId) {
        this.onConflict?.({
          table: 'territories',
          entryId: op.id,
          op: op.op,
          reason: 'lock_territory denied: locked_by must be the authenticated rep',
        });
        // The server row was never touched — revert the impossible local claim.
        await this.revertLocalLock(op, database);
        return;
      }
      const { data, error } = await this.supabase.rpc('lock_territory', {
        p_territory_id: op.id,
        p_rep_id: sessionUserId,
        p_client_ts: opData.locked_at ?? null,
      });
      if (error) {
        throw new Error(`lock_territory failed for territories.id=${op.id}: ${error.message}`);
      }
      // WR-04: discriminated server verdict (0011) — 'granted' | 'conflict' |
      // 'not_entitled'. Any denial is FINAL: surface it, consume the op.
      if (data === 'conflict') {
        // The winner's lock replicates down and corrects the local row.
        this.onConflict?.({
          table: 'territories',
          entryId: op.id,
          op: op.op,
          reason: 'lock_territory denied: territory is locked by another rep',
        });
      } else if (data !== 'granted') {
        // 'not_entitled' (or an unexpected verdict): the server row is
        // unchanged, so nothing replicates down — revert the local optimistic
        // lock explicitly (WR-04).
        this.onConflict?.({
          table: 'territories',
          entryId: op.id,
          op: op.op,
          reason: 'lock_territory denied: not entitled to lock this territory',
        });
        await this.revertLocalLock(op, database);
      }
      return;
    }

    // Unlock request — only the current holder may release (server-enforced).
    const sessionUserId = await this.requireSessionUserId(op);
    const { data, error } = await this.supabase.rpc('unlock_territory', {
      p_territory_id: op.id,
      p_rep_id: sessionUserId,
    });
    if (error) {
      throw new Error(`unlock_territory failed for territories.id=${op.id}: ${error.message}`);
    }
    if (data !== true) {
      this.onConflict?.({
        table: 'territories',
        entryId: op.id,
        op: op.op,
        reason: 'unlock_territory denied: only the lock holder may release the lock',
      });
    }
  }

  private async applySyncDemoOperation(op: CrudEntry): Promise<void> {
    // Documented LWW: sync_demo is the ONLY table where a blind upsert is
    // acceptable (throwaway Walking Skeleton entity, see 0004 table comment).
    if (op.op === UpdateType.DELETE) {
      // CR-03: the server categorically denies sync_demo DELETE (no DELETE
      // grant in 0005, no DELETE policy in 0003/0006) — uploading it would
      // 42501 forever and wedge the head of the upload queue for ALL tables
      // (the exact Defect 3 failure class 0006 fixed on another verb).
      // Client capability must match server grants: surface the denial as a
      // consumed conflict, exactly like a server-authoritative lock denial.
      this.onConflict?.({
        table: 'sync_demo',
        entryId: op.id,
        op: op.op,
        reason:
          'sync_demo deletes are not supported server-side (no DELETE grant/policy); op consumed',
      });
      return;
    }
    // Folded todo (powersync-insert-not-streamed.md): migrated OFF the
    // ON-CONFLICT upsert call — same plain-INSERT + real-UPDATE template as
    // applyHousesOperation. ANY INSERT..ON CONFLICT arm against a table
    // whose RLS evaluates a SECURITY DEFINER visibility function trips the
    // 42501 speculative-insertion trap (02-08), and sync_demo's policies are
    // exactly that shape (0006).
    if (op.op === UpdateType.PATCH) {
      const { error } = await this.supabase.from('sync_demo').update({ ...op.opData }).eq('id', op.id);
      if (error) {
        throw new Error(`sync_demo update failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    const { error } = await this.supabase.from('sync_demo').insert({ ...op.opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`sync_demo insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private async applyHousesOperation(op: CrudEntry): Promise<void> {
    // Documented LWW (0014_houses_and_blacklist.sql table comment) — same
    // template as applySyncDemoOperation. territory_id is server-computed by
    // assign_house_territory() (0017); a client-supplied value is simply
    // overwritten server-side, never trusted (RESEARCH.md Anti-Patterns).
    //
    // PATCH must be a real UPDATE, never an upsert: PowerSync PATCH opData
    // carries only the CHANGED columns, and Postgres evaluates the INSERT
    // policy's WITH CHECK against the proposed row of an
    // INSERT..ON CONFLICT — a partial row without team_id fails
    // houses_insert_by_team (42501) and wedges the whole upload queue in
    // retry-forever (found live: 02-08 device pass, status-PATCH on a seed
    // house blocked every op behind it for two days).
    if (op.op === UpdateType.PATCH) {
      const { error } = await this.supabase.from('houses').update({ ...op.opData }).eq('id', op.id);
      if (error) {
        throw new Error(`houses update failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    // DELETE removes a party (0105). It sits ABOVE the PUT arm and that
    // position is the whole point: without an explicit arm a DELETE op falls
    // through to PUT and RE-INSERTS the row it was meant to remove, which is
    // exactly why lowering the doorbell count used to do nothing at all.
    //
    // A 23503 here is not a failure to retry: contracts.house_id is
    // ON DELETE RESTRICT (0101), so a party that carries a signed contract
    // cannot be deleted, ever. Retrying forever would wedge the queue behind a
    // row that will never become deletable. The op is consumed and the local
    // row stays — which is the truthful outcome, because the server row does
    // too. Same reasoning as the 23505 arm on contracts.
    if (op.op === UpdateType.DELETE) {
      const { error } = await this.supabase.from('houses').delete().eq('id', op.id);
      if (error && !/23503|foreign key/i.test(error.message)) {
        throw new Error(`houses delete failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    // PUT is a plain INSERT, deliberately NOT an upsert: ANY
    // INSERT..ON CONFLICT variant is rejected by RLS here — Postgres
    // evaluates the security-definer visibility function in the policy's
    // WITH CHECK differently during speculative insertion, so the same row
    // that plain-INSERTs fine 42501s as an upsert (reproduced directly in
    // psql, 02-08 device pass). Redelivery idempotency (PowerSync
    // at-least-once uploads) is handled by treating a duplicate-key
    // rejection as already-uploaded success instead.
    const { error } = await this.supabase.from('houses').insert({ ...op.opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`houses insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private async applyBlacklistOperation(op: CrudEntry): Promise<void> {
    // INSERT-ONLY (GDPR data-minimization, 0014_houses_and_blacklist.sql
    // table comment — no update/delete RLS policy server-side) — same
    // template as applyContractOperation.
    if (op.op !== UpdateType.PUT) {
      throw new Error(
        `blacklist_entries are insert-only: ${op.op} on blacklist_entries.id=${op.id} is not permitted post-persist`,
      );
    }
    const { error } = await this.supabase.from('blacklist_entries').insert({ ...op.opData, id: op.id });
    if (error) {
      throw new Error(`blacklist_entries insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private async applyLeadOperation(op: CrudEntry): Promise<void> {
    // INSERT-ONLY, consent-gated (D-17, 0033_leads.sql — no update/delete RLS
    // policy server-side) — same append-only-reject template as
    // applyBlacklistOperation/applyScanTelemetryOperation. A lead is created
    // once with a confirmed consent block and NEVER upserted/mutated.
    if (op.op !== UpdateType.PUT) {
      throw new Error(
        `leads are insert-only: ${op.op} on leads.id=${op.id} is not permitted post-persist`,
      );
    }
    // Plain INSERT, deliberately NOT an upsert: the standing ON CONFLICT ban
    // (ARCHITECTURE.md Iron Rule 3) plus the same 42501 speculative-insertion
    // trap houses/flow_drafts hit against a SECURITY DEFINER-visibility-gated
    // RLS table. `consent_given` is a Postgres boolean mirrored client-side as
    // text (schema.ts) — coerce it back to a real boolean so the
    // leads_insert_by_rep WITH CHECK (`consent_given = true`, T-05-43) is not
    // evaluated against a string. Redelivery idempotency (PowerSync
    // at-least-once uploads) treats a duplicate-key rejection as
    // already-uploaded success.
    const opData = this.normalizeLeadOfferSnapshot(this.normalizeLeadConsent(op.opData ?? {}));
    const { error } = await this.supabase.from('leads').insert({ ...opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`leads insert failed for id=${op.id}: ${error.message}`);
    }
  }

  /**
   * 0084 (§5.2): `offer_snapshot` is the leads row's jsonb column, mirrored
   * client-side as text (schema.ts) — the SAME double-encoding trap
   * normalizeContractJsonb fixes for contracts.audit_package/answers.
   * Forwarded verbatim it would land in Postgres as a scalar JSON string, and
   * the offer PDF would then render an empty snapshot with no error anywhere.
   * A malformed value is dropped to null rather than failing the upload: the
   * offer mail matters more than its price block.
   */
  private normalizeLeadOfferSnapshot(opData: Record<string, unknown>): Record<string, unknown> {
    if (typeof opData.offer_snapshot !== 'string') return opData;
    try {
      return { ...opData, offer_snapshot: JSON.parse(opData.offer_snapshot) };
    } catch {
      return { ...opData, offer_snapshot: null };
    }
  }

  private normalizeLeadConsent(opData: Record<string, unknown>): Record<string, unknown> {
    if (!('consent_given' in opData)) {
      return opData;
    }
    const raw = opData.consent_given;
    const asBool = raw === true || raw === 1 || raw === '1' || raw === 'true';
    return { ...opData, consent_given: asBool };
  }

  private async applyProductDefinitionOperation(op: CrudEntry): Promise<void> {
    // product_definitions is written server-side only (publish CLI, 03-04);
    // any client write attempt is a client-side anomaly, not a legitimate
    // conflict to surface via onConflict — reject loudly (RESEARCH.md
    // Pattern 4). Immutability-once-published is ALSO DB-enforced (0025
    // trigger); this is the client-side belt to that server-side suspenders.
    throw new Error(
      `product_definitions are written server-side only (publish CLI), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyDiscountTermsOperation(op: CrudEntry): Promise<void> {
    // SAME append-only-reject template as applyProductDefinitionOperation —
    // discount_terms is server-written only (publish CLI), immutability by
    // omission (no update/delete RLS policy, 0027).
    throw new Error(
      `discount_terms are written server-side only (publish CLI), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyAppointmentOperation(op: CrudEntry): Promise<void> {
    // LWW-ACCEPTABLE, device-local single-writer (0058_appointments.sql — the
    // owning rep schedules/reschedules their own follow-ups) — same plain-INSERT
    // + real-UPDATE template as houses/flow_drafts, NEVER an upsert call/
    // ON CONFLICT (02-08 42501 speculative-insertion trap against the
    // SECURITY DEFINER visible_teams() WITH CHECK). No jsonb columns → no
    // normalize step. `house_id` is a nullable uuid — null-guard an empty-string
    // placeholder so PostgREST does not 400 ("invalid input syntax for type
    // uuid") and wedge the ordered queue (same backstop as flow_drafts).
    const opData = nullifyEmptyUuidColumns(op.opData ?? {}, ['house_id']);
    if (op.op === UpdateType.PATCH) {
      const { error } = await this.supabase.from('appointments').update(opData).eq('id', op.id);
      if (error) {
        throw new Error(`appointments update failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    const { error } = await this.supabase.from('appointments').insert({ ...opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`appointments insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private async applyFlowDraftOperation(op: CrudEntry): Promise<void> {
    // Device-local, single-writer LWW (D-04/D-09) — same plain-INSERT +
    // real-UPDATE template as houses/sync_demo, NEVER an upsert call/
    // ON CONFLICT (02-08 42501 trap).
    //
    // 03-UAT.md Gap 1 root cause: `answers` is the ONLY jsonb column on
    // flow_drafts, mirrored client-side as text (schema.ts) — forwarding
    // opData.answers verbatim lands it in the jsonb column as a SCALAR
    // STRING (double-encoded) instead of an object. Mirrors the parse-before-
    // forward pattern already used by applyTerritoryBoundaryOperation above.
    // Parse ONLY `answers` — terms_id/terms_version/snapshot_* are not jsonb
    // and PostgREST coerces them fine as-is; blanket-parsing would break them.
    const opData = nullifyEmptyUuidColumns(this.normalizeFlowDraftAnswers(op.opData ?? {}), [
      'terms_id',
      'territory_id',
      'house_id',
      'product_definition_id',
    ]);
    if (op.op === UpdateType.PATCH) {
      const { error } = await this.supabase.from('flow_drafts').update(opData).eq('id', op.id);
      if (error) {
        throw new Error(`flow_drafts update failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    const { error } = await this.supabase.from('flow_drafts').insert({ ...opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`flow_drafts insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private normalizeFlowDraftAnswers(opData: Record<string, unknown>): Record<string, unknown> {
    if (!('answers' in opData) || typeof opData.answers !== 'string') {
      return opData;
    }
    return { ...opData, answers: JSON.parse(opData.answers) };
  }

  private async applyTeamOperation(op: CrudEntry): Promise<void> {
    // teams is written server-side only (rep-invite Edge Function /
    // handle_invited_user() trigger, ROLE-01/ROLE-02) — any client write
    // attempt is a client-side anomaly, not a legitimate conflict to surface
    // via onConflict — reject loudly, same template as
    // applyProductDefinitionOperation (T-07-03).
    throw new Error(
      `teams are written server-side only (provisioned via rep-invite/handle_invited_user), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyMembershipOperation(op: CrudEntry): Promise<void> {
    // SAME server-written-only-reject template as applyTeamOperation.
    throw new Error(
      `memberships are written server-side only (provisioned via rep-invite/handle_invited_user), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyOrgAdminOperation(op: CrudEntry): Promise<void> {
    // SAME server-written-only-reject template as applyTeamOperation.
    throw new Error(
      `org_admins are written server-side only (provisioned via rep-invite/handle_invited_user), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyTerritoryAssignmentReadOnly(op: CrudEntry): Promise<void> {
    // territory_assignments is written server-side only via the
    // assign_territory() RPC (Plan 04, called directly by the UI, never
    // through this connector's CRUD upload queue) — any client write attempt
    // is a client-side anomaly, not a legitimate conflict to surface via
    // onConflict — reject loudly, same template as applyTeamOperation.
    throw new Error(
      `territory_assignments are written server-side only via the assign_territory RPC, never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  /**
   * D-01/D-02 (Phase 12, 0072_app_users_profile_columns.sql): a rep may PATCH
   * a fixed whitelist of profile columns on their OWN row — provisioning
   * (INSERT) stays exclusively server-side via handle_invited_user() (0046),
   * so anything other than PATCH is rejected. Real UPDATE, NEVER an upsert —
   * app_users is RLS-checked (app_users_update_own, 0072), same standing
   * project-wide ON CONFLICT ban as every other table in this connector.
   */
  private async applyAppUserOperation(op: CrudEntry): Promise<void> {
    if (op.op !== UpdateType.PATCH) {
      throw new Error(
        `app_users only accepts own-profile PATCH: ${op.op} on id=${op.id} is not permitted`,
      );
    }
    const touchedColumns = Object.keys(op.opData ?? {});
    const rejectedColumns = touchedColumns.filter((c) => !APP_USER_EDITABLE_COLUMNS.has(c));
    if (rejectedColumns.length > 0) {
      throw new Error(
        `app_users accepts only profile-column writes; rejected columns: ${rejectedColumns.join(', ')}`,
      );
    }
    const sessionUserId = await this.requireSessionUserId(op);
    if (op.id !== sessionUserId) {
      throw new Error(
        `app_users PATCH id=${op.id} does not match the authenticated session (${sessionUserId})`,
      );
    }
    const { error } = await this.supabase.from('app_users').update({ ...op.opData }).eq('id', op.id);
    if (error) {
      throw new Error(`app_users update failed for id=${op.id}: ${error.message}`);
    }
  }

  private async applyDirectSignTemplateReadOnly(op: CrudEntry): Promise<void> {
    // SAME server-written-only-reject template as applyTeamOperation —
    // direct_sign_templates is written server-side only via the admin
    // dashboard upload/placement step (DSGN-01, T-10-10), never the client.
    throw new Error(
      `direct_sign_templates are written server-side only (admin dashboard upload/placement), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyTenantSettingPoliciesReadOnly(op: CrudEntry): Promise<void> {
    // SAME server-written-only-reject template as applyDirectSignTemplateReadOnly
    // — tenant_setting_policies is written server-side only via the admin
    // dashboard (SET-07/SET-09, RLS org-admin-only, D-14), never the client.
    throw new Error(
      `tenant_setting_policies are written server-side only (admin dashboard governance tab), never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyDeviceWipeOrderReadOnly(op: CrudEntry): Promise<void> {
    // SAME server/RPC-written-only-reject template as
    // applyTerritoryAssignmentReadOnly — device_wipe_orders (SEC-08, Phase 15,
    // D-01/D-02) is written server-side only via issue_device_wipe_order()/
    // force_purge_device_wipe_order()/report_wipe_progress() (0080), called
    // directly by the UI/wipe machinery, never through this connector's CRUD
    // upload queue.
    throw new Error(
      `device_wipe_orders are written server-side only via the issue_device_wipe_order/force_purge_device_wipe_order/report_wipe_progress RPCs, never from the client: rejected ${op.op} on id=${op.id}`,
    );
  }

  private async applyUserSettingsOperation(op: CrudEntry): Promise<void> {
    // LWW-ACCEPTABLE, device-local single-writer (0070_user_settings.sql,
    // SET-01) — SAME plain-INSERT + real-UPDATE template as
    // applyAppointmentOperation above, NEVER an upsert call / ON CONFLICT
    // against this RLS-checked table (the standing project-wide ban — Postgres
    // evaluates the INSERT policy's WITH CHECK for ANY upsert arm, 02-08
    // 42501 speculative-insertion trap). One deviation from every other table
    // in this connector: user_settings.id IS the rep's own identity (id =
    // app_users.id = auth.uid()), not a freshly generated uuid — the local row
    // creation that sets op.id this way happens in the settings repo layer
    // (a later plan), not here; this method just forwards op.id verbatim,
    // exactly like applyAppointmentOperation forwards its own op.id.
    //
    // auto_lock_timeout_minutes (Phase 13/D-01/SET-08) rides this same
    // plain PATCH/INSERT forwarding — no per-column whitelist exists here to
    // extend. A rejection surfaced by 0076's ceiling trigger (errcode 42501)
    // is a real Postgres error from the `.update()`/`.insert()` call below
    // and is thrown, NOT swallowed — 13-04 surfaces it to the rep via
    // `settings.ceilingRejected`.
    if (op.op === UpdateType.PATCH) {
      const { error } = await this.supabase
        .from('user_settings')
        .update({ ...op.opData })
        .eq('id', op.id);
      if (error) {
        throw new Error(`user_settings update failed for id=${op.id}: ${error.message}`);
      }
      return;
    }
    const { error } = await this.supabase.from('user_settings').insert({ ...op.opData, id: op.id });
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`user_settings insert failed for id=${op.id}: ${error.message}`);
    }
  }

  private async requireSessionUserId(op: CrudEntry): Promise<string> {
    const { data } = await this.supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      throw new Error(`cannot apply ${op.op} on ${op.table}.id=${op.id}: no authenticated session`);
    }
    return userId;
  }
}

/**
 * PowerSync mirrors every column as text, so nullable uuid columns arrive
 * here as '' when client code ever wrote an empty-string placeholder.
 * PostgREST rejects '' for uuid ("invalid input syntax for type uuid") with
 * a 400, which poisons the ordered CRUD queue into an infinite retry (found
 * on the 04-10 device pass via flow_drafts.terms_id). Repos null-guard at
 * insert time; this is the upload-boundary backstop so an already-queued ''
 * still uploads instead of wedging the queue forever.
 */
export function nullifyEmptyUuidColumns(
  opData: Record<string, unknown>,
  uuidColumns: string[],
): Record<string, unknown> {
  let normalized = opData;
  for (const column of uuidColumns) {
    if (normalized[column] === '') {
      normalized = { ...normalized, [column]: null };
    }
  }
  return normalized;
}
