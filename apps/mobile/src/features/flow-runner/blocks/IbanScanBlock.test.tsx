import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (DiscountBlock.test.tsx precedent) —
// only the pure, exported functions are exercised. IbanScanBlock.tsx now
// pulls in the real camera/OCR/icon native modules for its JSX plus
// scanTelemetry — all mocked here even though the component itself is never
// rendered.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  TextInput: () => null,
  ScrollView: () => null,
  ActivityIndicator: () => null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// IbanScanBlock now renders the InfoSheet HintRow (IBAN-encrypted reassurance);
// InfoSheet pulls react-native-safe-area-context transitively. Only pure logic
// is tested here, so stub the UI module (same pattern as the mocks above).
vi.mock('../../../ui/InfoSheet', () => ({ HintRow: () => null }));
vi.mock('react-native-vision-camera-ocr-plus', () => ({ Camera: () => null }));
vi.mock('../scan/useIbanScan', () => ({
  useIbanScan: () => ({
    device: undefined,
    hasPermission: false,
    permissionDenied: false,
    handleRecognizedText: vi.fn(),
    validIban: null,
    resetValidIban: vi.fn(),
  }),
}));
// IbanScanBlock.tsx (this plan) calls useThemeColors() -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too
// (DiscountBlock.test.tsx / RecommendationBlock.test.tsx precedent).
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// D-14b (SEC-05, plan 15-09): IbanScanBlock.tsx now imports
// useRecordingDetection.ts, whose native module wrapper transitively pulls
// in expo-modules-core -> react-native (unparseable Flow syntax under
// vitest/node) — mocked at the same module boundary
// useRecordingDetection.test.ts/IdScanBlock.test.tsx already established.
vi.mock('../../../../modules/screen-recording-detector', () => ({
  isSupported: () => false,
  isCaptured: () => false,
  addCaptureChangeListener: () => ({ remove: () => {} }),
}));

import {
  IbanConfirmScreen,
  type IbanConfirmScreenProps,
  recordIbanScanTelemetry,
  validateIban,
} from './IbanScanBlock';
import { FieldBlankedForRecording } from '../../app-lock/screenProtection/FieldBlankedForRecording';
import { resolveThemeColors } from '../../settings/theme/useThemeColors';
import { themeTestColors } from '../../settings/theme/themeTestColors';

interface ReactElementLike {
  type: unknown;
  props: { children?: unknown; [key: string]: unknown };
}

function isElement(value: unknown): value is ReactElementLike {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

/** Walks a real React-element tree (createElement output, never rendered) collecting every node of `elementType`. */
function findAllByElementType(node: unknown, elementType: unknown): ReactElementLike[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findAllByElementType(child, elementType));
  }
  if (!isElement(node)) {
    return [];
  }
  const self = node.type === elementType ? [node] : [];
  return [...self, ...findAllByElementType(node.props.children, elementType)];
}

/** Collects every plain-string `children` value found anywhere in the tree — used to prove no Text node carries the IBAN value while blanked. */
function collectTextChildren(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectTextChildren(child, acc);
    return acc;
  }
  if (typeof node === 'string') {
    acc.push(node);
    return acc;
  }
  if (!isElement(node)) {
    return acc;
  }
  collectTextChildren(node.props.children, acc);
  return acc;
}

/** Collects every `testID` prop value present anywhere in the tree, regardless of element type. */
function collectTestIds(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectTestIds(child, acc);
    return acc;
  }
  if (!isElement(node)) {
    return acc;
  }
  if (typeof node.props.testID === 'string') {
    acc.push(node.props.testID);
  }
  collectTestIds(node.props.children, acc);
  return acc;
}

describe('validateIban (D-06/CHKT-03: ibantools checksum, not hand-rolled)', () => {
  it('accepts a known-valid IBAN, normalizing whitespace and case', () => {
    const result = validateIban('de89 3704 0044 0532 0130 00');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('DE89370400440532013000');
  });

  it('rejects a bad-checksum IBAN and blocks advance', () => {
    const result = validateIban('DE89370400440532013001');
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed (too-short) input', () => {
    const result = validateIban('DE1234');
    expect(result.valid).toBe(false);
  });
});

