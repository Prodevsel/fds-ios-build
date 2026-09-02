import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (DiscountBlock.test.tsx / StatusSheet.test.tsx
// precedent) — only the pure, exported functions are exercised. ContactBlock.tsx
// still imports 'react-native' at module scope for its JSX, so it must be mocked.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  TextInput: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// The block's CTA is the shared ui/ Button, whose useThemeColors() ->
// ThemeProvider chain pulls in native deps; mock the whole module.
vi.mock('../../../ui/Button', () => ({ Button: () => null }));
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { canAdvanceContact, shouldShowContactError } from './ContactBlock';

describe('canAdvanceContact (T-MQB-01: only a complete, valid contact value may commit)', () => {
  it('blocks the one-character prefix that per-keystroke onAnswer used to persist', () => {
    expect(canAdvanceContact('email', 's', true)).toBe(false);
  });

  it('allows a finished, valid email address', () => {
    expect(canAdvanceContact('email', 'kunde@firma.de', true)).toBe(true);
  });

  it('blocks a required field with an empty draft (D-01: "empty" is not "ok")', () => {
    expect(canAdvanceContact('email', '', true)).toBe(false);
    expect(canAdvanceContact('email', '   ', true)).toBe(false);
  });

  it('allows an empty draft on an optional field — no answer is a legitimate answer', () => {
    expect(canAdvanceContact('email', '', false)).toBe(true);
  });

  it('allows a German landline written with a slash separator', () => {
    expect(canAdvanceContact('phone', '07152/123456', true)).toBe(true);
  });

  it('blocks a phone draft that is still too short to be a number', () => {
    expect(canAdvanceContact('phone', '071', true)).toBe(false);
  });

  it('allows a plain name', () => {
    expect(canAdvanceContact('name', 'Anna Musterfrau', true)).toBe(true);
  });
});

describe('shouldShowContactError (an untouched or still-blank field is never scolded)', () => {
  it('stays silent while the field has not been touched', () => {
    expect(shouldShowContactError('email', 's', true, null, 'email')).toBe(false);
  });

  it('stays silent on a touched-but-blank draft (that is help-text territory, not an error)', () => {
    expect(shouldShowContactError('email', '', true, 'email', 'email')).toBe(false);
    expect(shouldShowContactError('email', '  ', true, 'email', 'email')).toBe(false);
  });

  it('reports a touched draft that is genuinely invalid', () => {
    expect(shouldShowContactError('email', 's', true, 'email', 'email')).toBe(true);
  });

  it('stays silent once the touched draft has become valid', () => {
    expect(shouldShowContactError('email', 'kunde@firma.de', true, 'email', 'email')).toBe(false);
  });

  /**
   * The device-reported direct-sign fault: tapping "Weiter" on `customerName`
   * moved the flow to `email`, and the email block came up already red with
   * "E-Mail ungueltig". The draft and the touched flag belonged to the PREVIOUS
   * block — the hosts render one block per step from the same tree slot, so an
   * unkeyed slot let React reuse this component across the step change.
   */
  it('never scolds a block the rep typed nothing into, even holding the previous block draft', () => {
    expect(shouldShowContactError('email', 'Anna Musterfrau', true, 'customerName', 'email')).toBe(
      false,
    );
  });

  it('still scolds the block that was actually typed into', () => {
    expect(shouldShowContactError('email', 'Anna Musterfrau', true, 'email', 'email')).toBe(true);
  });
});

describe('source contract (the advance-on-keystroke bug must not come back)', () => {
  it('calls onAnswer exactly once, and only from the CTA onPress — never from onChangeText', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./ContactBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');

    expect(source.match(/onAnswer\(/g)?.length).toBe(1);
    expect(source).toMatch(/onPress=\{\(\) =>[\s\S]{0,40}onAnswer\(/);

    // The onChangeText handler body must not reach onAnswer.
    const onChangeText = source.slice(source.indexOf('onChangeText='));
    const handlerBody = onChangeText.slice(0, onChangeText.indexOf('placeholder='));
    expect(handlerBody).not.toContain('onAnswer');
  });
});
