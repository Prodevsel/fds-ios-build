import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 12-10: SuccessScreen.tsx now calls useMemo() directly in its component body
// (the makeStyles(colors) convention, 12-08). This file invokes
// SuccessScreen(props) as a plain function rather than mounting it (no
// react-test-renderer in this repo, see below) -- outside an actual React
// render pass there is no Fiber/dispatcher installed, so any *real* hook call
// throws. Stub useMemo to just invoke its factory synchronously (no
// memoization, harmless for a single direct call) while keeping every other
// real React export (createElement etc., needed for the JSX below) intact.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useMemo: (factory: () => unknown) => factory() };
});

// No react-test-renderer in this repo — instead of mounting the component,
// we verify the render function throws no error against a mocked
// 'react-native' + i18n surface (StatusSheet.test.tsx precedent), and assert
// the composed props/behavior are wired correctly by invoking the JSX
// element's prop callbacks directly (mirrors ContractListScreen.test.tsx's
// posture: this repo tests pure logic, not rendered DOM).
// `react-native-pdf` ships untranspiled JSX in its CommonJS entry, so Vite
// cannot even parse it during import analysis — SuccessScreen.tsx:4 imports it
// at module scope, which is enough to fail this whole file at load time.
// Mocked, like every other native module here; nothing under test renders it.
vi.mock('react-native-pdf', () => ({ default: () => null }));
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// SuccessScreen.tsx transitively imports the ui/ primitives, which (since
// 12-08) call useThemeColors() -> ThemeProvider/AccessibilityProvider's own
// native deps — mocked here too (AccessibilityProvider.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// 12-10: SuccessScreen.tsx itself now calls useThemeColors() directly. This
// file invokes SuccessScreen(props) as a plain function (no react-test-
// renderer in this repo) rather than mounting it inside a ThemeProvider, so
// React's hook dispatcher is never installed -- useContext would throw. Mock
// the hook module itself to return the shared themeTestColors fixture
// (12-08's `lightColors` re-export), sidestepping React's hook machinery
// entirely while keeping the exact same colour values a real light-mode
// render would resolve.
vi.mock('../settings/theme/useThemeColors', async () => {
  const { themeTestColors } = await import('../settings/theme/themeTestColors');
  return { useThemeColors: () => themeTestColors };
});
// The reskinned SuccessScreen composes the shared ui/ components + icons; mock
// the native icon set (ContractListScreen.test.tsx precedent) so the pure
// render-function assertions below never load the native module.
// Safe-area boundary mock kept even though SuccessScreen no longer calls
// useSafeAreaInsets() (see the "double inset" test below): the real entry
// point pulls in native code that cannot load under the node test env, and a
// transitive import re-introducing it must not turn into a native crash.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

import { SuccessScreen } from './SuccessScreen';
import { t } from '../../i18n';

describe('SuccessScreen (D-11/D-12: post-signing confirmation)', () => {
  it('renders the German headline, deal reference, customer name, and the pending transfer hint', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Max Mustermann',
      syncPending: true,
      onExit: vi.fn(),
    });

    const json = JSON.stringify(element);
    expect(json).toContain(t('checkout.successHeading'));
    expect(json).toContain('FDS-20260723-ABCDEF12');
    expect(json).toContain('Max Mustermann');
    // Honest-about-sync: while queued locally it says "Wird übertragen, sobald
    // Netz da ist", never that it is already uploaded (D-12).
    expect(json).toContain(t('checkout.successTransferHint'));
    expect(json).toContain(t('checkout.successPdfHint'));
  });

  it('renders the transferred hint (and never the pending one) when syncPending is false', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Max Mustermann',
      syncPending: false,
      onExit: vi.fn(),
    });

    const json = JSON.stringify(element);
    expect(json).toContain(t('checkout.successTransferDone'));
    expect(json).not.toContain(t('checkout.successTransferHint'));
  });

  it('composes the address · customer · product · price summary line from the frozen values', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Sabine Krüger',
      productName: 'Strom 24',
      priceMonthly: 36.5,
      addressLine: 'Musterstraße 14',
      syncPending: true,
      onExit: vi.fn(),
    });

    const json = JSON.stringify(element);
    expect(json).toContain('Musterstraße 14');
    expect(json).toContain('Strom 24');
    // formatEur(36.5) -> "36,50 €"
    expect(json).toContain('36,50');
  });

  // H02/D-5: every price the app shows carries the net-price note. The note is
  // produced INSIDE this screen from data it already receives — both callers
  // (FlowRunnerScreen, DirectSignFlowScreen) are owned elsewhere, so a new prop
  // threaded through them was never an option.
  it('carries the net-price note next to the monthly price, with no new prop', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Sabine Krüger',
      productName: 'smaica Plus',
      priceMonthly: 199,
      syncPending: true,
      onExit: vi.fn(),
    });

    const json = JSON.stringify(element);
    expect(json).toContain(`${t('abschluesse.perMonth')} ${t('price.netNote')}`);
  });

  it('shows no net-price note when the flow froze no price', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Sabine Krüger',
      syncPending: true,
      onExit: vi.fn(),
    });

    expect(JSON.stringify(element)).not.toContain(t('price.netNote'));
  });

  it('the primary CTA calls onExit', () => {
    const onExit = vi.fn();
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Max Mustermann',
      syncPending: true,
      onExit,
    });

    const primaryButton = findByText(element, t('checkout.successPrimaryCta'));
    primaryButton.props.onPress();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the secondary CTA calls onViewContracts when provided', () => {
    const onExit = vi.fn();
    const onViewContracts = vi.fn();
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Max Mustermann',
      syncPending: true,
      onExit,
      onViewContracts,
    });

    const secondaryButton = findByText(element, t('checkout.successSecondaryCta'));
    secondaryButton.props.onPress();
    expect(onViewContracts).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('omits the secondary CTA entirely when onViewContracts is not provided', () => {
    const element = SuccessScreen({
      dealReference: 'FDS-20260723-ABCDEF12',
      customerName: 'Max Mustermann',
      syncPending: true,
      onExit: vi.fn(),
    });

    expect(() => findByText(element, t('checkout.successSecondaryCta'))).toThrow();
  });
});

