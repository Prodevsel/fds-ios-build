import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { contrastRatio } from '../../design/contrast';
import { darkColors, lightColors } from '../../design/tokens';
import de from '../../i18n/de.json';

// No react-native-testing-library in this repo — test the exported pure/DI'd
// functions directly, never mount the component. Mirrors
// ChangePasswordScreen.test.ts's stub set exactly (same transitive chain:
// Card/Button/useThemeColors), even though none of it is ever actually
// invoked here.
vi.mock('react-native', () => ({
  KeyboardAvoidingView: () => null,
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: vi.fn(), navigate: vi.fn() }),
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import {
  deriveOutcomeCopyKey,
  splitDeletionRequestBody,
  submitDeletionRequest,
} from './AccountDeletionRequestScreen';

const BODY = de['sec.deletionRequestBody'];

describe('splitDeletionRequestBody (pure)', () => {
  it('splits the shipped German body into an intro and the § 257 HGB retention sentence', () => {
    const { intro, retention } = splitDeletionRequestBody(BODY);
    expect(intro).not.toContain('§ 257 HGB');
    expect(retention).toContain('§ 257 HGB');
    expect(retention).toContain('§ 147 AO');
    expect(retention).toContain('NICHT gelöscht');
  });

  it('falls back to treating the whole body as intro (no crash) if the anchor sentence is absent', () => {
    const { intro, retention } = splitDeletionRequestBody('Some copy with no legal anchor at all.');
    expect(intro).toBe('Some copy with no legal anchor at all.');
    expect(retention).toBe('');
  });
});

describe('deriveOutcomeCopyKey (pure)', () => {
  it('maps "recorded" to sec.deletionRequestSent — the ONLY outcome that does', () => {
    expect(deriveOutcomeCopyKey('recorded')).toBe('sec.deletionRequestSent');
  });

  it('maps "already_pending" to its own truthful copy, never the success key', () => {
    const key = deriveOutcomeCopyKey('already_pending');
    expect(key).toBe('sec.deletionRequestAlreadyPending');
    expect(key).not.toBe('sec.deletionRequestSent');
  });

  it('maps "offline" and "error" to the same generic retry copy, neither ever the success key', () => {
    expect(deriveOutcomeCopyKey('offline')).toBe('sec.deletionRequestErrorGeneric');
    expect(deriveOutcomeCopyKey('error')).toBe('sec.deletionRequestErrorGeneric');
  });

  it('maps null (no outcome yet) to null', () => {
    expect(deriveOutcomeCopyKey(null)).toBeNull();
  });
});

describe('submitDeletionRequest (pure/DI)', () => {
  it('calls repo.submit(null) exactly once and returns the outcome verbatim', async () => {
    const submit = vi.fn(async () => 'recorded' as const);
    const outcome = await submitDeletionRequest({ submit });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(null);
    expect(outcome).toBe('recorded');
  });
});

describe('sec.deletionRequestBody copy (shipped de.json content)', () => {
  it('contains the exact substrings § 257 HGB, § 147 AO, and NICHT gelöscht', () => {
    expect(BODY).toContain('§ 257 HGB');
    expect(BODY).toContain('§ 147 AO');
    expect(BODY).toContain('NICHT gelöscht');
  });

  it('never claims the account, a session, or a contract has already been deleted', () => {
    expect(BODY).not.toMatch(/Konto (wurde|ist) gelöscht/);
    expect(de['sec.deletionRequestSent']).not.toContain('gelöscht');
    expect(de['sec.deletionRequestAlreadyPending']).not.toContain('gelöscht');
  });
});

describe('AccountDeletionRequestScreen.tsx (source-level structural proofs — no react-native-testing-library in this repo)', () => {
  const source = readFileSync(
    new URL('./AccountDeletionRequestScreen.tsx', import.meta.url),
    'utf-8',
  );

  it('never renders a hardcoded "Konto löschen" copy string — every label goes through t()', () => {
    expect(source).not.toContain('Konto löschen');
  });

  it('never imports Modal — confirmation uses the lighter inline tier only', () => {
    expect(source).not.toMatch(/\bModal\b/);
  });

  it('renders the retention emphasis run at fontWeight 600 in a destructive-toned text color, distinct from the surrounding body style', () => {
    expect(source).toMatch(/retentionEmphasis:\s*\{[^}]*fontWeight:\s*'600'[^}]*color:\s*colors\.destructiveText/s);
    expect(source).toMatch(/\bbody:\s*\{[^}]*color:\s*colors\.textPrimary/s);
  });

  it('never truncates the retention copy — no line-count-limiting prop anywhere on this screen', () => {
    expect(source).not.toContain('numberOfLines');
  });

  it('the emphasis run clears the 4.5:1 AA contrast floor against colors.surface in both light and dark themes', () => {
    expect(contrastRatio(lightColors.destructiveText, lightColors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.destructiveText, darkColors.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
