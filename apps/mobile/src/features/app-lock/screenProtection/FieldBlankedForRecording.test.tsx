import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo (IdScanBlock.test.tsx /
// PinKeypad.test.tsx precedent) — `View`/`Text`/`StyleSheet` are mocked as
// simple pass-through identity functions so `FieldBlankedForRecording` (a
// HOOKLESS component, deliberately — see its own header) can be invoked
// DIRECTLY as a plain function and its JSX output (real `React.createElement`
// objects, `{ type, props }`, `type` being the imported mock function
// reference) walked manually — no renderer involved.
vi.mock('react-native', () => ({
  View: (_props: unknown) => null,
  Text: (_props: unknown) => null,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: (_props: unknown) => null,
}));

import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { compositeOver, contrastRatio } from '../../../design/contrast';
import { darkColors, lightColors } from '../../../design/tokens';
import { FieldBlankedForRecording } from './FieldBlankedForRecording';

interface ReactElementLike {
  type: unknown;
  props: { children?: unknown; [key: string]: unknown };
}

function isElement(value: unknown): value is ReactElementLike {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

/** Walks a real React-element tree (createElement output) collecting every node of `elementType`. */
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

describe('FieldBlankedForRecording (D-14b, T-15-09-01/02)', () => {
  it('renders the eye-off-outline icon', () => {
    const tree = FieldBlankedForRecording({ colors: lightColors });
    const icons = findAllByElementType(tree, MaterialCommunityIcons);
    expect(icons).toHaveLength(1);
    expect(icons[0]?.props.name).toBe('eye-off-outline');
  });

  it('renders the sec.fieldBlankedForRecording label text', () => {
    const tree = FieldBlankedForRecording({ colors: lightColors });
    const texts = findAllByElementType(tree, Text);
    const labelTexts = texts.map((node) => node.props.children);
    expect(labelTexts).toContain('Für Bildschirmaufnahmen ausgeblendet');
  });

  it('renders NO ActivityIndicator — this must never read as a loading state', () => {
    const tree = FieldBlankedForRecording({ colors: lightColors });
    expect(findAllByElementType(tree, 'ActivityIndicator')).toHaveLength(0);
  });

  it('forwards testID onto the container', () => {
    const tree = FieldBlankedForRecording({ colors: lightColors, testID: 'field-blanked-test' });
    expect(isElement(tree) && tree.type === View && tree.props.testID).toBe('field-blanked-test');
  });
});

/**
 * Contrast measurement (Phase 13 precedent: COMPUTE, never assume).
 * `subtleFill` is a translucent fill — per `contrast.ts`'s own header
 * comment, a translucent fill token must be composited over the concrete
 * surface it actually renders on (`colors.surface`, matching
 * `SessionsScreen.tsx`'s `userAgentBlock` nesting) before measuring the
 * label text's contrast against it.
 */
describe('contrast — sec.fieldBlankedForRecording label on subtleFill (light/dark)', () => {
  it('clears 4.5:1 AA in light mode', () => {
    const composited = compositeOver(lightColors.subtleFill, lightColors.surface);
    const ratio = contrastRatio(lightColors.textSecondary, composited);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('clears 4.5:1 AA in dark mode', () => {
    const composited = compositeOver(darkColors.subtleFill, darkColors.surface);
    const ratio = contrastRatio(darkColors.textSecondary, composited);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
