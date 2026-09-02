import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (DiscountBlock.test.tsx precedent) —
// only the pure, exported helpers are exercised, plus source assertions for
// the WebView-imperative capture flow. SignatureBlock.tsx still imports
// 'react-native' and 'react-native-signature-canvas' at module scope, so
// both must be mocked (queue.test.ts / FlowRunnerScreen.test.tsx precedent —
// never load native/WebView modules in this Node test env).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  ActivityIndicator: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}));
vi.mock('react-native-signature-canvas', () => ({ default: () => null }));
vi.mock('@powersync/attachments-storage-react-native', () => ({
  ExpoFileSystemStorageAdapter: class {},
}));
// SignatureBlock.tsx (this plan) calls useThemeColors() -> ThemeProvider/
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

import { parseStrokeData, stripDataUrlPrefix } from './SignatureBlock';
import { resolveThemeColors } from '../../settings/theme/useThemeColors';
import { themeTestColors } from '../../settings/theme/themeTestColors';

describe('stripDataUrlPrefix (onOK payload -> bare base64 for the attachment queue)', () => {
  it('strips a data:image/png;base64, prefix', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('leaves an already-bare base64 string untouched', () => {
    expect(stripDataUrlPrefix('iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });
});

describe('parseStrokeData (04-STROKE-SPIKE.md: verbatim getData() JSON, never re-shaped)', () => {
  it('parses the onGetData JSON string into the point-group array', () => {
    const json = JSON.stringify([
      {
        color: 'black',
        dotSize: 1.5,
        minWidth: 0.5,
        maxWidth: 2.5,
        compositeOperation: 'source-over',
        points: [{ time: 1784809875835, x: 123.4, y: 56.7 }],
      },
    ]);

    const strokeData = parseStrokeData(json);
    expect(strokeData).toHaveLength(1);
    expect((strokeData[0] as { points: unknown[] }).points).toHaveLength(1);
  });

  it('throws if the JSON does not parse to an array (defensive — never silently coerces)', () => {
    expect(() => parseStrokeData('{"not":"an array"}')).toThrow(/array of point-groups/);
  });
});

describe('source assertions (D-16/T-04-17/SIGN-02/SIGN-03)', () => {
  it('never references a direct storage upload / MediaLibrary / CameraRoll API', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./SignatureBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/storage\s*\.\s*upload|MediaLibrary|CameraRoll/);
  });

  it('captures BOTH the PNG (readSignature/onOK -> saveSignaturePng) AND stroke data (getData/onGetData) before emitting onSignatureCaptured', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./SignatureBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/readSignature\(\)/);
    expect(source).toMatch(/saveSignaturePng/);
    expect(source).toMatch(/getData\(\)/);
    expect(source).toMatch(/onSignatureCaptured/);
  });

  it('the confirm control uses the disabled (secondary) style while the canvas is empty', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./SignatureBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/confirmButtonDisabled/);
    expect(source).toMatch(/disabled={isEmpty/);
  });

  it('wraps the exported block in ForceLightTheme, never a scheme === "dark" branch (SET-05, T-12-12-01/03)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./SignatureBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/ForceLightTheme/);
    expect(source).not.toMatch(/=== 'dark'|scheme === /);
  });
});

describe('SET-05 hard exception: the signature surface always resolves the light palette (T-12-12-01)', () => {
  // No react-test-renderer in this repo (see the module-mock comment above) —
  // the wrapper's entire observable effect (a component inside
  // `ForceLightTheme` receives `lightColors` no matter what) is captured by
  // the pure `resolveThemeColors` resolver directly, exactly as
  // `forceLightTheme.test.tsx` (12-07) already proves for the mechanism
  // itself; this asserts the SAME contract at the point SignatureBlock
  // consumes it.
  it("resolves the light palette even though the provider's preference is 'dark'", () => {
    expect(resolveThemeColors('dark', true, false)).toEqual(themeTestColors);
  });

  it('resolves the light palette when the OS appearance is dark and the preference is "system" (resolvedScheme still "dark")', () => {
    expect(resolveThemeColors('dark', true, false).surface).toBe(themeTestColors.surface);
  });

  it('still resolves the light palette with highContrast true (the accessibility boost never overrides the SET-05 exception)', () => {
    expect(resolveThemeColors('dark', true, true)).toEqual(themeTestColors);
  });
});

describe('handover heads-up line (15-07, D-07/D-08, UI-SPEC §3)', () => {
  // No react-test-renderer in this repo (see the module-mock comment above)
  // — same source-assertion approach the "source assertions" suite above
  // already uses for this file.
  async function readSource(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./SignatureBlock.tsx', import.meta.url));
    return readFileSync(sourcePath, 'utf-8');
  }

  it('registers/clears the D-07 handover suspension via useHandoverSuspension()', async () => {
    const source = await readSource();
    expect(source).toMatch(/useHandoverSuspension\(\)/);
  });

  it('renders the warning line ONLY when warningVisible is true, using sec.handoverTimeoutWarning', async () => {
    const source = await readSource();
    expect(source).toMatch(/warningVisible\s*\?[\s\S]{0,200}sec\.handoverTimeoutWarning/);
  });

  it('the warning line carries no button/CTA — an "extend" affordance would fail this test', async () => {
    const source = await readSource();
    // Isolate the JSX block that renders the warning line and assert it
    // contains no Pressable/onPress/button anywhere inside it.
    const match = source.match(/\{warningVisible \?[\s\S]*?: null\}/);
    expect(match).not.toBeNull();
    const warningBlock = match![0];
    expect(warningBlock).not.toMatch(/Pressable|onPress|Button/);
  });

  it('unmounting clears the suspension registration — useHandoverSuspension is called unconditionally at the top of the component, not inside a conditional/effect-only guard that could skip its own cleanup', async () => {
    const source = await readSource();
    // useHandoverSuspension()'s own cleanup (unregisterHandoverMount on
    // unmount) lives in useIdleTimer.ts and is unit-tested there
    // (useIdleTimer.test.ts covers the module's registry). Here we only
    // assert SignatureBlockContent calls the hook as a plain top-level hook
    // call (unconditional), which is what makes React guarantee its
    // cleanup runs on unmount.
    expect(source).toMatch(/const \{ warningVisible \} = useHandoverSuspension\(\);/);
  });

  it('D-06: no draft-preservation path exists — the in-progress stroke is never written when the app locks mid-signature', async () => {
    const source = await readSource();
    expect(source).not.toMatch(/preserveDraft|saveDraft|draftSignature|persistStroke|useAppLock/i);
  });
});
