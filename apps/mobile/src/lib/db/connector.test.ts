import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { CrudEntry, UpdateType } from '@powersync/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseLike, SyncConflict } from './connector';
import { SupabaseConnector } from './connector';

/**
 * SYNC-04 / Iron Rule 3: per-entity conflict behavior, never blanket LWW.
 * - contracts:   append-only (PUT insert; PATCH/DELETE rejected)
 * - territories: server-authoritative via lock_territory()/unlock_territory()
 *                RPC; a false result surfaces a conflict, never silently drops
 * - sync_demo:   documented LWW upsert (the ONLY LWW table, see 0004 comment)
 * - anything else: rejected (ASVS V5 — never forward client-supplied table
 *                names, threat T-01-20)
 */

const REP_ID = '11111111-1111-1111-1111-111111111111';
const ROW_ID = '22222222-2222-2222-2222-222222222222';

interface MockSupabase {
  client: SupabaseLike;
  insert: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateEq: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
}

function makeSupabase(): MockSupabase {
  const insert = vi.fn(async () => ({ error: null }));
  const upsert = vi.fn(async () => ({ error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({
    insert,
    upsert,
    update,
  }));
  // lock_territory / create_territory_boundary return discriminated text
  // verdicts (WR-04, migrations 0011/0018); unlock_territory keeps its
  // boolean contract.
  const rpc = vi.fn(async (fn: string) => ({
    data: fn === 'lock_territory' ? 'granted' : fn === 'create_territory_boundary' ? 'created' : true,
    error: null,
  }));
  const getSession = vi.fn(async () => ({
    data: {
      session: {
        access_token: 'jwt-token',
        expires_at: 1_800_000_000,
        user: { id: REP_ID },
      },
    },
    error: null,
  }));
  return {
    client: { from, rpc, auth: { getSession } } as unknown as SupabaseLike,
    insert,
    upsert,
    update,
    updateEq,
    from,
    rpc,
    getSession,
  };
}

function makeDatabase(entries: CrudEntry[]) {
  const complete = vi.fn(async () => {});
  // WR-11: simulate PowerSync's CRUD capture. Every write THROUGH a synced-
  // table view (e.g. `territories`) is picked up by the view's INSTEAD OF
  // triggers and enqueued as an uploadable CRUD op; writes to the internal
  // `ps_data__*` / `ps_*` storage tables bypass the triggers (local-only).
  const capturedCrudSql: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    const target = /^\s*(?:update|insert\s+into|delete\s+from)\s+["'`[]?(\w+)/i.exec(sql)?.[1];
    if (target !== undefined && !target.startsWith('ps_')) {
      capturedCrudSql.push(sql);
    }
    return {};
  });
  const database = {
    getNextCrudTransaction: vi
      .fn()
      .mockResolvedValueOnce(entries.length > 0 ? { crud: entries, complete } : null)
      .mockResolvedValue(null),
    execute,
  } as unknown as AbstractPowerSyncDatabase;
  return { database, complete, execute, capturedCrudSql };
}

function entry(
  table: string,
  op: UpdateType,
  opData?: Record<string, unknown>,
  id: string = ROW_ID,
): CrudEntry {
  return new CrudEntry(1, op, table, id, 1, opData as Record<string, string> | undefined);
}

describe('SupabaseConnector', () => {
  let supabase: MockSupabase;
  let conflicts: SyncConflict[];
  let connector: SupabaseConnector;

  beforeEach(() => {
    supabase = makeSupabase();
    conflicts = [];
    connector = new SupabaseConnector({
      supabase: supabase.client,
      powersyncUrl: 'http://localhost:8080',
      onConflict: (c) => conflicts.push(c),
    });
  });

  describe('fetchCredentials', () => {
    it('returns the PowerSync endpoint with the Supabase JWT', async () => {
      const credentials = await connector.fetchCredentials();

      expect(credentials).toMatchObject({
        endpoint: 'http://localhost:8080',
        token: 'jwt-token',
      });
    });

    it('returns null when no session exists', async () => {
      supabase.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      expect(await connector.fetchCredentials()).toBeNull();
    });
  });

  describe('uploadData — contracts (append-only)', () => {
    it('PUT inserts the row (append)', async () => {
      const { database, complete } = makeDatabase([
        entry('contracts', UpdateType.PUT, {
          company_id: 'c1',
          rep_id: REP_ID,
          team_id: 't1',
          status: 'active',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('contracts');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, rep_id: REP_ID, status: 'active' }),
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PATCH is rejected (throws) and the transaction is NOT completed', async () => {
      const { database, complete } = makeDatabase([
        entry('contracts', UpdateType.PATCH, { status: 'cancelled' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/append-only/i);
      expect(supabase.insert).not.toHaveBeenCalled();
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected (throws)', async () => {
      const { database } = makeDatabase([entry('contracts', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/append-only/i);
    });
  });

  describe('uploadData — territories (server-authoritative locks)', () => {
    it('lock write calls the lock_territory RPC, never a blind write', async () => {
      const { database, complete } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: REP_ID,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('lock_territory', {
        p_territory_id: ROW_ID,
        p_rep_id: REP_ID,
        p_client_ts: '2026-07-17T09:00:00Z',
      });
      // No direct table write ever happens for territories.
      expect(supabase.from).not.toHaveBeenCalledWith('territories');
      expect(complete).toHaveBeenCalledTimes(1);
      expect(conflicts).toEqual([]);
    });

    it('CR-01: p_rep_id is the SESSION user, never the locally-written locked_by', async () => {
      // The session user is authoritative — even if the local row claimed the
      // session user's own id, the RPC argument must come from the session.
      const { database } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: REP_ID,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.getSession).toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith(
        'lock_territory',
        expect.objectContaining({ p_rep_id: REP_ID }),
      );
    });

    it('CR-01: a locked_by claiming a FOREIGN rep id is surfaced as a consumed conflict, no RPC', async () => {
      const foreignRep = '99999999-9999-9999-9999-999999999999';
      const { database, complete, execute, capturedCrudSql } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: foreignRep,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.rpc).not.toHaveBeenCalled();
      // The impossible local claim is reverted (WR-04 revert path) via the
      // internal storage table — bypassing CRUD capture (WR-11).
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "UPDATE ps_data__territories SET data = json_set(data, '$.locked_by', NULL, '$.locked_at', NULL) WHERE id = ?",
        [ROW_ID],
      );
      // WR-11: the revert never becomes an uploadable CRUD op — no spurious
      // unlock_territory upload on the next queue drain.
      expect(capturedCrudSql).toEqual([]);
      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'territories',
          entryId: ROW_ID,
          reason: expect.stringMatching(/authenticated rep/i),
        }),
      ]);
      // The server would deny this as final — consume the op, never wedge the queue.
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("a 'conflict' verdict surfaces the conflict instead of silently dropping", async () => {
      supabase.rpc.mockResolvedValueOnce({ data: 'conflict', error: null });
      const { database, complete, execute } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: REP_ID,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);

      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'territories',
          entryId: ROW_ID,
          reason: expect.stringMatching(/locked by another rep/i),
        }),
      ]);
      // The winner's lock replicates down — no local revert for 'conflict'.
      expect(execute).not.toHaveBeenCalled();
      // Server-authoritative denial is final: the op is consumed, not retried.
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("WR-04: a 'not_entitled' verdict reverts the local optimistic lock (row never changed server-side)", async () => {
      supabase.rpc.mockResolvedValueOnce({ data: 'not_entitled', error: null });
      const { database, complete, execute } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: REP_ID,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);

      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'territories',
          entryId: ROW_ID,
          reason: expect.stringMatching(/not entitled/i),
        }),
      ]);
      // Nothing replicates down for an unchanged row — local state must be
      // reverted explicitly so the device stops claiming a never-granted lock.
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "UPDATE ps_data__territories SET data = json_set(data, '$.locked_by', NULL, '$.locked_at', NULL) WHERE id = ?",
        [ROW_ID],
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("WR-11: the 'not_entitled' revert is local-only — it never enqueues an uploadable CRUD op (no echoed unlock_territory)", async () => {
      supabase.rpc.mockResolvedValueOnce({ data: 'not_entitled', error: null });
      const { database, execute, capturedCrudSql } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          locked_by: REP_ID,
          locked_at: '2026-07-17T09:00:00Z',
        }),
      ]);

      await connector.uploadData(database);
      // Drain again: the queue must be empty — a revert written through the
      // `territories` view would have been captured as a new PATCH and later
      // uploaded as a spurious unlock_territory RPC (second, misleading
      // "only the lock holder may release" conflict).
      await connector.uploadData(database);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(capturedCrudSql).toEqual([]);
      expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('lock_territory', expect.anything());
      expect(conflicts).toHaveLength(1);
    });

    it('unlock write (locked_by null) calls unlock_territory with the session user', async () => {
      const { database } = makeDatabase([
        entry('territories', UpdateType.PATCH, { locked_by: null, locked_at: null }),
      ]);

      await connector.uploadData(database);

      expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('unlock_territory', {
        p_territory_id: ROW_ID,
        p_rep_id: REP_ID,
      });
    });

    it('rejects territory ops that touch columns other than the lock columns', async () => {
      const { database, complete } = makeDatabase([
        entry('territories', UpdateType.PATCH, { name: 'hijacked', locked_by: REP_ID }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/lock/i);
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('rejects territory PUT/DELETE (clients never create or delete territories)', async () => {
      const { database } = makeDatabase([
        entry('territories', UpdateType.PUT, { name: 'new territory' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow();
    });
  });

  describe('uploadData — sync_demo (documented LWW, migrated off .upsert())', () => {
    it('PUT plain-inserts (never ON CONFLICT — same 42501 trap as houses)', async () => {
      const { database } = makeDatabase([
        entry('sync_demo', UpdateType.PUT, { company_id: 'c1', note: 'hello' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('sync_demo');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, note: 'hello' }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
    });

    it('PUT redelivery: duplicate-key rejection is consumed as already-uploaded success', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "sync_demo_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('sync_demo', UpdateType.PUT, { company_id: 'c1', note: 'hello' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PATCH is a real UPDATE (never an upsert), never routes to an RPC', async () => {
      const { database } = makeDatabase([
        entry('sync_demo', UpdateType.PATCH, { note: 'updated' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ note: 'updated' }),
      );
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', ROW_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('CR-03: DELETE is surfaced as a consumed conflict, never uploaded (no server DELETE grant)', async () => {
      const { database, complete } = makeDatabase([entry('sync_demo', UpdateType.DELETE)]);

      await connector.uploadData(database);

      // No network write is ever attempted — the server would 42501 forever
      // and wedge the head of the upload queue (Defect 3 failure class).
      expect(supabase.from).not.toHaveBeenCalled();
      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'sync_demo',
          entryId: ROW_ID,
          op: UpdateType.DELETE,
          reason: expect.stringMatching(/deletes are not supported/i),
        }),
      ]);
      // The op is consumed so the queue keeps draining.
      expect(complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('uploadData — houses (LWW-acceptable)', () => {
    it('PUT plain-inserts (never ON CONFLICT — RLS rejects speculative insertion)', async () => {
      const { database } = makeDatabase([
        entry('houses', UpdateType.PUT, { team_id: 't1', lat: '52.5', lon: '13.4', status: 'new' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('houses');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, status: 'new' }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
    });

    it('PUT redelivery: duplicate-key rejection is consumed as already-uploaded success', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "houses_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('houses', UpdateType.PUT, { team_id: 't1', lat: '52.5', lon: '13.4', status: 'new' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PATCH updates changed columns only (real UPDATE, never an upsert) and never routes to an RPC', async () => {
      // A PATCH carries only changed columns — sent as an upsert, the
      // proposed INSERT row lacks team_id and fails houses_insert_by_team's
      // WITH CHECK (42501), wedging the upload queue (02-08 device pass).
      const { database } = makeDatabase([
        entry('houses', UpdateType.PATCH, { status: 'follow_up' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'follow_up' }),
      );
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', ROW_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — appointments (device-local LWW, plain INSERT + real UPDATE)', () => {
    it('PUT plain-inserts the Folgetermin (never ON CONFLICT)', async () => {
      const { database } = makeDatabase([
        entry('appointments', UpdateType.PUT, {
          rep_id: REP_ID,
          team_id: 't1',
          house_id: 'house-1',
          scheduled_at: '2026-07-21T17:30:00.000Z',
          kind: 'follow_up',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('appointments');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, kind: 'follow_up', house_id: 'house-1' }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('PUT null-guards an empty-string house_id (nullable uuid backstop)', async () => {
      const { database } = makeDatabase([
        entry('appointments', UpdateType.PUT, {
          rep_id: REP_ID,
          team_id: 't1',
          house_id: '',
          scheduled_at: '2026-07-21T17:30:00.000Z',
          kind: 'follow_up',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ house_id: null }),
      );
    });

    it('PUT redelivery: duplicate-key rejection is consumed as already-uploaded success', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "appointments_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('appointments', UpdateType.PUT, { rep_id: REP_ID, team_id: 't1' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PATCH updates changed columns only (real UPDATE, never an upsert/RPC)', async () => {
      const { database } = makeDatabase([
        entry('appointments', UpdateType.PATCH, { scheduled_at: '2026-07-22T09:00:00.000Z' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ scheduled_at: '2026-07-22T09:00:00.000Z' }),
      );
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', ROW_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — blacklist_entries (insert-only)', () => {
    it('PUT inserts the row (append)', async () => {
      const { database, complete } = makeDatabase([
        entry('blacklist_entries', UpdateType.PUT, {
          team_id: 't1',
          lat: '52.5',
          lon: '13.4',
          reason: 'not_interested',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('blacklist_entries');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, reason: 'not_interested' }),
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('a non-PUT op throws (insert-only)', async () => {
      const { database, complete } = makeDatabase([
        entry('blacklist_entries', UpdateType.PATCH, { reason: 'no_solicitation' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/insert-only/i);
      expect(supabase.insert).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE throws (insert-only)', async () => {
      const { database } = makeDatabase([entry('blacklist_entries', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/insert-only/i);
    });
  });

  describe('uploadData — territories boundary writes (server-authoritative RPC, T-02-04-02)', () => {
    it('a boundary op routes to create_territory_boundary, never a direct table write', async () => {
      const boundary = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
      const { database, complete } = makeDatabase([
        entry('territories', UpdateType.PATCH, { boundary: JSON.stringify(boundary) }),
      ]);

      await connector.uploadData(database);

      expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith('create_territory_boundary', {
        p_territory_id: ROW_ID,
        p_boundary: boundary,
      });
      expect(supabase.from).not.toHaveBeenCalledWith('territories');
      expect(complete).toHaveBeenCalledTimes(1);
      expect(conflicts).toEqual([]);
    });

    it("an 'invalid_geometry' verdict surfaces a conflict and reverts the local boundary", async () => {
      supabase.rpc.mockResolvedValueOnce({ data: 'invalid_geometry', error: null });
      const boundary = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
      const { database, complete, execute } = makeDatabase([
        entry('territories', UpdateType.PATCH, { boundary: JSON.stringify(boundary) }),
      ]);

      await connector.uploadData(database);

      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'territories',
          entryId: ROW_ID,
          reason: expect.stringMatching(/invalid/i),
        }),
      ]);
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "UPDATE ps_data__territories SET data = json_set(data, '$.boundary', NULL) WHERE id = ?",
        [ROW_ID],
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("a 'not_entitled' verdict surfaces a conflict and reverts the local boundary, no blind retry", async () => {
      supabase.rpc.mockResolvedValueOnce({ data: 'not_entitled', error: null });
      const boundary = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
      const { database, execute } = makeDatabase([
        entry('territories', UpdateType.PATCH, { boundary: JSON.stringify(boundary) }),
      ]);

      await connector.uploadData(database);

      expect(conflicts).toEqual([
        expect.objectContaining({
          table: 'territories',
          entryId: ROW_ID,
          reason: expect.stringMatching(/not entitled/i),
        }),
      ]);
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        "UPDATE ps_data__territories SET data = json_set(data, '$.boundary', NULL) WHERE id = ?",
        [ROW_ID],
      );
    });

    it('rejects a boundary op that also touches other columns', async () => {
      const { database, complete } = makeDatabase([
        entry('territories', UpdateType.PATCH, { boundary: '{}', locked_by: REP_ID }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/boundary/i);
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — product_definitions (server-written only, publish CLI)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('product_definitions', UpdateType.PUT, { slug: 'internet-figures', version: 1 }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/server-side only \(publish CLI\)/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH/DELETE are also rejected (client never writes this table at all)', async () => {
      const { database } = makeDatabase([entry('product_definitions', UpdateType.PATCH, { status: 'published' })]);

      await expect(connector.uploadData(database)).rejects.toThrow(/server-side only \(publish CLI\)/i);
    });
  });

  describe('uploadData — discount_terms (server-written only, publish CLI)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('discount_terms', UpdateType.PUT, { product_slug: 'internet-figures', version: 1 }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/server-side only \(publish CLI\)/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — flow_drafts (device-local LWW, plain INSERT + real UPDATE)', () => {
    it('PUT plain-inserts (never ON CONFLICT)', async () => {
      const { database, complete } = makeDatabase([
        entry('flow_drafts', UpdateType.PUT, { created_by: REP_ID, status: 'in_progress' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('flow_drafts');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, status: 'in_progress' }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PUT redelivery: a duplicate-key insert error resolves without throwing', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "flow_drafts_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('flow_drafts', UpdateType.PUT, { created_by: REP_ID, status: 'in_progress' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PUT with a non-duplicate error throws (transaction not completed)', async () => {
      supabase.insert.mockResolvedValueOnce({ error: { message: 'permission denied for table flow_drafts' } });
      const { database, complete } = makeDatabase([
        entry('flow_drafts', UpdateType.PUT, { created_by: REP_ID, status: 'in_progress' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/flow_drafts insert failed/i);
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is a real UPDATE (never an upsert), forwarding the PARSED answers object (Gap 1)', async () => {
      const { database } = makeDatabase([
        entry('flow_drafts', UpdateType.PATCH, { answers: '{"q1":"yes"}' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ answers: { q1: 'yes' } }),
      );
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', ROW_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
    });

    it('PUT with a string answers field inserts the PARSED object (Gap 1)', async () => {
      const { database } = makeDatabase([
        entry('flow_drafts', UpdateType.PUT, {
          created_by: REP_ID,
          status: 'in_progress',
          answers: '{"q1":"yes"}',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, answers: { q1: 'yes' } }),
      );
    });

    it('opData without an answers field is forwarded unchanged (no crash, no injected key)', async () => {
      const { database } = makeDatabase([
        entry('flow_drafts', UpdateType.PATCH, { status: 'completed' }),
      ]);

      await connector.uploadData(database);

      const [callArgs] = supabase.update.mock.calls[0] as [Record<string, unknown>];
      expect(callArgs).not.toHaveProperty('answers');
      expect(callArgs).toEqual({ status: 'completed' });
    });

    it('answers already a non-string object is forwarded as-is (defensive)', async () => {
      const { database } = makeDatabase([
        entry('flow_drafts', UpdateType.PATCH, { answers: { q1: 'yes' } }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ answers: { q1: 'yes' } }),
      );
    });
  });

  describe('uploadData — leads (INSERT-ONLY, consent-gated, D-17)', () => {
    it('PUT plain-inserts a lead (never ON CONFLICT), normalizing consent_given to a boolean', async () => {
      const { database, complete } = makeDatabase([
        entry('leads', UpdateType.PUT, {
          company_id: 'company-1',
          rep_id: REP_ID,
          team_id: 'team-1',
          contact_name: 'Erika Mustermann',
          product_interest: 'Glasfaser 1000',
          consent_given: '1',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('leads');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: ROW_ID,
          rep_id: REP_ID,
          contact_name: 'Erika Mustermann',
          product_interest: 'Glasfaser 1000',
          consent_given: true,
        }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('parses offer_snapshot back into an object so jsonb does not receive a scalar string (0084)', async () => {
      const { database } = makeDatabase([
        entry('leads', UpdateType.PUT, {
          company_id: 'company-1',
          consent_given: '1',
          offer_code: 'FDS-ABCD-2345',
          offer_snapshot: '{"doorPrice":249}',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ offer_code: 'FDS-ABCD-2345', offer_snapshot: { doorPrice: 249 } }),
      );
    });

    it('drops a malformed offer_snapshot to null rather than failing the offer upload (0084)', async () => {
      const { database } = makeDatabase([
        entry('leads', UpdateType.PUT, {
          company_id: 'company-1',
          consent_given: '1',
          offer_code: 'FDS-ABCD-2345',
          offer_snapshot: '{oops',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ offer_snapshot: null }),
      );
    });

    it('PUT redelivery: a duplicate-key insert error resolves without throwing', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "leads_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('leads', UpdateType.PUT, { company_id: 'company-1', consent_given: 'true' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PUT with a non-duplicate error throws (transaction not completed)', async () => {
      supabase.insert.mockResolvedValueOnce({ error: { message: 'permission denied for table leads' } });
      const { database, complete } = makeDatabase([
        entry('leads', UpdateType.PUT, { company_id: 'company-1', consent_given: 'true' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/leads insert failed/i);
      expect(complete).not.toHaveBeenCalled();
    });

    it('a non-PUT op throws (insert-only)', async () => {
      const { database } = makeDatabase([entry('leads', UpdateType.PATCH, { contact_name: 'x' })]);
      await expect(connector.uploadData(database)).rejects.toThrow(/insert-only/i);
    });

    it('DELETE throws (insert-only)', async () => {
      const { database } = makeDatabase([entry('leads', UpdateType.DELETE)]);
      await expect(connector.uploadData(database)).rejects.toThrow(/insert-only/i);
    });
  });

  describe('uploadData — teams (read-only, server-written only, ROLE-02)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('teams', UpdateType.PUT, { name: 'Team A' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('teams', UpdateType.PATCH, { name: 'hijacked' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([entry('teams', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — memberships (read-only, server-written only, ROLE-02)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('memberships', UpdateType.PUT, { user_id: REP_ID, team_id: 't1', role_id: 'rep' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('memberships', UpdateType.PATCH, { role_id: 'team_lead' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([entry('memberships', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — org_admins (read-only, server-written only, ROLE-02)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('org_admins', UpdateType.PUT, { user_id: REP_ID, sales_org_id: 'org1' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('org_admins', UpdateType.PATCH, { sales_org_id: 'org2' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([entry('org_admins', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — territory_assignments (read-only, RPC-written only, TASGN-01/02)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('territory_assignments', UpdateType.PUT, {
          territory_id: 't1',
          assigned_rep_id: REP_ID,
          team_id: 'team1',
        }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('territory_assignments', UpdateType.PATCH, { assigned_rep_id: REP_ID }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('territory_assignments', UpdateType.DELETE),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — device_wipe_orders (read-only, RPC-written only, SEC-08/D-01/D-02)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('device_wipe_orders', UpdateType.PUT, {
          device_owner_rep_id: REP_ID,
          team_id: 'team1',
          status: 'queued',
        }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('device_wipe_orders', UpdateType.PATCH, { pending_artifact_count: '0' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([entry('device_wipe_orders', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — app_users (own-row PATCH of a fixed profile-column whitelist, D-01/D-02)', () => {
    it('a whitelisted PATCH matching the session user id issues a real UPDATE ... eq(id)', async () => {
      const { database, complete } = makeDatabase([
        entry(
          'app_users',
          UpdateType.PATCH,
          { full_name: 'Erika Musterfrau', avatar_url: 'avatars/rep-1/photo.jpg' },
          REP_ID,
        ),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('app_users');
      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ full_name: 'Erika Musterfrau', avatar_url: 'avatars/rep-1/photo.jpg' }),
      );
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', REP_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('a PATCH touching a non-whitelisted column throws, naming the rejected column', async () => {
      const { database, complete } = makeDatabase([
        entry('app_users', UpdateType.PATCH, { is_tester: true }, REP_ID),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/rejected columns: is_tester/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('a PATCH touching team_id or created_at throws (defence in depth beyond RLS)', async () => {
      const { database } = makeDatabase([
        entry('app_users', UpdateType.PATCH, { team_id: 't1', created_at: '2026-01-01' }, REP_ID),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/rejected columns/i);
    });

    it("a PATCH whose op.id differs from the session user id throws, naming both ids", async () => {
      const foreignId = '99999999-9999-9999-9999-999999999999';
      const { database, complete } = makeDatabase([
        entry('app_users', UpdateType.PATCH, { full_name: 'hijacked' }, foreignId),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(
        new RegExp(`${foreignId}.*${REP_ID}|does not match the authenticated session`, 'i'),
      );
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PUT is rejected loudly — only own-profile PATCH is permitted', async () => {
      const { database, complete } = makeDatabase([
        entry('app_users', UpdateType.PUT, { full_name: 'Fake Rep' }, REP_ID),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/only accepts own-profile PATCH/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly — only own-profile PATCH is permitted', async () => {
      const { database, complete } = makeDatabase([entry('app_users', UpdateType.DELETE, undefined, REP_ID)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/only accepts own-profile PATCH/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('never issues .upsert() against app_users', async () => {
      const { database } = makeDatabase([
        entry('app_users', UpdateType.PATCH, { full_name: 'Erika Musterfrau' }, REP_ID),
      ]);

      await connector.uploadData(database);

      expect(supabase.upsert).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — direct_sign_templates (read-only, server-written only, DSGN-01/T-10-10)', () => {
    it('PUT is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('direct_sign_templates', UpdateType.PUT, { storage_path: 'x/y.pdf', sha256: 'abc' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('PATCH is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([
        entry('direct_sign_templates', UpdateType.PATCH, { status: 'published' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });

    it('DELETE is rejected loudly, never forwarded to the server', async () => {
      const { database, complete } = makeDatabase([entry('direct_sign_templates', UpdateType.DELETE)]);

      await expect(connector.uploadData(database)).rejects.toThrow(/written server-side only/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — user_settings (device-local LWW, plain INSERT + real UPDATE, SET-01)', () => {
    it('PUT plain-inserts the settings row (never ON CONFLICT/upsert)', async () => {
      const { database } = makeDatabase([
        entry('user_settings', UpdateType.PUT, {
          language: 'de',
          theme: 'dark',
          text_size: 'default',
          high_contrast: 'false',
        }),
      ]);

      await connector.uploadData(database);

      expect(supabase.from).toHaveBeenCalledWith('user_settings');
      expect(supabase.insert).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ id: ROW_ID, language: 'de', theme: 'dark' }),
      );
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('PUT redelivery: duplicate-key rejection is consumed as already-uploaded success', async () => {
      supabase.insert.mockResolvedValueOnce({
        error: { message: 'duplicate key value violates unique constraint "user_settings_pkey"' },
      });
      const { database, complete } = makeDatabase([
        entry('user_settings', UpdateType.PUT, { language: 'de' }),
      ]);

      await connector.uploadData(database);

      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('PUT rethrows any non-duplicate-key error', async () => {
      supabase.insert.mockResolvedValueOnce({ error: { message: 'permission denied' } });
      const { database } = makeDatabase([entry('user_settings', UpdateType.PUT, { language: 'de' })]);

      await expect(connector.uploadData(database)).rejects.toThrow(/user_settings insert failed/i);
    });

    it('PATCH updates changed columns only (real UPDATE, never an upsert/RPC)', async () => {
      const { database } = makeDatabase([
        entry('user_settings', UpdateType.PATCH, { theme: 'light' }),
      ]);

      await connector.uploadData(database);

      expect(supabase.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme: 'light' }));
      expect(supabase.updateEq).toHaveBeenCalledExactlyOnceWith('id', ROW_ID);
      expect(supabase.upsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('PATCH rethrows an update error', async () => {
      supabase.updateEq.mockResolvedValueOnce({ error: { message: 'permission denied' } });
      const { database } = makeDatabase([
        entry('user_settings', UpdateType.PATCH, { theme: 'light' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/user_settings update failed/i);
    });
  });

  describe('uploadData — territories defense-in-depth (assignment is NOT a territories column, D-04 REVISED)', () => {
    it('a territories PATCH bundling assigned_rep_id is rejected by the existing lock-column whitelist, never calls rpc', async () => {
      const { database, complete } = makeDatabase([
        entry('territories', UpdateType.PATCH, {
          assigned_rep_id: REP_ID,
          locked_by: REP_ID,
        }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/lock/i);
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — table whitelist (ASVS V5, T-01-20)', () => {
    it('rejects unknown table names instead of forwarding them', async () => {
      const { database, complete } = makeDatabase([
        entry('pg_catalog_evil', UpdateType.PUT, { boom: '1' }),
      ]);

      await expect(connector.uploadData(database)).rejects.toThrow(/not a whitelisted table/i);
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('uploadData — empty queue', () => {
    it('is a no-op when there is no pending transaction', async () => {
      const { database } = makeDatabase([]);

      await expect(connector.uploadData(database)).resolves.toBeUndefined();
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });
});
