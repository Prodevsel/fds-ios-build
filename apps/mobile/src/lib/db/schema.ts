import { AttachmentTable, Schema, Table, column } from '@powersync/common';

/**
 * PowerSync AppSchema — client-side mirror of the Postgres tables created in
 * supabase/migrations/0001_tenant_hierarchy.sql. Postgres `uuid` and
 * `timestamptz` columns map to `text` in PowerSync's SQLite type model; `id`
 * is implicit (every PowerSync table has a `text` primary key `id`).
 *
 * Conflict intents (enforced server-side in 0004_conflict_functions.sql and
 * client-side in connector.ts, Iron Rule 3):
 * - contracts:        APPEND-ONLY (legally signed contracts are immutable)
 * - territories:      SERVER-AUTHORITATIVE (locks only via lock_territory();
 *                      boundary writes only via create_territory_boundary())
 * - sync_demo:        LWW-SAFE (documented throwaway Walking Skeleton entity)
 * - houses:           LWW-ACCEPTABLE (single-rep-owned status field, see
 *                      0014_houses_and_blacklist.sql table comment)
 * - blacklist_entries: INSERT-ONLY (GDPR data-minimization, immutable once
 *                      created — no update/delete RLS policy server-side)
 * - product_definitions: SERVER-WRITTEN ONLY (publish CLI; any client write
 *                      is rejected loudly, connector.ts)
 * - discount_terms:   SERVER-WRITTEN ONLY (same as product_definitions;
 *                      immutability by omission, 0027)
 * - flow_drafts:      LWW-ACCEPTABLE, device-local single-writer (plain
 *                      INSERT + real UPDATE, never ON CONFLICT, 02-08 ban)
 * - scan_telemetry:   INSERT-ONLY (CHKT-04, anonymous per-scan-session
 *                      events; no update/delete RLS policy server-side,
 *                      0031_scan_telemetry.sql)
 * - leads:            INSERT-ONLY, consent-gated (D-17, 0033_leads.sql) — a
 *                      lead is created once with a confirmed consent block and
 *                      never upserted/mutated (no update/delete RLS policy
 *                      server-side; plain INSERT only, the standing ON CONFLICT
 *                      ban). Company-scoped: the only door-outcome that reaches
 *                      a client company (partner API + lead.created webhook).
 * - teams:            READ-ONLY, SERVER-WRITTEN ONLY (ROLE-01/ROLE-02, Phase 7)
 *                      — provisioned via the Phase 5 rep-invite Edge Function /
 *                      handle_invited_user() trigger, never a client writer at
 *                      all (not even a publish-CLI path like product_definitions/
 *                      discount_terms). Any client write is rejected loudly by
 *                      the connector (connector.ts).
 * - memberships:       READ-ONLY, SERVER-WRITTEN ONLY — same posture as teams.
 * - org_admins:        READ-ONLY, SERVER-WRITTEN ONLY — same posture as teams.
 * - territory_assignments: READ-ONLY, SERVER/RPC-WRITTEN ONLY (TASGN-01/02,
 *                      Phase 8, D-04 REVISED Option B) — a SEPARATE table
 *                      from territories so its row-filtered sync stream can
 *                      restrict visibility to the assignee + team lead/org-
 *                      admin only (not the whole team). Writes flow
 *                      exclusively through the assign_territory() RPC
 *                      (Plan 04), never the CRUD upload queue; any client
 *                      write is rejected loudly by the connector.
 * - app_users:         OWN-ROW PATCH OF A FIXED PROFILE-COLUMN WHITELIST
 *                      (D-01/D-02, Phase 12, 0072_app_users_profile_columns.sql)
 *                      — a rep may PATCH full_name/avatar_url on their own
 *                      row (contact_phone/contact_email are also
 *                      client-writable but deliberately NOT mirrored here,
 *                      see the appUsers Table comment below, T-12-13-03).
 *                      Provisioning (INSERT) stays server-side via the
 *                      rep-invite flow / handle_invited_user() (0046); any
 *                      other client write is rejected loudly by the
 *                      connector (connector.ts).
 * - direct_sign_templates: READ-ONLY, SERVER-WRITTEN ONLY (DSGN-01, Phase 10)
 *                      — company-uploaded, immutable-once-published PDF
 *                      templates (0066_direct_sign_templates.sql); the admin
 *                      dashboard upload/placement step is the only writer.
 *                      Any client write is rejected loudly by the connector,
 *                      same posture as app_users/teams.
 * - user_settings:    LWW-ACCEPTABLE, device-local single-writer (SET-01,
 *                      Phase 12) — same posture as flow_drafts/appointments
 *                      (plain INSERT + real UPDATE, never an upsert;
 *                      0070_user_settings.sql). One row per rep, id =
 *                      app_users.id = auth.uid().
 */

