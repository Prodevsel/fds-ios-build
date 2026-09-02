import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo (TextField.test.tsx /
// ResetPasswordScreen.test.ts precedent) — test the exported pure
// `deriveTenantBadgeLabel` directly, never mount the component.
// TenantBadge.tsx imports react-native at module scope, plus
// useThemeColors.ts's transitive chain (ThemeProvider/AccessibilityProvider
// -> useSessionDb/settingsCache/expo-localization) — stubbed here even
// though none of it is ever actually invoked (this file never mounts the
// component).
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { readFileSync } from 'node:fs';
import { deriveTenantBadgeLabel } from './TenantBadge';

describe('deriveTenantBadgeLabel', () => {
  it('returns the loading key when not ready, even with a tenant name already known', () => {
    expect(deriveTenantBadgeLabel({ ready: false, tenantName: 'Acme GmbH' })).toBe(
      'sessions.tenantNameLoading',
    );
  });

  it('returns the loading key when ready but the name is an empty string — not a valid name', () => {
    expect(deriveTenantBadgeLabel({ ready: true, tenantName: '' })).toBe('sessions.tenantNameLoading');
  });

  it('returns the loading key when ready but the name is null', () => {
    expect(deriveTenantBadgeLabel({ ready: true, tenantName: null })).toBe('sessions.tenantNameLoading');
  });

  it('returns the tenant name once ready with a non-empty name', () => {
    expect(deriveTenantBadgeLabel({ ready: true, tenantName: 'Acme GmbH' })).toBe('Acme GmbH');
  });
});

describe('TenantBadge.tsx is informational chrome, not a button (T-14-09-*)', () => {
  const source = readFileSync(new URL('./TenantBadge.tsx', import.meta.url), 'utf8');

  it('contains no Pressable', () => {
    expect(source).not.toMatch(/Pressable/);
  });

  it('contains no onPress', () => {
    expect(source).not.toMatch(/onPress/);
  });

  it('contains no accessibilityRole="button"', () => {
    expect(source).not.toMatch(/accessibilityRole=["']button["']/);
  });

  it('never references colors.accent', () => {
    expect(source).not.toMatch(/colors\.accent/);
  });
});
