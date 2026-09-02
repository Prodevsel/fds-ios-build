import { describe, expect, it, vi } from 'vitest';

// Native Nitro modules — never resolvable/loadable under plain Node/vitest
// (mirrors IbanScanBlock.test.tsx's 'react-native' mock precedent). Only the
// pure, exported `extractIbanCandidate` core is exercised here; the hook
// itself wraps these native camera APIs and is not unit-tested without a
// device (no react-test-renderer in this repo).
vi.mock('react-native-vision-camera', () => ({
  useCameraDevice: () => undefined,
  useCameraPermission: () => ({
    hasPermission: false,
    status: 'not-determined',
    requestPermission: vi.fn(async () => false),
  }),
}));
vi.mock('react-native-vision-camera-ocr-plus', () => ({ Camera: () => null }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// useIbanScan transitively imports IbanScanBlock, which renders the InfoSheet
// HintRow (react-native-safe-area-context transitively). Pure logic only here —
// stub the UI module (same precedent as the native mocks above).
vi.mock('../../../ui/InfoSheet', () => ({ HintRow: () => null }));
// D-14b (SEC-05, plan 15-09): IbanScanBlock.tsx (transitively imported via
// IbanScanBlock's `validateIban`) now imports useRecordingDetection.ts,
// whose native module wrapper pulls in expo-modules-core (references the
// RN-global `__DEV__`, undefined under plain node/vitest) — mocked at the
// same module boundary IdScanBlock.test.tsx/IbanScanBlock.test.tsx use.
vi.mock('../../../../modules/screen-recording-detector', () => ({
  isSupported: () => false,
  isCaptured: () => false,
  addCaptureChangeListener: () => ({ remove: () => {} }),
}));
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  TextInput: () => null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// IbanScanBlock.tsx (12-12) now calls useThemeColors() -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too, since this file
// transitively imports IbanScanBlock via useIbanScan.ts's `validateIban`
// import (DiscountBlock.test.tsx / RecommendationBlock.test.tsx precedent).
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { extractIbanCandidate } from './useIbanScan';

describe('extractIbanCandidate (CHKT-02: pure, camera-independent OCR→IBAN-candidate core)', () => {
  it('extracts and normalizes a whitespace-separated IBAN found within a larger recognized-text sample', () => {
    const rawText = 'Bank: Musterbank\nIBAN\nde89 3704 0044 0532 0130 00\nBIC: MSTRDE00';
    expect(extractIbanCandidate(rawText)).toBe('DE89370400440532013000');
  });

  it('uppercases a lowercase, unspaced candidate', () => {
    expect(extractIbanCandidate('de89370400440532013000')).toBe('DE89370400440532013000');
  });

  it('returns null when no IBAN-shaped substring is present', () => {
    const rawText = 'Musterbank\nKontoauszug\nBIC: MSTRDE00';
    expect(extractIbanCandidate(rawText)).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(extractIbanCandidate('')).toBeNull();
  });

  it('extracts a candidate even when its checksum will later fail validateIban (extraction and checksum are separate steps)', () => {
    // Bad checksum (last digit flipped vs. the known-valid sample above) —
    // extraction still shapes it into a candidate; checksum failure is
    // validateIban's job, not extractIbanCandidate's.
    const candidate = extractIbanCandidate('DE89 3704 0044 0532 0130 01');
    expect(candidate).toBe('DE89370400440532013001');
  });
});