describe('source assertion (no hand-rolled mod-97 checksum)', () => {
  it('imports and calls ibantools.isValidIBAN', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IbanScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/from 'ibantools'/);
    expect(source).toMatch(/isValidIBAN/);
  });

  it('never writes to an attachment queue / storage (no IBAN image retained, T-04-16/T-04-14)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IbanScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/createAttachmentQueue|saveFile|storage\.upload|MediaLibrary/);
  });

  it('wraps the exported block in ForceLightTheme, never a scheme === "dark" branch (SET-05, T-12-12-02/03)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IbanScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/ForceLightTheme/);
    expect(source).not.toMatch(/=== 'dark'|scheme === /);
  });

  it("registers this surface for the D-14c silent screenshot listener via useSensitiveScreen('iban') inside IbanScanBlockContent (SEC-05, 15-08)", async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IbanScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/useSensitiveScreen\('iban'\)/);
  });
});

describe('SET-05 hard exception: the IBAN-scan preview always resolves the light palette (T-12-12-02)', () => {
  // No react-test-renderer in this repo (see the module-mock comment above) —
  // the wrapper's entire observable effect is captured by the pure
  // `resolveThemeColors` resolver directly (mirrors `forceLightTheme.test.tsx`
  // from 12-07 and `SignatureBlock.test.tsx`/`IdScanBlock.test.tsx` from this
  // plan).
  it("resolves the light palette even though the provider's preference is 'dark'", () => {
    expect(resolveThemeColors('dark', true, false)).toEqual(themeTestColors);
  });

  it('still resolves the light palette with highContrast true (the accessibility boost never overrides the SET-05 exception)', () => {
    expect(resolveThemeColors('dark', true, true)).toEqual(themeTestColors);
  });
});

describe('scan-confirm and manual entry converge on the same normalized IBAN answer (D-08/CHKT-03)', () => {
  it('scan-confirm path: validateIban on the confirm-screen draft yields the same normalized value as manual entry', () => {
    const scanConfirmDraft = 'de89 3704 0044 0532 0130 00'; // OCR-read, editable on the confirm screen
    const manualDraft = 'DE89370400440532013000'; // typed directly

    const fromScanConfirm = validateIban(scanConfirmDraft);
    const fromManual = validateIban(manualDraft);

    expect(fromScanConfirm.valid).toBe(true);
    expect(fromManual.valid).toBe(true);
    expect(fromScanConfirm.normalized).toBe(fromManual.normalized);
  });
});

describe('recordIbanScanTelemetry (CHKT-04: one event per session, best-effort)', () => {
  const baseParams = {
    startedAt: 1_000,
    endedAt: 4_500,
    deviceModel: 'Pixel 9',
    appVersion: '1.4.0',
    createdBy: 'user-1',
    teamId: 'team-1',
  };

  it('records a scan_type=iban / outcome=scan_success event for the camera-confirm path', async () => {
    const record = vi.fn(async () => {});
    await recordIbanScanTelemetry({ telemetryRepo: { record }, outcome: 'scan_success', ...baseParams });

    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scanType: 'iban', outcome: 'scan_success', durationMs: 3_500 }),
    );
  });

  it('records a scan_type=iban / outcome=manual_fallback event for the manual-entry path', async () => {
    const record = vi.fn(async () => {});
    await recordIbanScanTelemetry({ telemetryRepo: { record }, outcome: 'manual_fallback', ...baseParams });

    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scanType: 'iban', outcome: 'manual_fallback' }),
    );
  });

  it('records a scan_type=iban / outcome=aborted event when the session ends without an accept', async () => {
    const record = vi.fn(async () => {});
    await recordIbanScanTelemetry({ telemetryRepo: { record }, outcome: 'aborted', ...baseParams });

    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ scanType: 'iban', outcome: 'aborted' }));
  });

  it('never blocks/rethrows to the caller when the injected repo rejects (best-effort, D-14)', async () => {
    const record = vi.fn(async () => {
      throw new Error('db hiccup');
    });

    await expect(
      recordIbanScanTelemetry({ telemetryRepo: { record }, outcome: 'scan_success', ...baseParams }),
    ).resolves.toBeUndefined();
  });
});

