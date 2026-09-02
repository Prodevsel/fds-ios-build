import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import { Map as MapView } from "@maplibre/maplibre-react-native";
import { useMapProbe, useSpeechProbe, useSqliteProbe, type ProbeState } from "./useSpikeProbes";

/**
 * Phase 1 Plan 5 native-module spike: mounts all four New-Architecture native
 * modules (op-sqlite/SQLCipher, Vision Camera v5 Nitro, expo-speech-recognition,
 * MapLibre) in one screen to prove they link and coexist on-device. Simulators
 * are insufficient (01-RESEARCH.md Pitfall 9) — see SPIKE-RESULTS.md for the
 * physical-device verification outcome.
 *
 * Dev-only: gated behind __DEV__ in App.tsx. Not a shipped feature. No PowerSync
 * sync/connector logic here — the full sync path is Plan 07.
 */
export function SpikeScreen() {
  const sqliteProbe = useSqliteProbe();
  const speechProbe = useSpeechProbe();
  const mapProbe = useMapProbe();

  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } =
    useCameraPermission();
  const device = useCameraDevice("back");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const cameraStatus: ProbeState = (() => {
    if (cameraError) return { status: "error", message: cameraError };
    if (!hasCameraPermission) return { status: "running", message: "awaiting permission" };
    if (!device) return { status: "error", message: "no back camera device found" };
    return { status: "ok", message: `camera opened: ${device.name}` };
  })();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Native Module Spike (dev-only)</Text>

      <ProbeRow label="op-sqlite / SQLCipher" state={sqliteProbe} />

      <View style={styles.probeBlock}>
        <ProbeRow label="Vision Camera v5 (Nitro)" state={cameraStatus} />
        {!hasCameraPermission ? (
          <Pressable style={styles.button} onPress={() => void requestCameraPermission()}>
            <Text style={styles.buttonText}>Request camera permission</Text>
          </Pressable>
        ) : device ? (
          <Camera
            style={styles.cameraPreview}
            device={device}
            isActive={true}
            onError={(error) => setCameraError(error.message)}
          />
        ) : null}
      </View>

      <View style={styles.probeBlock}>
        <ProbeRow label="MapLibre (empty MapView, no PMTiles)" state={mapProbe.state} />
        <MapView
          style={styles.map}
          // Public MapLibre demo style — link-and-render probe only, no PMTiles/
          // territory data (that is Phase 2, per 01-RESEARCH.md Open Question 3).
          mapStyle="https://demotiles.maplibre.org/style.json"
          onDidFinishLoadingMap={mapProbe.onDidFinishLoadingMap}
        />
      </View>

      <View style={styles.probeBlock}>
        <ProbeRow label="expo-speech-recognition" state={speechProbe.state} />
        <Pressable style={styles.button} onPress={() => void speechProbe.start()}>
          <Text style={styles.buttonText}>Start speech session</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={speechProbe.stop}>
          <Text style={styles.buttonText}>Stop speech session</Text>
        </Pressable>
      </View>
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
  probeBlock: {
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
  cameraPreview: {
    height: 240,
    borderRadius: 8,
    overflow: "hidden",
  },
  map: {
    height: 240,
    borderRadius: 8,
    overflow: "hidden",
  },
});