// Mirrors 0001_tenant_hierarchy.sql (base columns) extended by
// 0029_contracts_extend.sql (frozen legal snapshot + audit package, D-10) and
// 0049_contracts_commission_freeze.sql (the four frozen-commission columns
// below, WALT-02). audit_package and answers are jsonb mirrored as text (like
// flowDrafts.answers below) — JSON.parse'd/stringified by contractsRepo.
//
// The four commission columns are an ADDITIVE change to an already-synced
// table: on next connect PowerSync re-syncs the contracts table so the new
// columns backfill for existing local rows (no destructive local re-download
// expected — RESEARCH Runtime State Inventory; verified on the device pass,
// Plan 05). Postgres numeric/boolean map to column.text: commission_rate_
// snapshot/commission_base_snapshot are numeric→text (parseFloat in the wallet
// mapper), is_test is boolean→text (same as flow_drafts.is_test — arrives as
// '0'/'1' or 'false'/'true' depending on the serializer, so the wallet's
// tester filter matches both truthy forms). The confidential admin-only
// per-company rate list is deliberately NOT mirrored on-device (D-02a) — only
// the frozen per-deal snapshot rides the contracts sync stream.
const contracts = new Table({
  company_id: column.text,
  rep_id: column.text,
  team_id: column.text,
  status: column.text,
  product_definition_id: column.text,
  product_version: column.text,
  terms_id: column.text,
  terms_version: column.text,
  answers: column.text,
  snapshot_door_price: column.text,
  snapshot_comparison_price: column.text,
  snapshot_discount_amount: column.text,
  snapshot_terms_text: column.text,
  audit_package: column.text,
  package_hash_sha256: column.text,
  deal_reference: column.text,
  signature_attachment_id: column.text,
  signed_at: column.text,
  created_at: column.text,
  // 0049 frozen-commission snapshot (D-02/D-07/D-08) — read by the wallet.
  commission_rate_snapshot: column.text,
  commission_rate_type: column.text,
  commission_base_snapshot: column.text,
  // 0049 D-06 tester flag (boolean→text) — the wallet excludes is_test deals.
  is_test: column.text,
  // 0069_contracts_direct_sign_template_id.sql (DSGN-03, Phase 10): set only
  // for a direct-sign completion (contractsRepo.insertContract's
  // directSignTemplateId input) — null for every flow-form contract,
  // unchanged behavior. Additive column, backfills on next sync like the
  // 0049 commission columns above.
  direct_sign_template_id: column.text,
  // 0084 (§5.2): the lead whose offer code was redeemed to open this
  // consultation, or null. Redemption is recorded ONLY here — `leads` stays
  // insert-only — so "has this offer been used?" is a join against this column.
  redeemed_lead_id: column.text,
  // 0055:38 — "set by the client at INSERT", and the client never set it, so
  // every contract closed live in the app carried a null customer_name and
  // /abschluesse showed a dash. The column did not exist LOCALLY either, so
  // the INSERT would have failed outright. Additive column on an
  // already-synced table: it backfills on next connect, exactly like the 0049
  // commission columns and direct_sign_template_id above. `contracts` is
  // append-only (0004 triggers) — there is no later UPDATE that could repair
  // a row, so the value has to ride along in the INSERT itself.
  customer_name: column.text,
  // 0101: the door this contract was signed at. Text, not uuid — PowerSync has
  // no uuid type and every other id in this schema is stored the same way.
  // Nullable end to end: a contract signed outside the house flow has none.
  house_id: column.text,
});

