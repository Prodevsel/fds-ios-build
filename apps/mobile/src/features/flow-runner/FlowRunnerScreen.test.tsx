import { visibleBlocks } from '@frontdoorsales/flow-schema';
import type { Block } from '@frontdoorsales/flow-schema';
import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (StatusSheet.test.tsx precedent) — the
// wizard's business logic lives in pure, exported, DI'd async functions
// (advance/back/jump/complete), tested directly against a fake repo, never
// by mounting the component tree. FlowRunnerScreen.tsx and its block
// children still IMPORT 'react-native' at module scope (for their JSX), so
// the native module must be mocked here even though only pure functions are
// exercised below (mirrors MapScreen.test.tsx/StatusSheet.test.tsx).
// `react-native-pdf` ships untranspiled JSX in its CommonJS entry, so Vite
// cannot even parse it during import analysis — SuccessScreen.tsx:4 imports it
// at module scope, which is enough to fail this whole file at load time.
// Mocked, like every other native module here; nothing under test renders it.
vi.mock('react-native-pdf', () => ({ default: () => null }));
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  TextInput: () => null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// FlowRunnerScreen.tsx and its block children transitively import the ui/
// primitives, which (since 12-08) call useThemeColors() -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too
// (AccessibilityProvider.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'fixed-uuid'),
  digestStringAsync: vi.fn(async (_algorithm: unknown, data: string) => `sha256:${data.length}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
// 04-07: FlowRunnerScreen now imports getSupabase (lib/auth/supabase.ts,
// module-level expo-secure-store import) and the signature attachment queue
// (transitively @powersync/attachments-storage-react-native's Expo File
// System adapter) — both native-module surfaces must be mocked here, same
// rationale as the react-native mock above (never load native Expo/RN
// modules in this Node test env, queue.test.ts precedent).
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn(() => ({})) }));
vi.mock('@powersync/attachments-storage-react-native', () => ({
  ExpoFileSystemStorageAdapter: class {},
}));
vi.mock('react-native-signature-canvas', () => ({ default: () => null }));
// 04-06: IbanScanBlock now pulls in the real camera/OCR/icon native modules
// for its JSX (Phase-4 real scan) — mocked here too even though only pure
// functions are exercised below (mirrors the react-native mock above).
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// SuccessScreen (imported for the terminal step) calls useSafeAreaInsets()
// directly since quick task 260827-f98, and the real
// react-native-safe-area-context entry point is unparseable under the node
// test env. Zero insets keep every asserted value at its prior baseline.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// The Belehrung/IBAN blocks render the InfoSheet HintRow, which pulls
// react-native-safe-area-context transitively too. Pure logic only is tested
// here, so stub the QoL UI module (same pattern as the other native mocks).
vi.mock('../../ui/InfoSheet', () => ({
  HintRow: () => null,
  InfoSheet: () => null,
  InfoSheetSection: () => null,
  InfoLegendRow: () => null,
  InfoIconButton: () => null,
  buildStatusLegend: () => [],
}));
vi.mock('react-native-vision-camera-ocr-plus', () => ({ Camera: () => null }));
vi.mock('./scan/useIbanScan', () => ({
  useIbanScan: () => ({
    device: undefined,
    hasPermission: false,
    permissionDenied: false,
    handleRecognizedText: vi.fn(),
    validIban: null,
    resetValidIban: vi.fn(),
  }),
}));
// 04-05: IdScanBlock.tsx (rendered via FlowRunnerScreen's renderBlock) pulls
// in the real camera/device stack at module scope (Phase 4 CHKT-01) — the
// non-duplicate module surfaces are mocked here purely so this file's module
// graph loads (vector-icons/ocr-plus/supabase are already mocked above).
vi.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0-test',
  getAndroidId: vi.fn(() => 'android-id-test'),
  getIosIdForVendorAsync: vi.fn(async () => 'ios-idfv-test'),
}));
vi.mock('expo-device', () => ({ modelName: 'Test Device' }));
// 04-08: FlowRunnerScreen now pulls in getDeviceId.ts (expo-secure-store
// fallback path) and getSignatureLocation.ts (expo-location) transitively —
// both are native-module surfaces, mocked here per the same rationale as
// the mocks above (getDeviceId.test.ts / encryption.test.ts precedent).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 0 } })),
  PermissionStatus: { GRANTED: 'granted' },
  LocationAccuracy: { Balanced: 3 },
}));
vi.mock('react-native-vision-camera', () => ({
  useCameraDevice: () => undefined,
  useCameraPermission: () => ({ hasPermission: false, requestPermission: async () => false }),
}));
vi.mock('../../lib/db/powersync', () => ({ openDatabase: vi.fn() }));
// D-14b (SEC-05, plan 15-09): IdScanBlock.tsx/IbanScanBlock.tsx (rendered by
// FlowRunnerScreen) now import useRecordingDetection.ts, whose native module
// wrapper pulls in expo-modules-core (references the RN-global `__DEV__`,
// undefined under plain node/vitest) — mocked at the same module boundary
// IdScanBlock.test.tsx/IbanScanBlock.test.tsx use.
vi.mock('../../../modules/screen-recording-detector', () => ({
  isSupported: () => false,
  isCaptured: () => false,
  addCaptureChangeListener: () => ({ remove: () => {} }),
}));

import {
  type FlowRunnerRepo,
  answerAndAdvance,
  captureSnapshot,
  clampToUnconfirmedGate,
  collectConfirmedGateBlocks,
  completeFlow,
  completeSigning,
  decodeJwtIatClaim,
  deriveContractId,
  deriveSignatureSummary,
  getServerTimeAnchorFromSession,
  startFlow,
} from './FlowRunnerScreen';
import { firstUnconfirmedGateIndex } from './StepOverview';
import { pruneInvalidatedAnswers } from '@frontdoorsales/flow-schema';
import type { ContractsRepo, InsertContractInput, InsertContractResult } from './db/contractsRepo';
import type { CompletionSnapshot } from './db/flowDraftsRepo';
import type { ProductDefinitionRow } from './db/productDefinitionsRepo';
import type { ProductDefinitionsSource } from './useFlowDraft';

// Test fixture labels are deliberately ASCII-only English placeholders (not
// the real German copy) — this file matches the flow-runner *.tsx glob the
// plan's own no-hardcoded-German-literal source-assertion grep runs
// against, so an umlaut or a literal nav-button word here would be a false
// positive against that check.
/** A trimmed, English-labeled mirror of products/glasfaser-home/v1.json's block sequence (D-06/D-13). */
const EXAMPLE_BLOCKS: Block[] = [
  { type: 'text', id: 'intro', label: 'Welcome', gate: false },
  {
    type: 'choice',
    id: 'device-count',
    label: 'How many devices?',
    gate: false,
    options: [
      { value: 'few', label: '1-3' },
      { value: 'many', label: 'more than 6' },
    ],
  },
  {
    type: 'slider',
    id: 'speed-tier',
    label: 'Speed tier',
    gate: false,
    min: 100,
    max: 1000,
    step: 50,
  },
  {
    type: 'discount',
    id: 'door-discount',
    label: 'Your door advantage',
    gate: false,
    showIf: [{ field: 'speed-tier', operator: 'gte', value: 250 }],
    termsRef: 'terms-1',
    showComparisonPrice: true,
    emphasize: true,
  },
];

interface FakeDraftState {
  status: string;
  answers: Record<string, unknown>;
  snapshot?: unknown;
}

function fakeRepo(): FlowRunnerRepo & { draft: FakeDraftState } {
  const draft: FakeDraftState = { status: 'in_progress', answers: {} };
  return {
    draft,
    getDraftForHouse: vi.fn(async () => null),
    insertDraft: vi.fn(async () => 'draft-1'),
    saveAnswer: vi.fn(async (_draftId: string, fieldId: string, value: unknown) => {
      draft.answers[fieldId] = value;
    }),
    markCompleted: vi.fn(async (_draftId: string, snapshot: unknown) => {
      draft.status = 'completed';
      draft.snapshot = snapshot;
    }),
    // Gap 2B (03-UAT.md) persist-on-capture primitive (D-04 auto-save) —
    // mirrors markCompleted's fake but deliberately does NOT touch status.
    saveSnapshot: vi.fn(async (_draftId: string, snapshot: unknown) => {
      draft.snapshot = snapshot;
    }),
    discardDraft: vi.fn(async () => {}),
  };
}

interface FakeFlowDraftRow {
  id: string;
  created_by: string;
  house_id: string | null;
  product_definition_id: string | null;
  product_version: number | null;
  terms_id: string | null;
  terms_version: number | null;
  territory_id: string | null;
  status: 'in_progress' | 'completed' | 'discarded';
  answers: Record<string, unknown>;
  is_test: boolean;
  snapshot_door_price: number | null;
  snapshot_comparison_price: number | null;
  snapshot_discount_amount: number | null;
  snapshot_terms_text: string | null;
  created_at: string;
  updated_at: string;
}

// Allows the resume-seeding regression tests to construct a draft row with
// populated snapshot_* columns so snapshotFromDraftRow (Gap 2B) yields a real
// CompletionSnapshot, without repeating the full row shape in every test.
function fakeDraftRow(overrides: Partial<FakeFlowDraftRow> = {}): FakeFlowDraftRow {
  return {
    id: 'existing-draft',
    created_by: 'user-1',
    house_id: 'house-1',
    product_definition_id: 'product-1',
    product_version: 1,
    terms_id: null,
    terms_version: null,
    territory_id: null,
    status: 'in_progress',
    answers: { intro: 'already answered' },
    is_test: false,
    snapshot_door_price: null,
    snapshot_comparison_price: null,
    snapshot_discount_amount: null,
    snapshot_terms_text: null,
    created_at: '2026-07-22T00:00:00Z',
    updated_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

function fakeProductRow(overrides: Partial<ProductDefinitionRow> = {}): ProductDefinitionRow {
  return {
    id: 'product-1',
    company_id: 'company-1',
    slug: 'glasfaser-home',
    version: 1,
    status: 'published',
    contract_mode: 'flow_form',
    direct_sign_template_id: null,
    blocks: EXAMPLE_BLOCKS,
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

function fakeProductDefinitionsRepo(
  overrides: Partial<ProductDefinitionsSource> = {},
): ProductDefinitionsSource {
  return {
    getLatestPublished: vi.fn(async () => fakeProductRow()),
    getVersion: vi.fn(async () => fakeProductRow()),
    ...overrides,
  };
}

describe('FlowRunnerScreen end-to-end happy path (D-01/D-04/D-19, MVP gate)', () => {
  it('steps through the example product block-by-block and completes with a frozen discount snapshot', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo();

    const { draftId, answers: initialAnswers } = await startFlow({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });
    expect(draftId).toBe('draft-1');
    expect(repo.insertDraft).toHaveBeenCalledTimes(1);

    let answers = initialAnswers;
    let currentIndex = 0;

    const stepAnswers: Array<[string, unknown]> = [
      ['intro', ''],
      ['device-count', 'few'],
      ['speed-tier', 500],
    ];

    for (const [fieldId, value] of stepAnswers) {
      // D-13: the just-given answer can itself flip a later block's show-if
      // (speed-tier gates the discount block) — the clamp bound must use the
      // block list AFTER this answer (mirrors FlowRunnerScreen.handleAnswer).
      const updatedAnswers = { ...answers, [fieldId]: value };
      const visibleAfter = visibleBlocks(EXAMPLE_BLOCKS, updatedAnswers);
      currentIndex = await answerAndAdvance({
        repo,
        draftId,
        fieldId,
        value,
        currentIndex,
        lastIndex: visibleAfter.length - 1,
      });
      answers = updatedAnswers;
    }

    // speed-tier=500 >= 250 makes the discount block visible (D-13 show-if).
    const visibleAfterSpeed = visibleBlocks(EXAMPLE_BLOCKS, answers);
    expect(visibleAfterSpeed.map((b) => b.id)).toContain('door-discount');
    expect(currentIndex).toBe(visibleAfterSpeed.length - 1);

    // The discount snapshot is frozen by DiscountBlock at render/confirm time
    // (D-19/Pitfall 4) BEFORE completion — supplied here exactly as
    // FlowRunnerScreen forwards it, never recomputed by completeFlow itself.
    const snapshot = {
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'terms text',
      termsId: 'terms-1',
      termsVersion: 1,
    };

    await completeFlow({ repo, draftId, snapshot });

    expect(repo.markCompleted).toHaveBeenCalledWith('draft-1', snapshot);
    expect(repo.draft.status).toBe('completed');
    expect(repo.draft.snapshot).toEqual(snapshot);
  });

  it('resumes an existing in_progress draft for the house, re-reading its pinned version (D-04/D-09)', async () => {
    const repo = fakeRepo();
    repo.getDraftForHouse = vi.fn(async () => fakeDraftRow());
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 5 })), // newer version exists...
      getVersion: vi.fn(async () => fakeProductRow({ version: 1 })), // ...pinned v1 must still be re-read
    });

    const result = await startFlow({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.draftId).toBe('existing-draft');
    expect(result.answers).toEqual({ intro: 'already answered' });
    expect(result.productVersion).toBe(1);
    expect(repo.insertDraft).not.toHaveBeenCalled();
    expect(productDefinitionsRepo.getVersion).toHaveBeenCalledWith('glasfaser-home', 1);
    expect(productDefinitionsRepo.getLatestPublished).not.toHaveBeenCalled();
    // Gap 2B (03-UAT.md): no snapshot columns populated on this row yet.
    expect(result.snapshot).toBeNull();
  });
});

describe('Gap 2B regression coverage (03-UAT.md Test 5): frozen discount snapshot survives a remount', () => {
  const CAPTURED_SNAPSHOT: CompletionSnapshot = {
    doorPrice: 34.99,
    comparisonPrice: 49.99,
    discountAmount: 15.0,
    termsText: 'terms text',
    termsId: 'terms-1',
    termsVersion: 1,
  };

  it('captureSnapshot persists the frozen snapshot via repo.saveSnapshot exactly once, unchanged (persist-on-capture)', async () => {
    const repo = fakeRepo();

    await captureSnapshot({ repo, draftId: 'draft-1', captured: CAPTURED_SNAPSHOT });

    expect(repo.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(repo.saveSnapshot).toHaveBeenCalledWith('draft-1', CAPTURED_SNAPSHOT);
  });

  it('a resumed draft carrying a populated snapshot is the value forwarded to completeFlow, never EMPTY_SNAPSHOT (re-hydration reaches completion)', async () => {
    const repo = fakeRepo();
    repo.getDraftForHouse = vi.fn(async () =>
      fakeDraftRow({
        terms_id: 'terms-1',
        terms_version: 1,
        snapshot_door_price: 34.99,
        snapshot_comparison_price: 49.99,
        snapshot_discount_amount: 15.0,
        snapshot_terms_text: 'terms text',
      }),
    );
    const productDefinitionsRepo = fakeProductDefinitionsRepo();

    // Simulates the screen's load-then-complete path: seed = result.snapshot
    // ?? EMPTY_SNAPSHOT, then completeFlow forwards that seed unchanged.
    const result = await startFlow({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });
    const EMPTY_SNAPSHOT: CompletionSnapshot = {
      doorPrice: 0,
      comparisonPrice: null,
      discountAmount: null,
      termsText: '',
      termsId: '',
      termsVersion: 0,
    };
    const seed = result.snapshot ?? EMPTY_SNAPSHOT;

    await completeFlow({ repo, draftId: result.draftId, snapshot: seed });

    expect(repo.markCompleted).toHaveBeenCalledWith('existing-draft', CAPTURED_SNAPSHOT);
    expect(repo.draft.snapshot).not.toEqual(EMPTY_SNAPSHOT);
  });

  it('a snapshot-less resume falls back to EMPTY_SNAPSHOT until captureSnapshot upgrades it before completion', async () => {
    const repo = fakeRepo();
    repo.getDraftForHouse = vi.fn(async () => fakeDraftRow()); // no snapshot columns populated
    const productDefinitionsRepo = fakeProductDefinitionsRepo();

    const EMPTY_SNAPSHOT: CompletionSnapshot = {
      doorPrice: 0,
      comparisonPrice: null,
      discountAmount: null,
      termsText: '',
      termsId: '',
      termsVersion: 0,
    };

    const result = await startFlow({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });
    let seed = result.snapshot ?? EMPTY_SNAPSHOT;
    expect(seed).toEqual(EMPTY_SNAPSHOT);

    // The discount block resolves mid-flow — captureSnapshot persists AND
    // upgrades the local seed before completion (mirrors handleSnapshotCaptured).
    await captureSnapshot({ repo, draftId: result.draftId, captured: CAPTURED_SNAPSHOT });
    seed = CAPTURED_SNAPSHOT;

    await completeFlow({ repo, draftId: result.draftId, snapshot: seed });

    expect(repo.markCompleted).toHaveBeenCalledWith('existing-draft', CAPTURED_SNAPSHOT);
    expect(repo.draft.snapshot).not.toEqual(EMPTY_SNAPSHOT);
  });
});

describe('deriveSignatureSummary (D-16: signature handover summary strip, no new fetch)', () => {
  const SNAPSHOT: CompletionSnapshot = {
    doorPrice: 34.99,
    comparisonPrice: 49.99,
    discountAmount: 15.0,
    termsText: 'terms text',
    termsId: 'terms-1',
    termsVersion: 1,
  };

  it('reads the customer name from the id-scan block answer, product name from the slug, price from the frozen snapshot', () => {
    const blocksWithIdentity: Block[] = [
      ...EXAMPLE_BLOCKS,
      { type: 'id-scan', id: 'identity', label: 'ID', gate: false },
    ];
    const summary = deriveSignatureSummary({
      answers: { identity: 'Max Mustermann' },
      blocks: blocksWithIdentity,
      snapshot: SNAPSHOT,
      productSlug: 'glasfaser-home',
    });

    expect(summary).toEqual({
      customerName: 'Max Mustermann',
      productName: 'glasfaser-home',
      price: 34.99,
    });
  });

  it('falls back to an empty customer name when no id-scan block/answer exists yet', () => {
    const summary = deriveSignatureSummary({
      answers: {},
      blocks: EXAMPLE_BLOCKS,
      snapshot: SNAPSHOT,
      productSlug: 'glasfaser-home',
    });

    expect(summary.customerName).toBe('');
  });

  it('CR-01 regression: parses the JSON-serialized D-24 structured id-scan answer into a display name, never renders the raw JSON', () => {
    const blocksWithIdentity: Block[] = [
      ...EXAMPLE_BLOCKS,
      { type: 'id-scan', id: 'identity', label: 'ID', gate: false },
    ];
    const rawAnswer = JSON.stringify({
      surname: 'Mustermann',
      givenNames: 'Erika',
      birthDate: '1990-01-01',
      documentNumber: 'C1234567L',
      nationality: 'DEU',
      expiryDate: '2030-01-01',
    });

    const summary = deriveSignatureSummary({
      answers: { identity: rawAnswer },
      blocks: blocksWithIdentity,
      snapshot: SNAPSHOT,
      productSlug: 'glasfaser-home',
    });

    expect(summary.customerName).toBe('Erika Mustermann');
    expect(summary.customerName).not.toContain('{');
  });
});

/**
 * English-labeled mirror of products/glasfaser-home/v1.json's REAL block
 * ordering (D-06/D-13, same ASCII-only convention as EXAMPLE_BLOCKS above):
 * intro, device-count, speed-tier, iban(iban-scan), identity(id-scan), then
 * the withdrawal-notice belehrung GATE, then door-discount (visible once
 * speed-tier >= 250), then the signature GATE.
 */
const REAL_PRODUCT_BLOCKS: Block[] = [
  { type: 'text', id: 'intro', label: 'Welcome', gate: false },
  {
    type: 'choice',
    id: 'device-count',
    label: 'How many devices?',
    gate: false,
    options: [{ value: 'few', label: '1-3' }],
  },
  { type: 'slider', id: 'speed-tier', label: 'Speed tier', gate: false, min: 100, max: 1000, step: 50 },
  { type: 'iban-scan', id: 'iban', label: 'IBAN', gate: false, optional: false },
  { type: 'id-scan', id: 'identity', label: 'ID', gate: false },
  {
    type: 'belehrung',
    id: 'withdrawal-notice',
    label: 'Widerrufsbelehrung',
    gate: true,
    noticeText: 'Right of withdrawal notice text.',
  },
  {
    type: 'discount',
    id: 'door-discount',
    label: 'Door advantage',
    gate: false,
    showIf: [{ field: 'speed-tier', operator: 'gte', value: 250 }],
    termsRef: 'terms-1',
    showComparisonPrice: true,
    emphasize: true,
  },
  { type: 'signature', id: 'signature', label: 'Sign', gate: true },
];

/**
 * Mirrors FlowRunnerScreen.handleAnswer's exact computation (answerAndAdvance
 * then clampToUnconfirmedGate against the AFTER-answer visible list/answers)
 * — driving the pure functions directly, no react-test-renderer (repo
 * convention). Returns the resulting { answers, currentIndex } so a test can
 * chain multiple answers in sequence.
 */
async function driveAnswer(
  repo: FlowRunnerRepo,
  draftId: string,
  blocks: Block[],
  answers: Record<string, unknown>,
  currentIndex: number,
  fieldId: string,
  value: unknown,
): Promise<{ answers: Record<string, unknown>; currentIndex: number }> {
  const updatedAnswers = { ...answers, [fieldId]: value };
  const visibleAfter = visibleBlocks(blocks, updatedAnswers);
  const prunedAnswers = pruneInvalidatedAnswers(blocks, updatedAnswers);
  const updatedLastIndex = Math.max(0, visibleAfter.length - 1);
  const nextIndex = await answerAndAdvance({
    repo,
    draftId,
    fieldId,
    value,
    currentIndex,
    lastIndex: updatedLastIndex,
  });
  const gateClampedIndex = clampToUnconfirmedGate(nextIndex, visibleAfter, prunedAnswers);
  return { answers: prunedAnswers, currentIndex: gateClampedIndex };
}

describe('SIGN-01: signature step unreachable (jump AND linear advance) until withdrawal-notice is confirmed, real glasfaser-home ordering', () => {
  // speed-tier=100 (< 250) keeps door-discount hidden throughout — the
  // relevant visible-list indices (not the raw REAL_PRODUCT_BLOCKS indices,
  // which still count the hidden door-discount block) are derived the same
  // way FlowRunnerScreen itself does, via visibleBlocks.
  const VISIBLE_WITH_DOOR_DISCOUNT_HIDDEN = visibleBlocks(REAL_PRODUCT_BLOCKS, { 'speed-tier': 100 });
  const WITHDRAWAL_NOTICE_INDEX = VISIBLE_WITH_DOOR_DISCOUNT_HIDDEN.findIndex((b) => b.id === 'withdrawal-notice');
  const SIGNATURE_INDEX = VISIBLE_WITH_DOOR_DISCOUNT_HIDDEN.findIndex((b) => b.id === 'signature');

  it('the LINEAR forward-advance path cannot reach the signature block before the belehrung is confirmed', async () => {
    const repo = fakeRepo();
    let answers: Record<string, unknown> = {};
    let currentIndex = 0;

    const steps: Array<[string, unknown]> = [
      ['intro', ''],
      ['device-count', 'few'],
      ['speed-tier', 100], // < 250, door-discount stays hidden — simplest path to the gate
      ['iban', 'DE00000000000000000000'],
    ];
    for (const [fieldId, value] of steps) {
      ({ answers, currentIndex } = await driveAnswer(repo, 'draft-1', REAL_PRODUCT_BLOCKS, answers, currentIndex, fieldId, value));
    }
    // Now active at 'identity' (id-scan) — one step before the gate.
    ({ answers, currentIndex } = await driveAnswer(
      repo,
      'draft-1',
      REAL_PRODUCT_BLOCKS,
      answers,
      currentIndex,
      'identity',
      'Max Mustermann',
    ));
    // currentIndex now AT withdrawal-notice — attempting to advance WITHOUT
    // confirming it (a hypothetical/defensive case — the real BelehrungBlock
    // component only ever emits `true`) must NOT cross the gate.
    ({ answers, currentIndex } = await driveAnswer(
      repo,
      'draft-1',
      REAL_PRODUCT_BLOCKS,
      answers,
      currentIndex,
      'withdrawal-notice',
      false,
    ));
    expect(currentIndex).toBe(WITHDRAWAL_NOTICE_INDEX);
    expect(currentIndex).not.toBe(SIGNATURE_INDEX);
    expect(firstUnconfirmedGateIndex(visibleBlocks(REAL_PRODUCT_BLOCKS, answers), answers)).toBe(
      WITHDRAWAL_NOTICE_INDEX,
    );
  });

  it('the signature step becomes reachable via linear advance once the withdrawal-notice belehrung is confirmed', async () => {
    const repo = fakeRepo();
    let answers: Record<string, unknown> = {};
    let currentIndex = 0;

    const steps: Array<[string, unknown]> = [
      ['intro', ''],
      ['device-count', 'few'],
      ['speed-tier', 100],
      ['iban', 'DE00000000000000000000'],
      ['identity', 'Max Mustermann'],
      ['withdrawal-notice', true], // the ONLY value BelehrungBlock ever emits
    ];
    for (const [fieldId, value] of steps) {
      ({ answers, currentIndex } = await driveAnswer(repo, 'draft-1', REAL_PRODUCT_BLOCKS, answers, currentIndex, fieldId, value));
    }
    // door-discount hidden (speed-tier=100 < 250) — the very next block after
    // the confirmed gate is signature itself.
    expect(currentIndex).toBe(SIGNATURE_INDEX);
  });

  it('the signature index is NOT jumpable via the step overview while withdrawal-notice is unconfirmed (StepOverview.canJumpTo)', () => {
    const gateIdx = firstUnconfirmedGateIndex(REAL_PRODUCT_BLOCKS, {});
    expect(gateIdx).toBe(WITHDRAWAL_NOTICE_INDEX);
  });
});

describe('collectConfirmedGateBlocks (D-17: per-notice hash inputs)', () => {
  const GATE_BLOCKS: Block[] = [
    { type: 'belehrung', id: 'withdrawal-notice', label: 'Widerrufsbelehrung', gate: true, noticeText: 'notice text A' },
    { type: 'belehrung', id: 'unconfirmed-notice', label: 'Other notice', gate: false, noticeText: 'notice text B' },
  ];

  it('includes only belehrung blocks confirmed (true) in answers, carrying their exact noticeText', () => {
    const result = collectConfirmedGateBlocks(GATE_BLOCKS, { 'withdrawal-notice': true, 'unconfirmed-notice': false });
    expect(result).toEqual([{ blockId: 'withdrawal-notice', noticeText: 'notice text A' }]);
  });

  it('returns an empty list when no belehrung block is confirmed yet', () => {
    expect(collectConfirmedGateBlocks(GATE_BLOCKS, {})).toEqual([]);
  });
});

describe('decodeJwtIatClaim / getServerTimeAnchorFromSession (D-20/T-04-09)', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const base64url = (input: string) =>
      Buffer.from(input, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify(payload))}.signature`;
  }

  it('decodes only the iat claim from a well-formed JWT', () => {
    const token = makeJwt({ iat: 1784809800, sub: 'user-1' });
    expect(decodeJwtIatClaim(token)).toBe(1784809800);
  });

  it('returns null for a malformed token rather than throwing', () => {
    expect(decodeJwtIatClaim('not-a-jwt')).toBeNull();
    expect(decodeJwtIatClaim('')).toBeNull();
  });

  it('returns null when the payload has no numeric iat', () => {
    const token = makeJwt({ sub: 'user-1' });
    expect(decodeJwtIatClaim(token)).toBeNull();
  });

  it('getServerTimeAnchorFromSession resolves { iat, source } from a live session', async () => {
    const token = makeJwt({ iat: 1784809800 });
    const anchor = await getServerTimeAnchorFromSession(async () => ({
      data: { session: { access_token: token } },
    }));
    expect(anchor).toEqual({ iat: 1784809800, source: 'supabase-jwt' });
  });

  it('getServerTimeAnchorFromSession resolves null when there is no session, never throwing', async () => {
    const anchor = await getServerTimeAnchorFromSession(async () => ({ data: { session: null } }));
    expect(anchor).toBeNull();
  });

  it('getServerTimeAnchorFromSession resolves null (not throws) if getSession itself rejects', async () => {
    const anchor = await getServerTimeAnchorFromSession(async () => {
      throw new Error('network down');
    });
    expect(anchor).toBeNull();
  });
});

