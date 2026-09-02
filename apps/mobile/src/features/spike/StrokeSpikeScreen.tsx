import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import SignatureView, { type SignatureViewRef } from "react-native-signature-canvas";

/**
 * Phase 4 Plan 01 (04-01) stroke-data spike — decision D-19 / assumption A1
 * (04-RESEARCH.md Pitfall 1, 04-CONTEXT.md D-19): does
 * `react-native-signature-canvas@5.1.0`'s point-group export include
 * per-point timestamps (and, if so, at what precision), so
 * `buildAuditPackage`'s `signatureStrokeData` field (SIGN-03) can be frozen
 * BEFORE any downstream plan builds against its shape?
 *
 * IMPORTANT (deviation from 04-RESEARCH.md Pattern 3's illustrative
 * `toData()` call): the actually-installed `react-native-signature-canvas`
 * TypeScript surface (node_modules/react-native-signature-canvas/index.d.ts)
 * exposes no synchronous `toData()` ref method. The real API is
 * `getData()` (imperative, fires a WebView->RN bridge round-trip) paired
 * with the `onGetData` prop callback, which receives the point-group data
 * as a JSON string. This screen calls `getData()` on save and logs/renders
 * whatever `onGetData` receives, exactly so this API-shape gap is caught by
 * the spike rather than discovered later while implementing
 * `buildAuditPackage.ts`. Record the finding in 04-STROKE-SPIKE.md
 * (root-cause note per CONVENTIONS.md, since this deviates from the
 * research doc's illustrative code).
 *
 * Dev-only, mirrors SpikeScreen.tsx/PmtilesSpikeScreen.tsx conventions
 * (colocated StyleSheet, ProbeRow-style status text). Gated behind
 * EXPO_PUBLIC_STROKE_SPIKE=1 inside App.tsx's __DEV__ branch — never a
 * shipped feature, never statically imported (WR-02).
 */
export function StrokeSpikeScreen() {
  const signatureRef = useRef<SignatureViewRef>(null);
  const [rawResult, setRawResult] = useState<string | null>(null);
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleGetData(data: string) {
    setRawResult(data);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(data);
      const groups = Array.isArray(parsed) ? parsed : [];
      const firstGroup = groups[0] as { points?: unknown[] } | undefined;
      const firstPoint = firstGroup?.points?.[0] as Record<string, unknown> | undefined;
      const pointKeys = firstPoint ? Object.keys(firstPoint).join(", ") : "(no points in first group)";
      setParsedSummary(
        `groups=${groups.length}, firstGroup.points=${firstGroup?.points?.length ?? 0}, ` +
          `firstPoint keys=[${pointKeys}]`,
      );
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  function handleSave() {
    // getData() is imperative + async over the WebView bridge — the result
    // arrives via the onGetData prop callback below, not a return value.
    signatureRef.current?.getData();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Signature Stroke-Data Spike (dev-only)</Text>
      <Text style={styles.subtitle}>
        D-19 / A1 — verify getData() point-group shape (timestamps? pressure?) before freezing
        buildAuditPackage's signatureStrokeData field.
      </Text>

      <View style={styles.canvasBlock}>
        <SignatureView
          ref={signatureRef}
          onOK={() => {
            /* rendered PNG — not the focus of this spike, ignored here */
          }}
          onEmpty={() => setError("signature is empty — draw before saving")}
          onGetData={handleGetData}
          webStyle=".m-signature-pad--footer { display: none; margin: 0; }"
          style={styles.canvas}
        />
      </View>

      <Pressable style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save + log getData()</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={() => signatureRef.current?.clearSignature()}>
        <Text style={styles.buttonText}>Clear</Text>
      </Pressable>

      {error ? <Text style={styles.error}>Error: {error}</Text> : null}
      {parsedSummary ? <Text style={styles.summary}>{parsedSummary}</Text> : null}
      {rawResult ? (
        <View style={styles.rawBlock}>
          <Text style={styles.rawLabel}>Raw getData() JSON (copy this into 04-STROKE-SPIKE.md):</Text>
          <Text selectable style={styles.raw}>
            {rawResult}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 12,
    color: "#444",
  },
  canvasBlock: {
    height: 260,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    overflow: "hidden",
  },
  canvas: {
    flex: 1,
  },
  button: {
    backgroundColor: "#1a73e8",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#666",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  error: {
    color: "#b3261e",
    fontSize: 13,
  },
  summary: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0a7d2c",
  },
  rawBlock: {
    gap: 4,
  },
  rawLabel: {
    fontSize: 12,
    color: "#444",
  },
  raw: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#222",
  },
});