// Mirrors supabase/migrations/0034_contract_status_events.sql. Append-only
// SSOT of contract lifecycle events ('signed'|'cancelled'); already synced to
// devices via powersync/sync-streams.yaml. The live wallet LEFT JOINs the
// 'cancelled' rows to surface each deal's reversal (D-01/D-09). occurred_at /
// created_at are timestamptz→text; contract_id / company_id / recorded_by are
// uuid→text. Read-only on-device (server-authoritative append-only stream).
const contractStatusEvents = new Table({
  contract_id: column.text,
  company_id: column.text,
  event_type: column.text,
  occurred_at: column.text,
  recorded_by: column.text,
  reason: column.text,
  created_at: column.text,
});

const territories = new Table({
  company_id: column.text,
  sales_org_id: column.text,
  team_id: column.text,
  name: column.text,
  locked_by: column.text,
  locked_at: column.text,
  // GeoJSON Polygon/MultiPolygon, mirrored as plain text (PowerSync/PostgREST
  // serializes jsonb as text — RESEARCH.md Pitfall 2; never a native geometry
  // column). Written only via the create_territory_boundary() RPC.
  boundary: column.text,
  created_at: column.text,
});

const syncDemo = new Table({
  company_id: column.text,
  note: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0014_houses_and_blacklist.sql. territory_id is
// server-computed by the assign_house_territory() trigger (0017) — never
// client-writable, but still replicated down so the map can render it.
const houses = new Table({
  team_id: column.text,
  territory_id: column.text,
  lat: column.text,
  lon: column.text,
  status: column.text,
  follow_up_at: column.text,
  // 0060_houses_note.sql: optional rep-authored memo (map status-sheet Notiz),
  // LWW-synced with the row. Additive nullable column; backfills on next sync.
  note: column.text,
  // 0083_houses_address.sql: reverse-geocoded street address for the pin,
  // resolved on-device when online and LWW-synced so the whole team inherits
  // the lookup. NULL = not resolved yet, never "no address".
  address: column.text,
  // 0088_houses_units.sql: a party (Partei) of a multi-party building is a
  // houses row whose parent_house_id points at the building; NULL = this row
  // IS a building. Additive nullable columns; backfill on next sync.
  parent_house_id: column.text,
  // 0088: POSITIONAL label only ("3. OG links"), never a name from the
  // Klingelschild — personal data must not enter this synced column.
  unit_label: column.text,
  // 0088: doorbell-panel count, only meaningful on a building row. Postgres
  // int, carried as column.text like every other number here (see the note at
  // the top of this file: numeric/boolean map to column.text).
  unit_count: column.text,
  created_by: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0014_houses_and_blacklist.sql. Deliberately no
// name/email/phone/free-text column (GDPR data minimization is a schema
// guarantee, not a UI convention).
const blacklistEntries = new Table({
  team_id: column.text,
  house_id: column.text,
  lat: column.text,
  lon: column.text,
  reason: column.text,
  created_by: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0021_product_definitions.sql, extended by
// 0068_product_definitions_contract_mode.sql (DSGN-01, Phase 10). Versioned,
// immutable-once-published product content (FORM-01/FORM-03) — server-written
// only via the publish CLI; `blocks` is jsonb mirrored as text (like
// territories.boundary), JSON.parse'd by the repos (03-05).
//
// contract_mode / direct_sign_template_id (0068) are ADDITIVE columns: the
// powersync/sync-streams.yaml product_definitions stream is `SELECT *`, so
// Postgres already replicates every column, but PowerSync only MATERIALIZES
// columns explicitly declared on the client Table below (root cause of the
// Phase 10 cross-plan gap: 10-01/10-04 added these columns server-side,
// 10-05 added a SEPARATE direct_sign_templates mirror, but nobody extended
// THIS pre-existing product_definitions mirror — it fell between the two
// plans' declared file scopes). Without this, contract_mode never reaches
// the device even though the sync stream already carries it, and the app
// has no way to know a product should route into the direct-sign flow
// (DirectSignFlowScreen, 10-08/10-09) rather than the flow-form wizard.
const productDefinitions = new Table({
  company_id: column.text,
  slug: column.text,
  version: column.text,
  status: column.text,
  blocks: column.text,
  created_at: column.text,
  // 0068: 'flow_form' (default, existing form-engine path) or 'direct_pdf'.
  contract_mode: column.text,
  // 0068: set only when contract_mode='direct_pdf' — FK into
  // direct_sign_templates (already mirrored client-side, 10-05).
  direct_sign_template_id: column.text,
  // 0090's `attachments` is DELIBERATELY NOT mirrored: appending the partner's
  // static pages happens server-side in the dispatcher, and the device has no
  // read of the value at all. Omitting it is a decision, not an oversight —
  // mirroring it would sync bytes to every device that nothing ever reads.
});

// Mirrors supabase/migrations/0022_discount_terms.sql. Versioned per
// company/product, markdown|standalone variants (D-17/D-18) — same
// server-written-only posture as product_definitions.
const discountTerms = new Table({
  company_id: column.text,
  product_slug: column.text,
  version: column.text,
  status: column.text,
  type: column.text,
  door_price: column.text,
  comparison_price: column.text,
  // 0090 (H02/D-1): the one-time / term / disclosure positions. All text, like
  // door_price/comparison_price above — PowerSync mirrors every Postgres type
  // as text and the repo does the Number() narrowing on read.
  setup_fee: column.text,
  setup_fee_comparison: column.text,
  minimum_term_months: column.text,
  price_note: column.text,
  terms_text: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0023_flow_drafts.sql. Device-local,
// single-writer draft (D-04 auto-save, D-09 version pinning); `answers` is
// jsonb mirrored as text, JSON.parse'd client-side (like blocks above).
const flowDrafts = new Table({
  created_by: column.text,
  house_id: column.text,
  product_definition_id: column.text,
  product_version: column.text,
  terms_id: column.text,
  terms_version: column.text,
  territory_id: column.text,
  status: column.text,
  answers: column.text,
  is_test: column.text,
  snapshot_door_price: column.text,
  snapshot_comparison_price: column.text,
  snapshot_discount_amount: column.text,
  snapshot_terms_text: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Mirrors 0031_scan_telemetry.sql. Anonymous per-scan-session telemetry
// (CHKT-04) — insert-only, no customer/contract/draft FK, no GPS column
// (D-13/D-14/D-15).
const scanTelemetry = new Table({
  created_by: column.text,
  team_id: column.text,
  scan_type: column.text,
  outcome: column.text,
  duration_ms: column.text,
  device_model: column.text,
  app_version: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0033_leads.sql. Company-scoped, INSERT-ONLY,
// consent-gated door outcome (D-17): the rep ends a consultation as
// "interested, no signature" WITH a confirmed consent block. `consent_given`
// is a Postgres boolean mirrored as text (like flow_drafts.is_test);
// `terms_version` is an int mirrored as text. `territory_id` is an attribution
// hint (deliberately NOT an FK server-side — a territory may be device-local
// when the lead is captured offline).
const leads = new Table({
  company_id: column.text,
  rep_id: column.text,
  team_id: column.text,
  contact_name: column.text,
  contact_phone: column.text,
  contact_email: column.text,
  product_interest: column.text,
  consent_given: column.text,
  terms_version: column.text,
  territory_id: column.text,
  created_at: column.text,
  // 0084 (§5.2): the written offer left behind when a consultation ends
  // without a signature. Generated on the device so the rep can read the code
  // out at the door, offline; `offer_snapshot` is the frozen jsonb copy of the
  // terms actually discussed (mirrored as text like the other jsonb columns).
  offer_code: column.text,
  offer_expires_at: column.text,
  offer_snapshot: column.text,
});

// Mirrors supabase/migrations/0058_appointments.sql. Rep-scoped follow-up
// calendar backing the Termine tab (design screen 12): the address/floor/note
// the GDPR-minimal houses table (0014) deliberately omits. Own-rows-only sync
// (rep_id = auth.user_id()); LWW-ACCEPTABLE device-local single-writer like
// flow_drafts. scheduled_at/created_at/updated_at are timestamptz→text;
// customer_age is int→text (Number()-parsed in the repo before any comparison).
const appointments = new Table({
  rep_id: column.text,
  team_id: column.text,
  house_id: column.text,
  scheduled_at: column.text,
  address: column.text,
  floor_label: column.text,
  note: column.text,
  kind: column.text,
  customer_age: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Mirrors supabase/migrations/0001_tenant_hierarchy.sql `teams`. READ-ONLY,
// SERVER-WRITTEN ONLY (see the conflict-intent doc comment above) — the role
// hook (07-03) reads this locally; the connector rejects any client write.
const teams = new Table({
  company_id: column.text,
  sales_org_id: column.text,
  name: column.text,
  lead_id: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0001_tenant_hierarchy.sql `memberships`.
// READ-ONLY, SERVER-WRITTEN ONLY — same posture as teams.
const memberships = new Table({
  user_id: column.text,
  team_id: column.text,
  role_id: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0001_tenant_hierarchy.sql `org_admins`.
// READ-ONLY, SERVER-WRITTEN ONLY — same posture as teams.
const orgAdmins = new Table({
  user_id: column.text,
  sales_org_id: column.text,
  created_at: column.text,
});

// Mirrors supabase/migrations/0061_territory_assignments.sql. READ-ONLY,
// SERVER/RPC-WRITTEN ONLY (see the conflict-intent doc comment above) —
// deliberately a SEPARATE table from territories (D-04 REVISED, Option B):
// do NOT add assigned_rep_id to the territories Table above, it is not a
// territories column anymore. Writes go through the assign_territory() RPC
// directly (Plan 04), never the CRUD upload queue.
const territoryAssignments = new Table({
  territory_id: column.text,
  assigned_rep_id: column.text,
  team_id: column.text,
  assigned_by: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// Mirrors supabase/migrations/0001_tenant_hierarchy.sql `app_users`, extended
// by 0072_app_users_profile_columns.sql (D-01/D-02, Phase 12): full_name and
// avatar_url ride the sync stream (powersync/sync-streams.yaml `app_users`
// projection: id, full_name, avatar_url) and are own-row PATCH-able from the
// client via connector.ts's APP_USER_EDITABLE_COLUMNS whitelist.
// contact_phone/contact_email are ALSO client-writable (same whitelist) but
// deliberately NOT declared here and NOT in the stream projection
// (T-12-13-03) — more sensitive than a name/avatar, no teammate need, so they
// stay server/Edge-readable only; declaring them here would create a
// permanently empty column since PowerSync materializes only what the stream
// projects.
const appUsers = new Table({
  full_name: column.text,
  avatar_url: column.text,
});

// Mirrors supabase/migrations/0066_direct_sign_templates.sql, narrow
// projection (powersync/sync-streams.yaml `direct_sign_templates` stream):
// id, company_id, storage_path, sha256, signature_page, signature_x_frac,
// signature_y_frac, status. READ-ONLY, SERVER-WRITTEN ONLY (see the
// conflict-intent doc comment above) — the admin dashboard upload/placement
// step is the only writer; the connector rejects any client write. Postgres
// numeric/int columns (signature_page, signature_x_frac, signature_y_frac)
// map to column.text like every other synced table (schema.ts convention) —
// parsed by the caller (prefetch/placement code), not here.
const directSignTemplates = new Table({
  company_id: column.text,
  storage_path: column.text,
  sha256: column.text,
  signature_page: column.text,
  signature_x_frac: column.text,
  signature_y_frac: column.text,
  status: column.text,
  // 0085: the operator-placed variable anchors, jsonb mirrored as text like
  // every other jsonb column here — parsed in directSignTemplatesRepo.
  field_placements: column.text,
});

// Mirrors supabase/migrations/0070_user_settings.sql. One row per rep
// (id = app_users.id = auth.uid()) — own-row, PowerSync-synced, LWW-ACCEPTABLE
// device-local single-writer, SAME posture as flow_drafts/appointments. Unlike
// every other table here, the client-side INSERT must set id = the rep's own
// auth.uid() (NOT a freshly generated uuid) — deviation flagged explicitly,
// mirrors territories.locked_by identity-binding via requireSessionUserId.
// high_contrast is a Postgres boolean mirrored as text (like flow_drafts.is_test).
// auto_lock_timeout_minutes (Phase 13/D-01, 0075): a SELECT * sync stream
// does NOT materialize a new column on its own — the client Table must
// declare it explicitly, in the SAME plan as the migration (Phase 10's
// client-schema-mirror-drift incident, .planning/.continue-here.md). Postgres
// integer→text like every other numeric/boolean column in this file
// (contracts' commission_rate_snapshot precedent above) — nullable, parsed
// at the settingsRepo.ts mapper layer, never trusted unparsed. The app lock
// this column governs ships in Phase 15 — this phase only materializes and
// governs it.
const userSettings = new Table({
  language: column.text,
  theme: column.text,
  text_size: column.text,
  high_contrast: column.text,
  auto_lock_timeout_minutes: column.text,
  updated_at: column.text,
});

// Mirrors supabase/migrations/0074_tenant_setting_policies.sql (SET-07/D-10).
// READ-ONLY on the client — written server-side only via the admin dashboard
// (RLS org-admin-only, see applyTenantSettingPoliciesReadOnly in
// connector.ts), the same direct_sign_templates posture above, NOT the
// own-row userSettings posture. PowerSync materializes jsonb as text —
// policy_value is parsed by the caller (settingsPolicyRepo.ts), not here.
const tenantSettingPolicies = new Table({
  company_id: column.text,
  sales_org_id: column.text,
  setting_key: column.text,
  policy_kind: column.text,
  policy_value: column.text,
});

// Mirrors supabase/migrations/0079_device_wipe_orders.sql (SEC-08, D-01/D-02).
// READ-ONLY, SERVER/RPC-WRITTEN ONLY (see the conflict-intent doc comment in
// connector.ts) — same posture as territoryAssignments above: writes go
// exclusively through issue_device_wipe_order()/force_purge_device_wipe_order()/
// report_wipe_progress() (0080), never this connector's CRUD upload queue.
// pending_artifact_count is a Postgres integer, mirrored as column.text like
// every other numeric column in this file (auto_lock_timeout_minutes
// precedent above) — parsed by the caller, never trusted unparsed.
const deviceWipeOrders = new Table({
  device_owner_rep_id: column.text,
  team_id: column.text,
  device_id: column.text,
  status: column.text,
  pending_artifact_count: column.text,
  stall_reason: column.text,
  issued_by: column.text,
  issued_at: column.text,
  acknowledged_at: column.text,
  last_progress_at: column.text,
  completed_at: column.text,
  forced_by: column.text,
  forced_at: column.text,
  forced_discarded_count: column.text,
});

export const AppSchema = new Schema({
  contracts,
  contract_status_events: contractStatusEvents,
  appointments,
  territories,
  sync_demo: syncDemo,
  houses,
  blacklist_entries: blacklistEntries,
  product_definitions: productDefinitions,
  discount_terms: discountTerms,
  flow_drafts: flowDrafts,
  scan_telemetry: scanTelemetry,
  leads,
  teams,
  memberships,
  org_admins: orgAdmins,
  territory_assignments: territoryAssignments,
  app_users: appUsers,
  direct_sign_templates: directSignTemplates,
  user_settings: userSettings,
  tenant_setting_policies: tenantSettingPolicies,
  device_wipe_orders: deviceWipeOrders,
  // Local-only bookkeeping table for the attachment queue (SYNC-02): tracks
  // upload/download state of binaries. The binaries themselves NEVER pass
  // through the PowerSync replication stream — they go to Supabase Storage
  // via the separate attachment queue (attachments/queue.ts).
  attachments: new AttachmentTable(),
});

export type Database = (typeof AppSchema)['types'];
