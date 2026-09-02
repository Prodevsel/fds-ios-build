import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { Asset } from "expo-asset";
import {
  Camera,
  Layer,
  Map as MapView,
  VectorSource,
  type StyleSpecification,
} from "@maplibre/maplibre-react-native";
import { usePmtilesProbe, type ProbeState } from "./useSpikeProbes";

/**
 * Phase 2 Plan 01 (02-01) PMTiles render spike — the phase's primary
 * technical-risk gate (02-RESEARCH.md Pitfall 1 / Open Question 1 /
 * Assumption A1): does `@maplibre/maplibre-react-native@11.3.6` actually
 * render a local `pmtiles://file://` VectorSource on a physical Android
 * device, fully offline?
 *
 * Dev-only, mirrors SpikeScreen.tsx conventions (colocated StyleSheet,
 * ProbeRow status pattern). Gated behind EXPO_PUBLIC_PMTILES_SPIKE=1 inside
 * App.tsx's __DEV__ branch — never a shipped feature, never statically
 * imported (WR-02).
 *
 * Bundles `assets/test-territory.pmtiles` (produced by
 * scripts/pmtiles/extract-test-tile.sh) via expo-asset and copies it into
 * the app-sandboxed document directory once, following 02-RESEARCH.md
 * Pattern 1's check-exists-before-copy shape (there it's a network download;
 * here the "download" source is the already-bundled asset). Uses the
 * expo-file-system@~56.0.20 `Paths`/`Directory`/`File` API (the legacy
 * `FileSystem.documentDirectory` string-path API was removed in this SDK-56
 * release train).
 */

const TERRITORIES_DIR = new Directory(Paths.document, "territories");
const LOCAL_FILE = new File(TERRITORIES_DIR, "test-territory.pmtiles");

// Camera centered on the extract's bbox (13.35,52.49,13.45,52.53 — central
// Berlin Mitte/Kreuzberg/Friedrichshain, see PMTILES-SPIKE.md "Test Extract").
const EXTRACT_CENTER: [number, number] = [13.4, 52.51];
const EXTRACT_ZOOM = 12;

// Minimal MapLibre style: no built-in sources/layers — the pmtiles VectorSource
// and its layers are supplied as children below (standard MapLibre RN
// composition pattern, matching 02-RESEARCH.md's ShapeSource+FillLayer example).
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

type CopyState = { status: "copying" | "done" | "error"; message: string; localPath?: string };

function useLocalPmtilesFile(): CopyState {
  const [state, setState] = useState<CopyState>({
    status: "copying",
    message: "checking for local extract...",
  });

  useEffect(() => {
    let cancelled = false;

    async function ensureLocalPmtiles() {
      try {
        if (LOCAL_FILE.exists) {
          if (!cancelled) {
            setState({ status: "done", message: "already present in sandbox", localPath: LOCAL_FILE.uri });
          }
          return;
        }

        if (!TERRITORIES_DIR.exists) {
          TERRITORIES_DIR.create({ intermediates: true });
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports -- dev-only bundled asset, not a shipped-code static import
        const asset = Asset.fromModule(require("../../../assets/test-territory.pmtiles"));
        await asset.downloadAsync();
        if (!asset.localUri) {
          throw new Error("expo-asset resolved no localUri for test-territory.pmtiles");
        }

        const bundledFile = new File(asset.localUri);
        await bundledFile.copy(LOCAL_FILE);

        if (!cancelled) {
          setState({ status: "done", message: "copied from bundled asset", localPath: LOCAL_FILE.uri });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void ensureLocalPmtiles();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function PmtilesSpikeScreen() {
  const copyState = useLocalPmtilesFile();
  const mapProbe = usePmtilesProbe();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>PMTiles Render Spike (dev-only)</Text>
      <Text style={styles.subtitle}>
        MAP-03 risk gate — offline pmtiles://file:// VectorSource on-device
      </Text>

      <ProbeRow
        label="Local extract copy"
        state={{
          status: copyState.status === "done" ? "ok" : copyState.status === "error" ? "error" : "running",
          message: copyState.message,
        }}
      />

      <ProbeRow label="MapLibre style/source load" state={mapProbe.state} />

      {copyState.status === "done" && copyState.localPath ? (
        <View style={styles.mapBlock}>
          <MapView
            style={styles.map}
            mapStyle={BLANK_STYLE}
            onDidFinishLoadingMap={mapProbe.onDidFinishLoadingMap}
            onDidFailLoadingMap={mapProbe.onDidFailLoadingMap}
          >
            <Camera center={EXTRACT_CENTER} zoom={EXTRACT_ZOOM} />
            <VectorSource
              id="basemap"
              // copyState.localPath is a `File.uri` (e.g. "file:///data/.../test-territory.pmtiles")
              // — strip the existing "file://" scheme before rebuilding the pmtiles:// URL so the
              // resulting string has exactly one "file://" segment, not a doubled-up scheme.
              url={`pmtiles://file://${copyState.localPath.replace(/^file:\/\//, "")}`}
            >
              <Layer
                id="earth-fill"
                type="fill"
                source-layer="earth"
                paint={{ "fill-color": "#e8e0d8" }}
              />
              <Layer
                id="roads-line"
                type="line"
                source-layer="roads"
                paint={{ "line-color": "#a9a9a9", "line-width": 1 }}
              />
              <Layer
                id="places-label"
                type="symbol"
                source-layer="places"
                layout={{ "text-field": ["get", "name"], "text-size": 12 }}
                paint={{ "text-color": "#222222" }}
              />
            </VectorSource>
          </MapView>
        </View>
      ) : (
        <Text style={styles.message}>Waiting for local .pmtiles file before mounting the map...</Text>
      )}
    </ScrollView>
  );
}

function ProbeRow({ label, state }: { label: string; state: ProbeState }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.status, statusStyle(state.status)]}>{state.status.toUpperCase()}</Text>
      <Text style={styles.message}>{state.message}</Text>
    </View>
  );
}

function statusStyle(status: ProbeState["status"]) {
  switch (status) {
    case "ok":
      return { color: "#0a7d2c" };
    case "error":
      return { color: "#b3261e" };
    case "running":
      return { color: "#a06400" };
    default:
      return { color: "#666" };
  }
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
  subtitle: {
    fontSize: 12,
    color: "#444",
  },
  mapBlock: {
    gap: 8,
  },
  row: {
    gap: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  status: {
    fontSize: 13,
    fontWeight: "700",
  },
  message: {
    fontSize: 12,
    color: "#444",
  },
  map: {
    height: 400,
    borderRadius: 8,
    overflow: "hidden",
  },
});
