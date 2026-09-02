import { useCallback, useEffect, useRef, useState } from "react";
import { open as openOpSqlite } from "@op-engineering/op-sqlite";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

/**
 * Native-probe spike (Phase 1 Plan 5): proves the New-Architecture native module
 * combination (op-sqlite/SQLCipher + Vision Camera v5 Nitro + Speech Recognition +
 * MapLibre) links and coexists on-device. Dev-only, deleted/hidden once documented
 * per SPIKE-RESULTS.md — NOT a shipped feature, no PowerSync sync logic here
 * (that is Plan 07).
 */

export type ProbeStatus = "idle" | "running" | "ok" | "error";

export interface ProbeState {
  status: ProbeStatus;
  message: string;
}

const IDLE: ProbeState = { status: "idle", message: "not started" };

/**
 * op-sqlite/SQLCipher probe: opens an encrypted local database with a throwaway
 * key and runs `SELECT 1` to prove the encrypted engine initializes.
 */
export function useSqliteProbe(): ProbeState {
  const [state, setState] = useState<ProbeState>(IDLE);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "running", message: "opening encrypted db..." });

    try {
      // Throwaway key — this database is never persisted/used beyond the spike.
      const db = openOpSqlite({
        name: "spike-probe.sqlite",
        encryptionKey: "spike-throwaway-key-not-for-reuse",
      });

      db.execute("SELECT 1")
        .then((result) => {
          if (cancelled) return;
          setState({
            status: "ok",
            message: `SELECT 1 -> ${JSON.stringify(result.rows ?? result)}`,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState({ status: "error", message: describeError(error) });
        });
    } catch (error) {
      setState({ status: "error", message: describeError(error) });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * expo-speech-recognition probe: request the permission-gated speech session and
 * report start/stop/error — no transcription feature, this is link-and-boot only.
 */
export function useSpeechProbe(): {
  state: ProbeState;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<ProbeState>(IDLE);

  useSpeechRecognitionEvent("start", () => {
    setState({ status: "ok", message: "speech session started" });
  });
  useSpeechRecognitionEvent("end", () => {
    setState((prev) =>
      prev.status === "error" ? prev : { status: "ok", message: "speech session ended" },
    );
  });
  useSpeechRecognitionEvent("error", (event) => {
    setState({ status: "error", message: `${event.error}: ${event.message}` });
  });

  const start = useCallback(async () => {
    setState({ status: "running", message: "requesting permission..." });
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setState({ status: "error", message: "permission denied" });
        return;
      }
      setState({ status: "running", message: "starting session..." });
      ExpoSpeechRecognitionModule.start({ lang: "de-DE", interimResults: false });
    } catch (error) {
      setState({ status: "error", message: describeError(error) });
    }
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { state, start, stop };
}

/**
 * MapLibre empty-MapView probe: reports ok once the native map finishes loading,
 * error if it never fires within a timeout. No PMTiles/territory logic (Phase 2).
 */
export function useMapProbe(): {
  state: ProbeState;
  onDidFinishLoadingMap: () => void;
} {
  const [state, setState] = useState<ProbeState>({
    status: "running",
    message: "mounting MapView...",
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setState((prev) =>
        prev.status === "running"
          ? { status: "error", message: "map did not finish loading (10s timeout)" }
          : prev,
      );
    }, 10_000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onDidFinishLoadingMap = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState({ status: "ok", message: "map finished loading" });
  }, []);

  return { state, onDidFinishLoadingMap };
}

/**
 * PMTiles local-file render probe (Phase 2 Plan 01, MAP-03 risk gate): reports
 * whether the MapLibre RN MapView finished loading a style backed by a
 * `pmtiles://file://` VectorSource, or failed to (Pitfall 1 warning signs —
 * unrecognized URL scheme, tiles never appear). Mirrors useMapProbe's
 * timeout-based shape, but keyed off `onDidFailLoadingMap` too since a
 * rejected local scheme is expected to surface as a style-load failure, not
 * just a silent timeout.
 */
export function usePmtilesProbe(): {
  state: ProbeState;
  onDidFinishLoadingMap: () => void;
  onDidFailLoadingMap: () => void;
} {
  const [state, setState] = useState<ProbeState>({
    status: "running",
    message: "mounting MapView with pmtiles:// VectorSource...",
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setState((prev) =>
        prev.status === "running"
          ? { status: "error", message: "map did not finish loading (15s timeout)" }
          : prev,
      );
    }, 15_000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const onDidFinishLoadingMap = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState({ status: "ok", message: "map finished loading (style loaded — check tiles visually)" });
  }, []);

  const onDidFailLoadingMap = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setState({ status: "error", message: "onDidFailLoadingMap fired — style/source failed to load" });
  }, []);

  return { state, onDidFinishLoadingMap, onDidFailLoadingMap };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
