import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (IbanScanBlock.test.tsx precedent) —
// only the pure, exported functions are exercised. IdScanBlock.tsx imports
// 'react-native', '@expo/vector-icons', 'expo-application', 'expo-device',
// 'react-native-vision-camera-ocr-plus', and useIdScan.ts's
// 'react-native-vision-camera' at module scope for its JSX/hook usage, so all
// must be mocked even though the component itself is never rendered.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  TextInput: () => null,
  ScrollView: () => null,
  ActivityIndicator: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}));
vi.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0-test',
}));
vi.mock('expo-device', () => ({
  modelName: 'Test Device',
}));
vi.mock('react-native-vision-camera-ocr-plus', () => ({
  Camera: () => null,
}));
vi.mock('react-native-vision-camera', () => ({
  useCameraDevice: () => undefined,
  useCameraPermission: () => ({ hasPermission: false, requestPermission: async () => false }),
}));
// scanTelemetryRepo.ts (transitively imported) uses expo-crypto — mirrors
// contractsRepo.test.ts's/flowDraftsRepo.test.ts's mocking precedent.
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'ab12cd34-ef56-7890-abcd-ef1234567890') }));
// IdScanBlock.tsx imports openDatabase (native op-sqlite) and getSupabase
// (network client) only to construct the PRODUCTION default resolvers used
// inside the component's event handlers — the exported pure functions under
// test never call these. Mocked purely so the module graph loads in Vitest's
// node environment without pulling in native/network modules.
vi.mock('../../../lib/db/powersync', () => ({ openDatabase: vi.fn() }));
vi.mock('../../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
// IdScanBlock.tsx (this plan) calls useThemeColors() -> ThemeProvider/
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
// D-14b (SEC-05, plan 15-09): IdScanBlock.tsx now imports
// useRecordingDetection.ts, whose native module wrapper transitively pulls
// in expo-modules-core -> react-native (unparseable Flow syntax under
// vitest/node) — mocked at the same module boundary
// useRecordingDetection.test.ts already established.
vi.mock('../../../../modules/screen-recording-detector', () => ({
  isSupported: () => false,
  isCaptured: () => false,
  addCaptureChangeListener: () => ({ remove: () => {} }),
}));

import type { IdFields } from '../scan/useIdScan';
import {
  EMPTY_ID_FIELDS,
  IdConfirmScreen,
  type IdConfirmScreenProps,
  type IdFieldsDraft,
  idFieldsFromScan,
  parseIdFieldsAnswer,
  recordIdScanOutcome,
  resolveScanSessionContext,
  serializeIdFields,
  validateIdFields,
} from './IdScanBlock';
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

const SCANNED_FIELDS: IdFields = {
  surname: 'MUSTERMANN',
  givenNames: 'ERIKA',
  birthDate: '640812',
  documentNumber: 'C01X00T47',
  nationality: 'DEU',
  expiryDate: '291031',
};

describe('serializeIdFields / parseIdFieldsAnswer (D-24 round-trip)', () => {
  it('round-trips a field object through the stringified answer', () => {
    const fields: IdFieldsDraft = { ...EMPTY_ID_FIELDS, ...SCANNED_FIELDS };
    const serialized = serializeIdFields(fields);
    expect(parseIdFieldsAnswer(serialized)).toEqual(fields);
  });

  it('returns EMPTY_ID_FIELDS for an undefined/unset answer', () => {
    expect(parseIdFieldsAnswer(undefined)).toEqual(EMPTY_ID_FIELDS);
  });

  it('returns EMPTY_ID_FIELDS (never throws) for a corrupted stored answer', () => {
    expect(() => parseIdFieldsAnswer('{not json')).not.toThrow();
    expect(parseIdFieldsAnswer('{not json')).toEqual(EMPTY_ID_FIELDS);
  });
});

describe('manual-fallback and scan-confirm converge on the SAME structured shape (D-24)', () => {
  it('idFieldsFromScan(parseIdMrz result) has the identical key set to the manual EMPTY_ID_FIELDS draft', () => {
    const fromScan = idFieldsFromScan(SCANNED_FIELDS);
    expect(Object.keys(fromScan).sort()).toEqual(Object.keys(EMPTY_ID_FIELDS).sort());
  });

  it('a manually-typed draft and a scan-derived draft serialize to the same JSON shape when values match', () => {
    const manualDraft: IdFieldsDraft = { ...EMPTY_ID_FIELDS, ...SCANNED_FIELDS };
    const scanDraft = idFieldsFromScan(SCANNED_FIELDS);
    expect(serializeIdFields(manualDraft)).toBe(serializeIdFields(scanDraft));
  });
});

describe('resolveScanSessionContext (CHKT-04 best-effort context resolution)', () => {
  it('resolves createdBy + teamId when both are available', async () => {
    const context = await resolveScanSessionContext({
      getUserId: async () => 'user-1',
      getTeamIdForUser: async () => 'team-1',
    });
    expect(context).toEqual({ createdBy: 'user-1', teamId: 'team-1' });
  });

  it('returns null (never throws) when the user id is unresolvable', async () => {
    const context = await resolveScanSessionContext({
      getUserId: async () => null,
      getTeamIdForUser: async () => 'team-1',
    });
    expect(context).toBeNull();
  });

  it('returns null when the team id is unresolvable (e.g. no locked territory yet)', async () => {
    const context = await resolveScanSessionContext({
      getUserId: async () => 'user-1',
      getTeamIdForUser: async () => null,
    });
    expect(context).toBeNull();
  });

  it('swallows a resolver rejection and returns null (never blocks the scan/close flow)', async () => {
    const context = await resolveScanSessionContext({
      getUserId: async () => {
        throw new Error('session lookup failed');
      },
      getTeamIdForUser: async () => 'team-1',
    });
    expect(context).toBeNull();
  });
});

describe('recordIdScanOutcome (CHKT-04: telemetry per scan session, injected fake repo)', () => {
  it('records a scan_success event with scan_type=id when a session context resolves', async () => {
    const record = vi.fn(async () => {});
    await recordIdScanOutcome({
      outcome: 'scan_success',
      startedAt: 1_000,
      endedAt: 2_500,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      sessionContext: { createdBy: 'user-1', teamId: 'team-1' },
      repo: { record },
    });

    expect(record).toHaveBeenCalledExactlyOnceWith({
      scanType: 'id',
      outcome: 'scan_success',
      durationMs: 1_500,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      createdBy: 'user-1',
      teamId: 'team-1',
    });
  });

  it('records a manual_fallback event with scan_type=id', async () => {
    const record = vi.fn(async () => {});
    await recordIdScanOutcome({
      outcome: 'manual_fallback',
      startedAt: 0,
      endedAt: 400,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      sessionContext: { createdBy: 'user-1', teamId: 'team-1' },
      repo: { record },
    });

    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scanType: 'id', outcome: 'manual_fallback' }),
    );
  });

  it('is a silent no-op (never calls repo.record) when the session context is unresolved', async () => {
    const record = vi.fn(async () => {});
    await recordIdScanOutcome({
      outcome: 'scan_success',
      startedAt: 0,
      endedAt: 100,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      sessionContext: null,
      repo: { record },
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('swallows a repo.record rejection (best-effort, never rethrows)', async () => {
    const record = vi.fn(async () => {
      throw new Error('db hiccup');
    });
    await expect(
      recordIdScanOutcome({
        outcome: 'scan_success',
        startedAt: 0,
        endedAt: 100,
        deviceModel: 'Pixel 9',
        appVersion: '1.4.0',
        sessionContext: { createdBy: 'user-1', teamId: 'team-1' },
        repo: { record },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('source assertions (D-07: no attachment-queue/media call in the ID-scan path)', () => {
  it('IdScanBlock.tsx never calls createAttachmentQueue/saveFile/MediaLibrary/CameraRoll/direct storage upload', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IdScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(
      /createAttachmentQueue|saveFile|MediaLibrary|CameraRoll|storage\.upload/,
    );
  });

  it('the "Manuell eingeben" control has no attempt-counter/timeout gating (D-06)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IdScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/attemptCount|maxAttempts|setTimeout.*manual/i);
  });

  it('wraps the exported block in ForceLightTheme, never a scheme === "dark" branch (SET-05, T-12-12-02/03)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IdScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/ForceLightTheme/);
    expect(source).not.toMatch(/=== 'dark'|scheme === /);
  });

  it("registers this surface for the D-14c silent screenshot listener via useSensitiveScreen('id') inside IdScanBlockContent (SEC-05, 15-08)", async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IdScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/useSensitiveScreen\('id'\)/);
  });
});

describe('SET-05 hard exception: the ID-scan preview always resolves the light palette (T-12-12-02)', () => {
  // No react-test-renderer in this repo (see the module-mock comment above) —
  // the wrapper's entire observable effect is captured by the pure
  // `resolveThemeColors` resolver directly (mirrors `forceLightTheme.test.tsx`
  // from 12-07 and `SignatureBlock.test.tsx` from this plan).
  it("resolves the light palette even though the provider's preference is 'dark'", () => {
    expect(resolveThemeColors('dark', true, false)).toEqual(themeTestColors);
  });

  it('still resolves the light palette with highContrast true (the accessibility boost never overrides the SET-05 exception)', () => {
    expect(resolveThemeColors('dark', true, true)).toEqual(themeTestColors);
  });
});

describe('validateIdFields (German ID format rules)', () => {
  const valid = {
    surname: 'Mustermann',
    givenNames: 'Erika',
    birthDate: '640812',
    documentNumber: 'T22000129',
    nationality: 'D',
    expiryDate: '12.03.2031',
  };

  it('accepts a fully valid draft (MRZ date + German date both allowed)', () => {
    expect(validateIdFields(valid)).toEqual({});
  });

  it('rejects a document number outside the restricted 9-char alphabet', () => {
    expect(validateIdFields({ ...valid, documentNumber: 'A22000129' }).documentNumber).toBeTruthy(); // A excluded
    expect(validateIdFields({ ...valid, documentNumber: 'T2200012' }).documentNumber).toBeTruthy(); // 8 chars
  });

  it('rejects implausible dates and non-name characters', () => {
    expect(validateIdFields({ ...valid, birthDate: '641345' }).birthDate).toBeTruthy(); // month 13
    expect(validateIdFields({ ...valid, expiryDate: '2031-03-12' }).expiryDate).toBeTruthy();
    expect(validateIdFields({ ...valid, surname: 'Muster1' }).surname).toBeTruthy();
    expect(validateIdFields({ ...valid, givenNames: '' }).givenNames).toBeTruthy();
  });

  it('accepts umlauts and hyphens in names', () => {
    expect(validateIdFields({ ...valid, surname: 'Größmann-Lüdke' })).toEqual({});
  });
});

describe('IdConfirmScreen (D-14b, SEC-05, plan 15-09) — document-preview blanking', () => {
  const block = { id: 'id-field', label: 'Ausweis' } as unknown as IdConfirmScreenProps['block'];
  const baseProps = {
    block,
    draft: EMPTY_ID_FIELDS,
    fieldErrors: {},
    colors: themeTestColors,
    styles: {} as unknown as IdConfirmScreenProps['styles'],
    onUpdateField: vi.fn(),
    onRescan: vi.fn(),
    onConfirm: vi.fn(),
  };

  it("recordingState 'recording': replaces the frozen-frame preview with FieldBlankedForRecording, mounting no frozen-frame view", () => {
    const tree = IdConfirmScreen({ ...baseProps, recordingState: 'recording' });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(1);
    const testIds = collectTestIds(tree);
    expect(testIds).not.toContain(`id-scan-frozen-frame-${block.id}`);
  });

  it("recordingState 'idle': renders exactly as before this plan — the frozen-frame view, no FieldBlankedForRecording", () => {
    const tree = IdConfirmScreen({ ...baseProps, recordingState: 'idle' });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(0);
    expect(collectTestIds(tree)).toContain(`id-scan-frozen-frame-${block.id}`);
  });

  it("recordingState 'unsupported': renders exactly as before this plan — the frozen-frame view, no FieldBlankedForRecording", () => {
    const tree = IdConfirmScreen({ ...baseProps, recordingState: 'unsupported' });
    expect(findAllByElementType(tree, FieldBlankedForRecording)).toHaveLength(0);
    expect(collectTestIds(tree)).toContain(`id-scan-frozen-frame-${block.id}`);
  });

  it('the rescan and confirm CTAs stay rendered while recording — the step is still completable (T-15-09-04)', () => {
    const tree = IdConfirmScreen({ ...baseProps, recordingState: 'recording' });
    const testIds = collectTestIds(tree);
    expect(testIds).toContain(`id-confirm-accept-${block.id}`);
  });

  it('the field return is instant and requires no dismiss: the SAME tree call with idle after a recording call renders the live preview again', () => {
    const recordingTree = IdConfirmScreen({ ...baseProps, recordingState: 'recording' });
    expect(findAllByElementType(recordingTree, FieldBlankedForRecording)).toHaveLength(1);

    const idleTree = IdConfirmScreen({ ...baseProps, recordingState: 'idle' });
    expect(findAllByElementType(idleTree, FieldBlankedForRecording)).toHaveLength(0);
    expect(collectTestIds(idleTree)).toContain(`id-scan-frozen-frame-${block.id}`);
  });
});

describe('source assertions (D-14b: wired via useRecordingDetection, plan 15-09)', () => {
  it("IdScanBlockContent calls useRecordingDetection() and passes recordingState into IdConfirmScreen", async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./IdScanBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/useRecordingDetection\(\)/);
    expect(source).toMatch(/recordingState=\{recordingState\}/);
  });
});