describe('IbanConfirmScreen (D-14b, SEC-05, plan 15-09) — IBAN-value blanking', () => {
  const block = { id: 'iban-field', label: 'Bankverbindung' } as unknown as IbanConfirmScreenProps['block'];
  const IBAN_VALUE = 'DE89370400440532013000';
  const baseProps = {
    block,
    colors: themeTestColors,
    styles: {} as unknown as IbanConfirmScreenProps['styles'],
    confirmDraft: IBAN_VALUE,
    ibanRevealed: true, // revealed=true is the WORST case: the raw TextInput value would otherwise be present
    onChangeConfirmDraft: vi.fn(),
    onToggleReveal: vi.fn(),
    onRescan: vi.fn(),
    onConfirm: vi.fn(),
  };

  it("recordingState 'recording': renders FieldBlankedForRecording and NO text node containing the IBAN value (revealed=true, the worst case)", () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'recording' });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(1);
    const textChildren = collectTextChildren(tree);
    expect(textChildren.some((text) => text.includes(IBAN_VALUE))).toBe(false);
  });

  it("recordingState 'recording' with revealed=false (masked): still renders FieldBlankedForRecording and no masked/derived IBAN text", () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'recording', ibanRevealed: false });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(1);
    const testIds = collectTestIds(tree);
    expect(testIds).not.toContain(`iban-confirm-input-${block.id}`);
  });

  it("recordingState 'recording': hides the reveal toggle — revealing would defeat the blank (no way to un-blank via the UI)", () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'recording' });
    const testIds = collectTestIds(tree);
    expect(testIds).not.toContain(`iban-reveal-${block.id}`);
  });

  it("recordingState 'idle': renders exactly as before this plan — the revealed input, no FieldBlankedForRecording", () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'idle' });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(0);
    const testIds = collectTestIds(tree);
    expect(testIds).toContain(`iban-confirm-input-${block.id}`);
    expect(testIds).toContain(`iban-reveal-${block.id}`);
  });

  it("recordingState 'unsupported': renders exactly as before this plan — the masked box, no FieldBlankedForRecording", () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'unsupported', ibanRevealed: false });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(0);
    const testIds = collectTestIds(tree);
    expect(testIds).toContain(`iban-reveal-${block.id}`);
  });

  it('the rescan and confirm CTAs stay rendered while recording — the step is still completable (T-15-09-04)', () => {
    const tree = IbanConfirmScreen({ ...baseProps, recordingState: 'recording' });
    const testIds = collectTestIds(tree);
    expect(testIds).toContain(`iban-rescan-${block.id}`);
    expect(testIds).toContain(`iban-confirm-accept-${block.id}`);
  });

  it('the field return is instant and requires no dismiss: the SAME props re-derived with idle after recording render the live value again', () => {
    const recordingTree = IbanConfirmScreen({ ...baseProps, recordingState: 'recording' });
    expect(findAllByElementType(recordingTree, FieldBlankedForRecording)).toHaveLength(1);

    const idleTree = IbanConfirmScreen({ ...baseProps, recordingState: 'idle' });
    expect(findAllByElementType(idleTree, FieldBlankedForRecording)).toHaveLength(0);
    expect(collectTestIds(idleTree)).toContain(`iban-confirm-input-${block.id}`);
  });
});

describe('source assertions (D-14b: wired via useRecordingDetection, plan 15-09)', () => {
  it('IbanScanBlockContent calls useRecordingDetection() and passes recordingState into IbanConfirmScreen', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IbanScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/useRecordingDetection\(\)/);
    expect(source).toMatch(/recordingState=\{recordingState\}/);
  });
});
