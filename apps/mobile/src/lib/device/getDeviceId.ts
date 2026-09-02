import { getAndroidId, getIosIdForVendorAsync } from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { SecureStoreLike } from '../auth/chunkedSecureStorage';

/**
 * D-21 device-identity chain for the SIGN-03 audit package.
 *
 * ROOT CAUSE this exists for: `getIosIdForVendorAsync` documents that it may
 * return `nil` transiently right after a device restart (before the user
 * unlocks it) — that is not a permanent failure, just a race. A signature
 * flow must never block on this: retry once, and if the native id is still
 * unavailable, fall back to a generated UUID persisted via the injected
 * `SecureStoreLike` (WR-03-style chunked storage NOT needed here — a UUID is
 * far under any SecureStore size limit).
 *
 * getDeviceId NEVER throws to the caller — every failure mode (native id
 * reader throwing, SecureStore read/write throwing) degrades to an
 * ephemeral fallback UUID rather than blocking the signature.
 */

export const FALLBACK_UUID_KEY = 'fds_device_id_fallback_uuid';

export interface NativeIdResult {
  id: string;
  source: 'idfv' | 'androidId';
}

export interface GetDeviceIdDeps {
  getNativeId: () => Promise<NativeIdResult | null>;
  secureStore: SecureStoreLike;
  generateUuid: () => string;
}

export interface DeviceIdResult {
  deviceId: string;
  deviceIdSource: 'idfv' | 'androidId' | 'fallback-uuid';
}

async function safeGetNativeId(deps: GetDeviceIdDeps): Promise<NativeIdResult | null> {
  try {
    return await deps.getNativeId();
  } catch {
    // A throwing native-id reader must not block signing — treat as nil.
    return null;
  }
}

export async function getDeviceId(deps: GetDeviceIdDeps): Promise<DeviceIdResult> {
  let native = await safeGetNativeId(deps);
  if (!native) {
    native = await safeGetNativeId(deps); // single retry, per D-21
  }
  if (native) {
    return { deviceId: native.id, deviceIdSource: native.source };
  }

  // Fallback path: reuse a persisted UUID, or generate + persist one. Every
  // SecureStore call is individually guarded so a storage failure still
  // yields a usable (if unpersisted) id rather than throwing.
  let existing: string | null = null;
  try {
    existing = await deps.secureStore.getItemAsync(FALLBACK_UUID_KEY);
  } catch {
    existing = null;
  }
  if (existing) {
    return { deviceId: existing, deviceIdSource: 'fallback-uuid' };
  }

  const generated = deps.generateUuid();
  try {
    await deps.secureStore.setItemAsync(FALLBACK_UUID_KEY, generated);
  } catch {
    // Persistence failed — still return a usable id for THIS signature;
    // the next call will simply generate again rather than block.
  }
  return { deviceId: generated, deviceIdSource: 'fallback-uuid' };
}

/** Default production wiring: expo-application (native id) + expo-secure-store + expo-crypto (uuid). */
async function defaultGetNativeId(): Promise<NativeIdResult | null> {
  if (Platform.OS === 'ios') {
    const id = await getIosIdForVendorAsync();
    return id ? { id, source: 'idfv' } : null;
  }
  if (Platform.OS === 'android') {
    const id = getAndroidId();
    return id ? { id, source: 'androidId' } : null;
  }
  return null;
}

const defaultSecureStore: SecureStoreLike = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export const defaultGetDeviceIdDeps: GetDeviceIdDeps = {
  getNativeId: defaultGetNativeId,
  secureStore: defaultSecureStore,
  generateUuid: () => Crypto.randomUUID(),
};

/** Production entry point — never blocks the signature flow (D-21). */
export async function getDeviceIdDefault(): Promise<DeviceIdResult> {
  return getDeviceId(defaultGetDeviceIdDeps);
}