/**
 * Source-level, AppLockGate.test.tsx's precedent: there is no renderer in this
 * repo that could measure a padding, so the double-inset defect is pinned
 * where it is actually decidable — in the source.
 *
 * Both of this screen's mount points (FlowRunnerScreen, DirectSignFlowScreen)
 * render inside StatusSheet's fullScreen Modal, whose wrapper already applies
 * `paddingTop: sheetInsets.top` / `paddingBottom: sheetInsets.bottom`. A
 * second inset here is a doubled status bar, not chrome.
 */
describe('SuccessScreen never applies a safe-area inset of its own (its mount already did)', () => {
  const source = readFileSync(fileURLToPath(new URL('./SuccessScreen.tsx', import.meta.url)), 'utf8');

  it('does not call useSafeAreaInsets', () => {
    expect(source).not.toMatch(/useSafeAreaInsets/);
  });

  it('does not import react-native-safe-area-context at all', () => {
    expect(source).not.toMatch(/react-native-safe-area-context/);
  });

  it("StatusSheet's fullScreen Modal wrapper is still the one applying the inset", () => {
    const statusSheet = readFileSync(
      fileURLToPath(new URL('../map/StatusSheet.tsx', import.meta.url)),
      'utf8',
    );
    expect(statusSheet).toMatch(/paddingTop:\s*sheetInsets\.top/);
    expect(statusSheet).toMatch(/paddingBottom:\s*sheetInsets\.bottom/);
  });
});

/**
 * Minimal React-element-tree finder — 'react-native' is mocked to plain
 * string tag names (not react-test-renderer), so SuccessScreen() returns a
 * plain nested object tree of `{ type, props: { children, ... } }` nodes.
 * Finds the nearest 'Pressable' ancestor whose flattened text content
 * equals `text` exactly.
 */
interface ElementLike {
  type?: unknown;
  props?: { children?: unknown; onPress?: () => void; title?: string };
}

function flattenText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (node && typeof node === 'object') {
    const children = (node as ElementLike).props?.children;
    return children !== undefined ? flattenText(children) : '';
  }
  return '';
}

function findPressableByText(node: unknown, text: string): { props: { onPress: () => void } } {
  const el = node as ElementLike | null;
  if (!el || typeof el !== 'object') {
    throw new Error(`no button found containing text: ${text}`);
  }
  // The CTAs are shared ui/ <Button title=… onPress=… /> elements: match by the
  // `title` prop (Button carries no text children), falling back to a raw
  // Pressable's flattened text content for any legacy button.
  const hasPress = typeof el.props?.onPress === 'function';
  if (hasPress && (el.props?.title === text || flattenText(el).trim() === text)) {
    return el as { props: { onPress: () => void } };
  }
  const children = el.props?.children;
  const flatChildren = Array.isArray(children) ? children : children !== undefined ? [children] : [];
  for (const child of flatChildren) {
    try {
      return findPressableByText(child, text);
    } catch {
      // keep searching siblings
    }
  }
  throw new Error(`no button found containing text: ${text}`);
}

function findByText(node: unknown, text: string): { props: { onPress: () => void } } {
  return findPressableByText(node, text);
}
