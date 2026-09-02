import { describe, expect, it } from 'vitest';
import { AppSchema } from './schema';

/**
 * The PowerSync AppSchema must mirror the Postgres tables this phase created
 * (supabase/migrations/0001_tenant_hierarchy.sql): contracts, territories,
 * sync_demo — same column shapes (uuid/timestamptz map to `text` client-side,
 * per PowerSync's SQLite type model).
 */
describe('AppSchema (mirror of 0001_tenant_hierarchy.sql)', () => {
  const tables = AppSchema.toJSON().tables;
  const byName = new Map(tables.map((t) => [t.name, t]));

  function columnNames(table: string): string[] {
    const found = byName.get(table);
    expect(found, `table ${table} missing from AppSchema`).toBeDefined();
    return (found?.columns ?? []).map((c) => c.name);
  }

  it('declares contracts with the Postgres column shape (0001 + 0029_contracts_extend.sql + 0049_contracts_commission_freeze.sql + 0069_contracts_direct_sign_template_id.sql + 0084_offer_codes.sql + 0055 customer_name)', () => {
    expect(columnNames('contracts')).toEqual([
      'company_id',
      'rep_id',
      'team_id',
      'status',
      'product_definition_id',
      'product_version',
      'terms_id',
      'terms_version',
      'answers',
      'snapshot_door_price',
      'snapshot_comparison_price',
      'snapshot_discount_amount',
      'snapshot_terms_text',
      'audit_package',
      'package_hash_sha256',
      'deal_reference',
      'signature_attachment_id',
      'signed_at',
      'created_at',
      // 0049 frozen-commission snapshot (D-02/D-07/D-08) + the D-06 tester flag —
      // the four columns the live wallet reads off the synced contracts stream.
      'commission_rate_snapshot',
      'commission_rate_type',
      'commission_base_snapshot',
      'is_test',
      // 0069 (DSGN-03, Phase 10): set only for a direct-sign completion.
      'direct_sign_template_id',
      'redeemed_lead_id',
      // QUICK-GTI: 0055:38 declared customer_name "set by the client at
      // INSERT" and it was missing from the LOCAL mirror, so the client could
      // not have set it even if it tried.
      'customer_name',
      // 0101: the door this contract was signed at. The whole point of the
      // column is that it survives the upload — and the ONE way to lose it
      // silently is to mirror it here and forget the connector's column list,
      // so this mirror is the assertion that keeps the two in step.
      'house_id',
    ]);
  });

  it('declares territories with the Postgres column shape', () => {
    expect(columnNames('territories')).toEqual([
      'company_id',
      'sales_org_id',
      'team_id',
      'name',
      'locked_by',
      'locked_at',
      'boundary',
      'created_at',
    ]);
  });

  it('declares sync_demo with the Postgres column shape', () => {
    expect(columnNames('sync_demo')).toEqual(['company_id', 'note', 'created_at']);
  });

  it('declares houses with the Postgres column shape (0014_houses_and_blacklist.sql + 0060_houses_note.sql + 0083_houses_address.sql + 0088_houses_units.sql)', () => {
    expect(columnNames('houses')).toEqual([
      'team_id',
      'territory_id',
      'lat',
      'lon',
      'status',
      'follow_up_at',
      'note',
      // 0083: without this column client-side, the reverse-geocoded address
      // would never materialize locally and the pin could not name its house.
      'address',
      // 0088: a party (Partei) of a multi-party building is a houses row with
      // parent_house_id set. Without these three client-side, the building
      // rollup could not tell a door from a house.
      'parent_house_id',
      'unit_label',
      'unit_count',
      'created_by',
      'created_at',
    ]);
  });

  it('declares product_definitions with the Postgres column shape (0021_product_definitions.sql + 0068_product_definitions_contract_mode.sql) — proves contract_mode/direct_sign_template_id MATERIALIZE client-side', () => {
    // Orchestrator-added gap closure (Phase 10 cross-plan wiring): the
    // powersync/sync-streams.yaml product_definitions stream is `SELECT *`
    // and already replicates every server column, but PowerSync only
    // MATERIALIZES columns the client Table explicitly declares — without
    // these two, contract_mode never reached the device even though the
    // sync stream carried it, so the app had no way to route a product into
    // the direct-sign flow (DirectSignFlowScreen) by data.
    expect(columnNames('product_definitions')).toEqual([
      'company_id',
      'slug',
      'version',
      'status',
      'blocks',
      'created_at',
      'contract_mode',
      'direct_sign_template_id',
    ]);
  });

  it('declares blacklist_entries with the Postgres column shape (0014_houses_and_blacklist.sql)', () => {
    expect(columnNames('blacklist_entries')).toEqual([
      'team_id',
      'house_id',
      'lat',
      'lon',
      'reason',
      'created_by',
      'created_at',
    ]);
  });

  it('declares leads with the Postgres column shape (0033_leads.sql, D-17)', () => {
    expect(columnNames('leads')).toEqual([
      'company_id',
      'rep_id',
      'team_id',
      'contact_name',
      'contact_phone',
      'contact_email',
      'product_interest',
      'consent_given',
      'terms_version',
      'territory_id',
      'created_at',
      'offer_code',
      'offer_expires_at',
      'offer_snapshot',
    ]);
  });

  it('declares appointments with the Postgres column shape (0058_appointments.sql)', () => {
    expect(columnNames('appointments')).toEqual([
      'rep_id',
      'team_id',
      'house_id',
      'scheduled_at',
      'address',
      'floor_label',
      'note',
      'kind',
      'customer_age',
      'created_at',
      'updated_at',
    ]);
  });

  it('declares app_users with ONLY full_name and avatar_url (D-01/D-02, 0072_app_users_profile_columns.sql — contact_phone/contact_email are deliberately NOT mirrored, T-12-13-03)', () => {
    expect(columnNames('app_users')).toEqual(['full_name', 'avatar_url']);
  });

  it('declares user_settings with the Postgres column shape (0070_user_settings.sql, +auto_lock_timeout_minutes 0075/D-01)', () => {
    expect(columnNames('user_settings')).toEqual([
      'language',
      'theme',
      'text_size',
      'high_contrast',
      'auto_lock_timeout_minutes',
      'updated_at',
    ]);
  });

  it('declares the local-only attachments queue table (SYNC-02)', () => {
    const attachments = byName.get('attachments');
    expect(attachments).toBeDefined();
    expect(attachments?.local_only).toBe(true);
  });
});
