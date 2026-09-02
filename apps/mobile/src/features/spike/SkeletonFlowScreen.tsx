import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PowerSyncContext, useQuery, useStatus } from "@powersync/react";
import type { PowerSyncDatabase } from "@powersync/react-native";
import { insertDemoRow, useSkeletonFlow } from "./useSkeletonFlow";

/**
 * Walking Skeleton flow screen (Phase 1 Plan 09, SYNC-01/02/03).
 *
 * Dev-gated, throwaway instrumentation harness — NOT shipped UI. Exercises
 * the full stack end-to-end in one screen: sign in -> connect PowerSync ->
 * LOCAL `sync_demo` insert (never a direct network write) -> live local list
 * via `useQuery` -> on-screen sync status (connected / last-synced / pending
 * upload count) so the airplane-mode -> reconnect transition proven in
 * SPIKE-RESULTS.md is directly observable.
 */
export function SkeletonFlowScreen() {
  const { phase, error, db, conflicts, signIn } = useSkeletonFlow();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Walking Skeleton (dev-only)</Text>
      <Text style={styles.phase}>phase: {phase}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {phase === "signed-out" || phase === "signing-in" || phase === "error" ? (
        <Pressable
          style={styles.button}
          disabled={phase === "signing-in"}
          onPress={() => void signIn()}
        >
          <Text style={styles.buttonText}>
            {phase === "signing-in" ? "Signing in..." : "Sign in as fixture rep"}
          </Text>
        </Pressable>
      ) : null}

      {conflicts.length > 0 ? (
        <View style={styles.conflictBlock}>
          <Text style={styles.conflictTitle}>Server conflicts ({conflicts.length})</Text>
          {conflicts.map((conflict, index) => (
            <Text key={index} style={styles.conflictText}>
              {conflict.table}.{conflict.entryId}: {conflict.reason}
            </Text>
          ))}
        </View>
      ) : null}

      {db ? (
        <PowerSyncContext.Provider value={db}>
          <SkeletonFlowBody db={db} />
        </PowerSyncContext.Provider>
      ) : null}
    </ScrollView>
  );
}

/**
 * Rendered only once the PowerSync database is connected — needs the
 * PowerSyncContext.Provider above for `useQuery`/`useStatus` to resolve.
 */
function SkeletonFlowBody({ db }: { db: PowerSyncDatabase }) {
  const status = useStatus();
  const { data: rows } = useQuery<{ id: string; note: string; created_at: string }>(
    "SELECT id, note, created_at FROM sync_demo ORDER BY created_at DESC",
  );
  const { data: pendingRows } = useQuery<{ count: number }>(
    "SELECT count(*) as count FROM ps_crud",
  );
  const pendingCount = pendingRows[0]?.count ?? 0;

  const [note, setNote] = useState("");
  const [insertError, setInsertError] = useState<string | null>(null);

  const handleInsert = useCallback(async () => {
    if (!note.trim()) return;
    try {
      setInsertError(null);
      await insertDemoRow(db, note.trim());
      setNote("");
    } catch (err) {
      setInsertError(err instanceof Error ? err.message : String(err));
    }
  }, [db, note]);

  return (
    <View style={styles.body}>
      <View style={styles.statusBlock}>
        <Text style={styles.sectionTitle}>Sync status</Text>
        <Text style={styles.statusLine}>
          connected: {String(status.connected)} · connecting: {String(status.connecting)}
        </Text>
        <Text style={styles.statusLine}>
          last synced: {status.lastSyncedAt ? status.lastSyncedAt.toISOString() : "never"}
        </Text>
        <Text style={styles.statusLine}>pending upload count: {pendingCount}</Text>
      </View>

      <View style={styles.insertBlock}>
        <Text style={styles.sectionTitle}>Create a sync_demo record OFFLINE</Text>
        <TextInput
          style={styles.input}
          placeholder="note text"
          value={note}
          onChangeText={setNote}
        />
        <Pressable style={styles.button} onPress={() => void handleInsert()}>
          <Text style={styles.buttonText}>Insert locally</Text>
        </Pressable>
        {insertError ? <Text style={styles.error}>{insertError}</Text> : null}
      </View>

      <View style={styles.listBlock}>
        <Text style={styles.sectionTitle}>Local sync_demo rows ({rows.length})</Text>
        {rows.map((row) => (
          <Text key={row.id} style={styles.rowText}>
            {row.created_at} — {row.note}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  phase: {
    fontSize: 13,
    color: "#444",
  },
  error: {
    fontSize: 13,
    color: "#b3261e",
  },
  button: {
    backgroundColor: "#1a73e8",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  conflictBlock: {
    gap: 4,
    padding: 8,
    backgroundColor: "#fdecea",
    borderRadius: 6,
  },
  conflictTitle: {
    fontWeight: "700",
    color: "#b3261e",
  },
  conflictText: {
    fontSize: 12,
    color: "#b3261e",
  },
  body: {
    gap: 16,
  },
  statusBlock: {
    gap: 4,
  },
  statusLine: {
    fontSize: 13,
    color: "#333",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  insertBlock: {
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  listBlock: {
    gap: 4,
  },
  rowText: {
    fontSize: 12,
    color: "#222",
  },
});
