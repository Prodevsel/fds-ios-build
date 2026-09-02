import * as Location from 'expo-location';

/**
 * D-04 GPS-never-blocks-signing: a ONE-SHOT foreground fix with a timeout,
 * never a continuous/background subscription (MapScreen's
 * `requestLocationAndTrack` is continuous — only its permission-error
 * handling SHAPE is mirrored here, never `watchPositionAsync` or
 * `ACCESS_BACKGROUND_LOCATION`; see 04-CONTEXT.md Pitfall 4).
 *
 * getSignatureLocation NEVER throws — denial, timeout, or any unexpected
 * error from the injected deps all resolve to `{ gps: null, reason }`, so a
 * broken location subsystem can never block a legally binding signature.
 */

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

export interface SignatureLocationDeps {
  requestPermission: () => Promise<{ granted: boolean }>;
  getCurrentPosition: () => Promise<LocationFix>;
  /** Bounded wait for the one-shot fix; default 10s (see defaultSignatureLocationDeps). */
  timeoutMs?: number;
}

export type SignatureLocationResult =
  | { gps: LocationFix }
  | { gps: null; reason: 'permission-denied' | 'timeout' | 'error' };

const TIMEOUT = Symbol('getSignatureLocation-timeout');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function getSignatureLocation(
  deps: SignatureLocationDeps,
): Promise<SignatureLocationResult> {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  try {
    const permission = await deps.requestPermission();
    if (!permission.granted) {
      return { gps: null, reason: 'permission-denied' };
    }
    const fix = await withTimeout(deps.getCurrentPosition(), timeoutMs);
    if (fix === TIMEOUT) {
      return { gps: null, reason: 'timeout' };
    }
    return { gps: fix };
  } catch {
    // Any unexpected failure (permission API throwing, position API
    // throwing, provider disabled, etc.) degrades to gps:null — never
    // blocks the signature (D-04).
    return { gps: null, reason: 'error' };
  }
}

/** Default production wiring: expo-location, foreground-only, one-shot. */
export const defaultSignatureLocationDeps: SignatureLocationDeps = {
  async requestPermission() {
    const result = await Location.requestForegroundPermissionsAsync();
    return { granted: result.status === Location.PermissionStatus.GRANTED };
  },
  async getCurrentPosition() {
    // Balanced accuracy: sufficient for evidentiary "was at this address"
    // purposes without the battery/latency cost of BestForNavigation, and
    // explicitly NOT a continuous watch (D-04 Out-of-Scope guardrail).
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.LocationAccuracy.Balanced,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? 0,
    };
  },
  timeoutMs: 10_000,
};

/** Production entry point — never blocks the signature flow (D-04). */
export async function getSignatureLocationDefault(): Promise<SignatureLocationResult> {
  return getSignatureLocation(defaultSignatureLocationDeps);
}
