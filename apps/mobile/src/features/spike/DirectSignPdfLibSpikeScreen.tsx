import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  base64ToBytes,
  runDirectSignPdfLibSpike,
  SPIKE_SIGNATURE_PNG_BASE64,
  type DirectSignPdfLibSpikeResult,
} from './directSignPdfLibSpike';

/**
 * Phase 10 Plan 07 (10-07) SC1 spike screen — does `@cantoo/pdf-lib@2.8.1`
 * load a REAL multi-MB PDF, hash it, and embed a signature artifact
 * ON-DEVICE (RN/Hermes) with no timeout/OOM, byte-preserving the original?
 * D-01: PARALLEL / non-blocking — server-side `renderDirectSignPdf.ts`
 * remains the default signing path regardless of this spike's outcome.
 *
 * Dev-only, mirrors StrokeSpikeScreen.tsx/PmtilesSpikeScreen.tsx conventions
 * (colocated StyleSheet, status text). Gated behind
 * EXPO_PUBLIC_DIRECT_SIGN_SPIKE=1 inside App.tsx's __DEV__ branch — never a
 * shipped feature, never statically imported (WR-02).
 *
 * Unlike PmtilesSpikeScreen (which bundles its fixture as an expo-asset),
 * this screen intentionally does NOT bundle a multi-MB PDF into the repo.
 * Instead it reads a real contract PDF the human `adb push`es into the
 * app-sandboxed document directory before running — see
 * 10-PDF-LIB-SPIKE.md's run instructions for the exact push command. This
 * keeps the spike testable against ANY real-world PDF size without bloating
 * the git history with binary fixtures.
 */

const FIXTURE_DIR = new Directory(Paths.document, 'direct-sign-spike');
const FIXTURE_FILE = new File(FIXTURE_DIR, 'fixture.pdf');

type FixtureState =
  | { status: 'checking' }
  | { status: 'missing' }
  | { status: 'ready'; sizeBytes: number };

function useFixtureCheck(): FixtureState {
  const [state, setState] = useState<FixtureState>({ status: 'checking' });

  useEffect(() => {
    if (!FIXTURE_FILE.exists) {
      setState({ status: 'missing' });
      return;
    }
    setState({ status: 'ready', sizeBytes: FIXTURE_FILE.size ?? 0 });
  }, []);

  return state;
}

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: DirectSignPdfLibSpikeResult }
  | { status: 'error'; message: string };

export function DirectSignPdfLibSpikeScreen() {
  const fixture = useFixtureCheck();
  const [runState, setRunState] = useState<RunState>({ status: 'idle' });

  async function handleRun() {
    setRunState({ status: 'running' });
    try {
      const originalBuffer = await FIXTURE_FILE.arrayBuffer();
      const originalBytes = new Uint8Array(originalBuffer);
      const signatureBytes = base64ToBytes(SPIKE_SIGNATURE_PNG_BASE64);
      const result = await runDirectSignPdfLibSpike(originalBytes, signatureBytes);
      setRunState({ status: 'done', result });
    } catch (error) {
      setRunState({
        status: 'error',
        message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Direct-Sign @cantoo/pdf-lib Spike (dev-only)</Text>
      <Text style={styles.subtitle}>
        SC1 (D-01) — on-device load/hash/embed feasibility for a real multi-MB contract PDF.
        PARALLEL/non-blocking: server-side renderDirectSignPdf.ts is the default path regardless
        of the outcome recorded here.
      </Text>

      <View style={styles.block}>
        <Text style={styles.label}>Fixture PDF</Text>
        {fixture.status === 'checking' ? (
          <Text style={styles.message}>checking {FIXTURE_FILE.uri}...</Text>
        ) : fixture.status === 'missing' ? (
          <Text style={styles.error}>
            missing — adb push a real multi-MB contract PDF to{'\n'}
            {FIXTURE_FILE.uri}{'\n'}
            (see 10-PDF-LIB-SPIKE.md step 2), then reload this screen.
          </Text>
        ) : (
          <Text style={styles.ok}>
            found — {(fixture.sizeBytes / (1024 * 1024)).toFixed(2)} MiB at {FIXTURE_FILE.uri}
          </Text>
        )}
      </View>

      <Pressable
        style={[styles.button, fixture.status !== 'ready' && styles.buttonDisabled]}
        disabled={fixture.status !== 'ready' || runState.status === 'running'}
        onPress={() => void handleRun()}
      >
        <Text style={styles.buttonText}>
          {runState.status === 'running' ? 'Running...' : 'Run spike'}
        </Text>
      </Pressable>

      {runState.status === 'error' ? (
        <View style={styles.block}>
          <Text style={styles.label}>Result: TIMEOUT/CRASH/ERROR</Text>
          <Text style={styles.error}>{runState.message}</Text>
          <Text style={styles.message}>
            Record this as a FAIL signal in 10-PDF-LIB-SPIKE.md — an on-device error/OOM/crash on
            a real multi-MB PDF is exactly what SC1 is checking for.
          </Text>
        </View>
      ) : null}

      {runState.status === 'done' ? (
        <View style={styles.block}>
          <Text style={styles.label}>Result</Text>
          <ResultRow label="load()" value={`${runState.result.loadMs} ms`} />
          <ResultRow label="hashPdfBytes(original)" value={`${runState.result.hashMs} ms`} />
          <ResultRow label="embedPng+drawImage+save()" value={`${runState.result.embedMs} ms`} />
          <ResultRow label="original size" value={`${runState.result.originalByteLength} bytes`} />
          <ResultRow label="embedded size" value={`${runState.result.embeddedByteLength} bytes`} />
          <ResultRow label="originalHash" value={runState.result.originalHash} />
          <ResultRow label="derivedHash" value={runState.result.derivedHash} />
          <ResultRow
            label="hashes differ (expected true)"
            value={String(runState.result.originalHash !== runState.result.derivedHash)}
          />
          <ResultRow
            label="originalBytesUnchanged (expected true)"
            value={String(runState.result.originalBytesUnchanged)}
          />
          <Text style={styles.message}>
            Copy these numbers into 10-PDF-LIB-SPIKE.md's results table (device, PDF size,
            timings, VERDICT). No timeout/crash + originalBytesUnchanged=true +
            originalHash!=derivedHash is the PASS bar — see the artifact for exact thresholds.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    color: '#444',
  },
  block: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  message: {
    fontSize: 12,
    color: '#444',
  },
  ok: {
    fontSize: 12,
    color: '#0a7d2c',
  },
  error: {
    fontSize: 12,
    color: '#b3261e',
  },
  button: {
    backgroundColor: '#1a73e8',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowLabel: {
    fontSize: 12,
    color: '#444',
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#222',
    flexShrink: 1,
    textAlign: 'right',
  },
});
