/**
 * Structural dirty-diff helper (13-UI-SPEC.md "Admin Save/Dirty Contract",
 * SET-09).
 *
 * The rebuilt `SettingsPage.tsx` computes `dirty` as a per-field DIFF against
 * the last-loaded value, NOT `BrandingPage.tsx`'s one-way `setDirty(true)`
 * flag. `BrandingPage.tsx`'s Save enables on any field touch and never
 * re-clears until an actual save, so a touch-then-revert stays "dirty" there
 * — that is a DELIBERATE, UNCHANGED behavior of that page, out of this
 * phase's scope (13-UI-SPEC.md Spacing Scale's page-boundary migration-state
 * note applies the same "do not backport" rule to this Save/Dirty
 * tightening). SET-09's requirement text is explicit that Save "enables the
 * moment a REAL change is made" — a touch-then-revert is not a real change,
 * so `SettingsPage.tsx` needs the stricter diff-based rule instead.
 *
 * Hand-rolled rather than a lodash/isEqual dependency: 13-PATTERNS.md's "No
 * Analog Found" section confirms no diff/deep-equal utility exists anywhere
 * in `apps/admin`, and this page's field set is a flat record, so a per-field
 * comparison is the simplest correct implementation and avoids adding a new
 * dependency (which would otherwise require the Package Legitimacy Gate).
 */

/** Normalizes null/undefined/'' to one empty representation and trims strings,
 *  so a null-vs-empty-string difference or whitespace-only edit never counts
 *  as a real change. */
function normalizeField(value: unknown): unknown {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
}

function fieldsEqual(a: unknown, b: unknown): boolean {
  return normalizeField(a) === normalizeField(b);
}

/**
 * `true` when `current` differs from `lastLoaded` in at least one field
 * (after normalization). Compares the union of both objects' keys so a field
 * present only on one side is still detected as a change.
 */
export function isFormDirty<T extends Record<string, unknown>>(current: T, lastLoaded: T): boolean {
  const keys = new Set<string>([...Object.keys(current), ...Object.keys(lastLoaded)]);
  for (const key of keys) {
    if (!fieldsEqual(current[key], lastLoaded[key])) {
      return true;
    }
  }
  return false;
}
