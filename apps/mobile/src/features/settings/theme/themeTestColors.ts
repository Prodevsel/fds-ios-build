import { lightColors } from '../../../design/tokens';

/**
 * Shared theme-color fixture for unit tests that exercise theme-aware pure
 * functions (e.g. `SegmentedControl.tsx`'s `getSegmentedOptionStyle`)
 * without mounting `ThemeProvider` (no react-native-testing-library in this
 * repo — see `ThemeProvider.test.tsx`'s precedent of testing pure/DI'd logic
 * directly). Import this single fixture instead of the deprecated `color`
 * alias or re-declaring `lightColors` per test file — every wave-6 rollout
 * plan (12-08..12-12) that adds a pure-function test needing a resolved
 * colors object reuses this rather than duplicating it.
 */
export const themeTestColors = lightColors;