describe('completeSigning (SIGN-03/D-10/D-12: offline audit package + frozen append-only contract insert)', () => {
  const GATE_BLOCKS: Block[] = [
    ...EXAMPLE_BLOCKS,
    { type: 'id-scan', id: 'identity', label: 'ID', gate: false },
    {
      type: 'belehrung',
      id: 'withdrawal-notice',
      label: 'Widerrufsbelehrung',
      gate: true,
      noticeText: 'Sie haben das Recht, binnen vierzehn Tagen zu widerrufen.',
    },
    { type: 'signature', id: 'signature', label: 'Sign', gate: true },
  ];

  const SNAPSHOT: CompletionSnapshot = {
    doorPrice: 34.99,
    comparisonPrice: 49.99,
    discountAmount: 15.0,
    termsText: 'terms text',
    termsId: 'terms-1',
    termsVersion: 1,
  };

  const ANSWERS: Record<string, unknown> = {
    intro: '',
    'device-count': 'few',
    'speed-tier': 500,
    identity: 'Max Mustermann',
    'withdrawal-notice': true,
    signature: true,
  };

  function fakeContractsRepo(
    overrides: Partial<ContractsRepo> = {},
  ): ContractsRepo & { insertContract: ReturnType<typeof vi.fn> } {
    const insertContract = vi.fn(
      async (input: InsertContractInput): Promise<InsertContractResult> => ({
        id: 'contract-1',
        dealReference: input.dealReference ?? 'FDS-20260723-FIXEDUU1',
      }),
    );
    return {
      insertContract,
      listContracts: vi.fn(async () => []),
      watchContracts: vi.fn(() => () => {}),
      ...overrides,
    } as ContractsRepo & { insertContract: ReturnType<typeof vi.fn> };
  }

  function baseDeps(
    contractsRepo: ReturnType<typeof fakeContractsRepo>,
    overrides: Partial<Parameters<typeof completeSigning>[0]> = {},
  ): Parameters<typeof completeSigning>[0] {
    return {
      repo: fakeRepo(),
      contractsRepo,
      getDeviceId: vi.fn(async () => ({ deviceId: 'device-uuid-1234', deviceIdSource: 'idfv' as const })),
      getSignatureLocation: vi.fn(
        async (): Promise<import('../../lib/location/getSignatureLocation').SignatureLocationResult> => ({
          gps: { lat: 52.52, lng: 13.405, accuracyM: 5 },
        }),
      ),
      getServerTimeAnchor: vi.fn(async () => ({ iat: 1784809800, source: 'supabase-jwt' as const })),
      digestFn: vi.fn(async (data: string) => `sha256:${data.length}`),
      generateUuid: vi.fn(() => 'fixed-uuid'),
      now: vi.fn(() => new Date('2026-07-23T10:00:00.000Z')),
      ...overrides,
    };
  }

  function baseParams(
    overrides: Partial<Parameters<typeof completeSigning>[1]> = {},
  ): Parameters<typeof completeSigning>[1] {
    return {
      draftId: 'draft-1',
      companyId: 'company-1',
      repId: 'user-1',
      teamId: 'team-1',
      productDefinitionId: 'product-1',
      productVersion: 1,
      answers: ANSWERS,
      blocks: GATE_BLOCKS,
      snapshot: SNAPSHOT,
      signatureCapture: { signatureAttachmentId: 'attachment-1', strokeData: [{ points: [{ time: 1, x: 1, y: 1 }] }] },
      ...overrides,
    };
  }

  it('assembles the full SIGN-03 audit package offline and inserts exactly one frozen, notice-gated contract', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps(contractsRepo);
    const params = baseParams();

    const result = await completeSigning(deps, params);

    expect(deps.repo.markCompleted).toHaveBeenCalledTimes(1);
    expect(contractsRepo.insertContract).toHaveBeenCalledTimes(1);
    const insertedInput = contractsRepo.insertContract.mock.calls[0]![0] as InsertContractInput;

    expect(insertedInput.companyId).toBe('company-1');
    expect(insertedInput.repId).toBe('user-1');
    expect(insertedInput.teamId).toBe('team-1');
    expect(insertedInput.productDefinitionId).toBe('product-1');
    expect(insertedInput.productVersion).toBe(1);
    expect(insertedInput.signatureAttachmentId).toBe('attachment-1');
    expect(insertedInput.signedAtIso).toBe('2026-07-23T10:00:00.000Z');

    const pkg = insertedInput.auditPackage as Record<string, unknown>;
    expect(pkg.documentHashSha256).toEqual(expect.any(String));
    expect(pkg.signedAtIso).toBe('2026-07-23T10:00:00.000Z');
    expect(pkg.serverTimeAnchor).toEqual({ iat: 1784809800, source: 'supabase-jwt' });
    expect(pkg.deviceId).toBe('device-uuid-1234');
    expect(pkg.deviceIdSource).toBe('idfv');
    expect(pkg.gps).toEqual({ lat: 52.52, lng: 13.405, accuracyM: 5 });
    expect(pkg.confirmedGates).toEqual([
      {
        blockId: 'withdrawal-notice',
        confirmedAtIso: '2026-07-23T10:00:00.000Z',
        noticeTextSha256: expect.any(String),
      },
    ]);
    expect(pkg.signatureStrokeData).toEqual(params.signatureCapture.strokeData);
    expect(insertedInput.packageHashSha256).toEqual(expect.any(String));

    expect(result.dealReference).toBe(insertedInput.dealReference);
  });

  it('a gps:null run still completes the insert (D-04 GPS-never-blocks-signing)', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps(contractsRepo, {
      getSignatureLocation: vi.fn(
        async (): Promise<import('../../lib/location/getSignatureLocation').SignatureLocationResult> => ({
          gps: null,
          reason: 'permission-denied',
        }),
      ),
    });
    const params = baseParams();

    await completeSigning(deps, params);

    const insertedInput = contractsRepo.insertContract.mock.calls[0]![0] as InsertContractInput;
    const pkg = insertedInput.auditPackage as Record<string, unknown>;
    expect(pkg.gps).toBeNull();
  });

  it('never places the raw access token/session anywhere in the audit package (only iat via serverTimeAnchor)', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps(contractsRepo);
    const params = baseParams();

    await completeSigning(deps, params);

    const insertedInput = contractsRepo.insertContract.mock.calls[0]![0] as InsertContractInput;
    const serialized = JSON.stringify(insertedInput.auditPackage);
    // A raw JWT is three base64url segments joined by dots — assert none present.
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });

  it('CR-02: marks the draft completed ONLY AFTER the contract insert resolves, never before', async () => {
    const callOrder: string[] = [];
    const repo = fakeRepo();
    repo.markCompleted = vi.fn(async () => {
      callOrder.push('markCompleted');
    });
    const contractsRepo = fakeContractsRepo({
      insertContract: vi.fn(async (input: InsertContractInput): Promise<InsertContractResult> => {
        callOrder.push('insertContract');
        return { id: 'contract-1', dealReference: input.dealReference ?? 'FDS-20260723-FIXEDUU1' };
      }),
    });
    const deps = baseDeps(contractsRepo, { repo });
    const params = baseParams();

    await completeSigning(deps, params);

    expect(callOrder).toEqual(['insertContract', 'markCompleted']);
  });

  it('CR-02: derives the SAME contract id for the same draftId across retries (INSERT OR IGNORE idempotency key), and a different id for a different draft', async () => {
    const contractsRepo = fakeContractsRepo();
    // baseDeps' default digestFn hashes by `data.length` only (irrelevant to
    // the other assertions in this suite) — this test needs a
    // content-sensitive digest to prove deriveContractId varies per draftId.
    const contentDigestFn = async (data: string) => `sha256:${[...data].reduce((acc, c) => acc + c.charCodeAt(0), 0)}`;
    const deps = baseDeps(contractsRepo, { digestFn: contentDigestFn });

    await completeSigning(deps, baseParams({ draftId: 'draft-1' }));
    await completeSigning(deps, baseParams({ draftId: 'draft-1' }));
    await completeSigning(deps, baseParams({ draftId: 'draft-2' }));

    const ids = contractsRepo.insertContract.mock.calls.map(
      (call) => (call[0] as InsertContractInput).id,
    );
    expect(ids[0]).toBe(ids[1]); // same draft, two calls (e.g. a retry) -> same id
    expect(ids[0]).not.toBe(ids[2]); // different draft -> different id
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('deriveContractId (CR-02: deterministic per-draft idempotency key, pure)', () => {
  const digestFn = async (data: string) => `sha256:${data}:padded-out-to-look-like-a-real-hex-digest-1234567890abcdef`;

  it('is a valid-shaped v4 UUID string', async () => {
    const id = await deriveContractId('draft-1', digestFn);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is deterministic — the same draftId always derives the same id', async () => {
    const first = await deriveContractId('draft-abc', digestFn);
    const second = await deriveContractId('draft-abc', digestFn);
    expect(first).toBe(second);
  });

  it('derives a different id for a different draftId', async () => {
    const a = await deriveContractId('draft-a', digestFn);
    const b = await deriveContractId('draft-b', digestFn);
    expect(a).not.toBe(b);
  });
});
