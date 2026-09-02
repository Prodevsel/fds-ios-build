/**
 * Design tokens — the single source of truth (SSOT) for the apps/mobile design
 * system. Re-based onto the FrontDoorSales brand palette from the design SSOT
 * (`.planning/design/screens/FrontDoorSales App.dc.html` + `Foundations.dc.html`):
 * Ink-Navy line work on cool Paper Grey, one warm Porch-Light Amber accent (the
 * lit door). Deliberately lighter/higher-contrast than the admin dashboard, but
 * recognisably the same brand. High contrast + 48dp touch targets for sunlight,
 * one hand and gloves; traffic-light house status is ALWAYS colour + icon.
 *
 * Plain exported `const` objects only — no styling library, no `react-native`
 * import (keeps the module test-safe under vitest/node). Consumed via RN
 * `StyleSheet.create()`.
 *
 * Never hardcode these values (hex colours, dp numbers, sp sizes) directly in
 * components — always import from here.
 */

/** House status enum values, mirrors migration 0014_houses_and_blacklist.sql. */
/**
 * The outcome of a door. Six values, which is both the number the field-sales
 * disposition literature converges on and the ceiling for a colour-coded map
 * (see .planning/research/status-model-field-practice.md).
 *
 * Two of them are new as of 0103 and exist because the two most common
 * outcomes at a door had nowhere to go:
 *
 *   * `not_home` — nobody answered. NOT terminal: the door stays work in hand.
 *   * `no_interest` — a polite no. Carries NO legal consequence and is freely
 *     reversible by the rep; it must never gate the consultation.
 *
 * `blacklist` keeps its bad identifier on purpose. Renaming a value on an
 * LWW-replicated table with offline clients is not a safe migration: a tablet
 * that was offline during the rename uploads the old value afterwards, which
 * the new CHECK then rejects — the upload-queue wedge connector.ts:622 warns
 * about. The German label is what changes ("Keine Ansprache"); the identifier
 * stays. It means a Werbewiderspruch under § 7 UWG / Art. 21 DSGVO: team-wide,
 * permanent, and always accompanied by a blacklist_entries row.
 */
export type HouseStatus =
  | 'new'
  | 'not_home'
  | 'follow_up'
  | 'no_interest'
  | 'blacklist'
  | 'success';

/** Spacing scale (dp), multiples of 4 (UI-SPEC Spacing Scale). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  /**
   * Touch target minimum (dp) — house pin tap zone, status-sheet buttons,
   * polygon-vertex handles. WCAG 2.5.5 / Material Design minimum. Fixed at
   * 48dp regardless of visual glyph size (UI-SPEC Spacing Scale exception).
   */
  touchTarget: 48,
  /**
   * PIN keypad digit target (dp) — 15-UI-SPEC.md §Spacing Scale's named
   * exception to the spacing scale itself (D-10: the concrete answer to
   * "must work with wet or gloved hands"). ISO 9241-411 recommends >=15mm
   * for bare-finger touch targets; a gloved fingertip's effective contact
   * area is materially larger and less precise, so this app targets
   * ~19-20mm for the keypad specifically (48dp `touchTarget` remains the
   * floor for every OTHER interactive element this phase adds).
   *
   * CORRECTED derivation (15-05 Task 3): 15-UI-SPEC.md's source arithmetic
   * ("1dp ~= 0.265mm -> 72dp ~= 19mm") uses the 96dpi CSS-reference-pixel
   * conversion, not Android's actual mdpi dp definition. React Native's own
   * docs state a dp is "roughly one pixel on a 160dpi screen" (Android's
   * canonical mdpi baseline) -> 1dp = 25.4mm / 160 ~= 0.15875mm, not
   * 0.265mm. Re-deriving with the correct constant: 19mm / 0.15875mm/dp
   * ~= 119.7dp, which rounds to the nearest grid-aligned (multiple-of-4)
   * value of 120dp (120 * 0.15875mm = 19.05mm — lands exactly in the
   * intended 19-20mm band). The UI-SPEC's 72dp figure was, under the
   * correct conversion, only ~11.4mm — BELOW the 15mm bare-finger ISO
   * floor it was meant to exceed. Token corrected to 120 accordingly; see
   * 15-05-SUMMARY.md for the full re-derivation record.
   */
  pinKeypadTarget: 120,
  /** Map edge safe-margin (dp) for floating controls, before safe-area inset. */
  mapEdgeMargin: 16,
} as const;

/**
 * Corner-radius scale (dp) — from the design SSOT: chips/pills 999, buttons and
 * inputs ~14–15, cards ~16–18. Never hardcode radii in components.
 */
export const radius = {
  sm: 8,
  md: 12,
  input: 14,
  button: 15,
  card: 18,
  pill: 999,
} as const;

/**
 * Font families. DEVIATION (see `.planning/design/deviations/mobile-foundations.md`):
 * the brand fonts (Space Grotesk / Inter / JetBrains Mono) are NOT bundled —
 * `expo-font` is not installed and bundling custom fonts requires a native
 * rebuild (out of scope for a Metro-only JS reload). Until they are added the
 * display/body families resolve to the platform system font (weight carries the
 * hierarchy: 600 for headings, 700 for door prices) and `mono` uses the
 * platform monospace for technical values (IBAN, deal references, codes).
 *
 * When the fonts land via expo-font, flip the three values below to
 * 'Space Grotesk', 'Inter' and 'JetBrains Mono' — every call site already goes
 * through these tokens, so nothing else changes.
 */
export const fontFamily = {
  /** Space Grotesk — headings, display, price numbers. */
  display: 'System',
  /** Inter — body copy, labels, form fields. */
  body: 'System',
  /** JetBrains Mono — IBAN, signature timestamps, deal references, codes. */
  mono: 'monospace',
} as const;

/**
 * Typography scale (design SSOT: 14/16/20/28 + one jumbo 40 for the door price +
 * mono 12 for technical references). A third weight (700) is reserved
 * EXCLUSIVELY for price numbers — at the door the amount must be legible from a
 * metre away.
 */
export const typography = {
  /** Label / secondary line — 14sp. */
  label: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  /** Body copy — 16sp. */
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  /** Section heading — 20sp / 600 (Space Grotesk). */
  heading: { fontSize: 20, fontWeight: '600', lineHeight: 24 },
  /** Screen display title — 28sp / 600 (Space Grotesk). */
  display: { fontSize: 28, fontWeight: '600', lineHeight: 34 },
  /** Price number — 20sp / 700, tabular feel. */
  price: { fontSize: 20, fontWeight: '700', lineHeight: 24 },
  /** Door-price jumbo — the single 40sp size, 700 (Space Grotesk). */
  priceJumbo: { fontSize: 40, fontWeight: '700', lineHeight: 44 },
  /** Technical mono value — 12sp, JetBrains Mono. */
  mono: { fontSize: 12, fontWeight: '400', lineHeight: 16, fontFamily: fontFamily.mono },
} as const;

/**
 * Theme-aware color resolution (D-12/D-13, 12-07). `lightColors` is the
 * verbatim, byte-identical continuation of the flat `color` object this
 * module shipped with pre-Phase-12 — proven by `tokens.test.ts`'s literal
 * value enumeration, so this refactor cannot silently regress a shipped
 * screen. `darkColors` follows the UI-SPEC dark column
 * (12-UI-SPEC.md § "Color — light/dark semantic token table"), with the
 * brand/map/territory entries given sensible dark-surface equivalents,
 * keeping the exact same key set as `lightColors` (see `tokens.test.ts`).
 *
 * `highContrastOverrides` (SET-06) is a contrast BOOST layered on top of
 * whichever scheme is resolved — never a third theme — holding only the
 * three documented override keys (12-UI-SPEC.md § "High-contrast override").
 *
 * `getColors(scheme, highContrast)` is the single resolution function every
 * consumer goes through (via `useThemeColors()`,
 * `features/settings/theme/useThemeColors.ts`, 12-07). Screens never read
 * `lightColors`/`darkColors` directly except through that hook (or the
 * `ForceLightTheme` escape hatch for the Phase-4 signature/scanner
 * surfaces).
 */
export type ColorScheme = 'light' | 'dark';

export const lightColors = {
  // --- brand ---
  ink: '#12203A',
  paper: '#F5F6F8',
  accent: '#E8862C',
  brick: '#C0362C',
  pine: '#2F8F5B',

  // --- semantic surfaces / text (design SSOT) ---
  surface: '#FFFFFF',
  background: '#F5F6F8',
  /** Neutral fill (segmented-control track, chips, resting buttons). */
  secondary: '#EDEFF3',
  /** The one primary accent — Porch-Light Amber. */
  destructive: '#C0362C',
  /** Text on an accent / ink / destructive surface. */
  onAccent: '#FFFFFF',
  /** Primary text — Ink Navy. */
  textPrimary: '#12203A',
  /** Secondary / label text — design slate. */
  textSecondary: '#5C6B85',
  /** Muted / placeholder glyph text. */
  textMuted: '#8792A6',
  /** Amber-on-paper text tone (the "b5610a"/"b56a1c" darkened amber for copy). */
  accentText: '#B5610A',
  /** Amber highlight tuned for dark/Ink-Navy surfaces (design door-price card). */
  accentOnDark: '#F6B26B',
  /**
   * Destructive-toned TEXT variant (15-13, T-15-13-07) — same brand-red
   * family as `destructive`, but tuned per scheme so destructive body TEXT
   * (never a button fill) clears the 4.5:1 AA floor against `surface` in
   * BOTH themes, the same "fill token vs. text token" split `accentText`
   * already establishes for the amber family. `destructive` alone (flat
   * `#E2574A` on `#16223B`) measures 4.295:1 in the dark palette — just
   * under the floor — proven by `contrast.ts`; this key is the fix, not a
   * new destructive hue for buttons/icons, which keep using `destructive`
   * unchanged.
   */
  destructiveText: '#C0362C',
  /** Legal/notice body-text tone on paper (design Widerruf notice, #3a4763). */
  noticeText: '#3A4763',
  /** Hairline border / divider — Ink Navy @ ~10%. */
  border: 'rgba(18,32,58,0.10)',
  /** Slightly stronger input border — Ink Navy @ ~15%. */
  borderStrong: 'rgba(18,32,58,0.15)',
  /** Subtle tinted fill — Ink Navy @ ~6% (mono chips, tracks, icon squares). */
  subtleFill: 'rgba(18,32,58,0.06)',

  // --- map / territory (retained blue per design SSOT) ---
  /** Locked-territory overlay fill (UI-SPEC: semi-transparent grey @ 35%). */
  lockedTerritoryFill: '#94A3B8',
  lockedTerritoryFillOpacity: 0.35,
  /** Locked-territory overlay outline. */
  lockedTerritoryOutline: '#64748B',
  /** Own/assigned territory outline (blue, kept distinct from the amber accent). */
  ownTerritoryOutline: '#2563EB',
  /** Basemap palette. Theme-invariant, like lockedTerritoryFill/
   * ownTerritoryOutline above: these render over OSM vector tiles, not over
   * `background`/`surface`, so they must not flip with the app theme.
   *
   * Tuned to the app's own language rather than a generic OSM look: Paper-Grey
   * ground, Ink-Navy labels, desaturated navy water. Major roads carry only a
   * WARM TINT, never `accent` itself — Porch-Light Amber stays reserved for the
   * one primary CTA per screen (Foundations SSOT), and an amber road network
   * would compete with every button on the map. */
  mapEarth: '#F3F5F8',
  mapWater: '#CBD9E6',
  mapLanduse: '#E6EBE4',
  mapBuilding: '#E4E7ED',
  mapBuildingOutline: '#D1D6E0',
  mapRoadCasing: '#C2C9D6',
  mapRoadMinor: '#FFFFFF',
  mapRoadMajor: '#FBEEDC',
  mapLabel: '#12203A',
  /** Pin cluster badge color — neutral grey, never a status color. */
  clusterBadge: '#64748B',
} as const;

/**
 * Structural (widened, non-literal) shape of a color palette — `darkColors`
 * and `highContrastOverrides` are typed against this rather than
 * `typeof lightColors` directly, since the latter's `as const` would pin
 * every property to its exact light-mode literal string and reject any
 * differing dark-mode value at the type level.
 */
export type ColorPalette = { [K in keyof typeof lightColors]: (typeof lightColors)[K] extends number ? number : string };

/**
 * Dark palette (12-UI-SPEC.md § "Color — light/dark semantic token table",
 * all `[DEFAULT]`, tuned against `contrast.test.ts`'s computed WCAG ratios —
 * see 12-07-SUMMARY.md for any value adjusted to clear the AA/AAA floor).
 * Brand/map/territory entries not in the UI-SPEC table are given sensible
 * dark-surface equivalents; `lockedTerritoryFill`/`ownTerritoryOutline` keep
 * their light-mode blue/grey hues since they render over the map tile layer
 * in both themes, not over `background`/`surface`.
 */
export const darkColors: ColorPalette = {
  // --- brand ---
  ink: '#F5F6F8',
  paper: '#0B1220',
  accent: '#F0A050',
  brick: '#E2574A',
  pine: '#45B37D',

  // --- semantic surfaces / text (UI-SPEC dark column) ---
  surface: '#16223B',
  background: '#0B1220',
  /** Neutral fill (segmented-control track, chips, resting buttons) — dark subtleFill value. */
  secondary: 'rgba(245,246,248,0.08)',
  destructive: '#E2574A',
  /** Text on an accent / ink / destructive surface — ink navy reads on the lightened dark accent. */
  onAccent: '#12203A',
  textPrimary: '#F5F6F8',
  textSecondary: '#A9B4CC',
  textMuted: '#7B879D',
  /** Amber-on-paper text tone — reuses the dark accent (already tuned for a dark surface). */
  accentText: '#F0A050',
  /** Amber highlight on dark surfaces — same role as light mode's dark-surface amber. */
  accentOnDark: '#F6B26B',
  /** Destructive-toned TEXT variant, lightened relative to `destructive` so it clears 4.5:1 AA against `surface` (`#16223B`) — see the light-palette comment above for the full rationale. */
  destructiveText: '#E97D71',
  /** Legal/notice body-text tone on a dark surface. */
  noticeText: '#A9B4CC',
  border: 'rgba(245,246,248,0.12)',
  borderStrong: 'rgba(245,246,248,0.20)',
  subtleFill: 'rgba(245,246,248,0.08)',

  // --- map / territory (unchanged — rendered over the map tile layer, not background/surface) ---
  lockedTerritoryFill: '#94A3B8',
  lockedTerritoryFillOpacity: 0.35,
  lockedTerritoryOutline: '#64748B',
  ownTerritoryOutline: '#2563EB',
  clusterBadge: '#64748B',
  // Basemap palette — IDENTICAL to lightColors on purpose. These paint OSM
  // vector tiles, not app surfaces, so they must not invert with the theme
  // (same rule as lockedTerritoryFill/ownTerritoryOutline).
  mapEarth: '#F3F5F8',
  mapWater: '#CBD9E6',
  mapLanduse: '#E6EBE4',
  mapBuilding: '#E4E7ED',
  mapBuildingOutline: '#D1D6E0',
  mapRoadCasing: '#C2C9D6',
  mapRoadMinor: '#FFFFFF',
  mapRoadMajor: '#FBEEDC',
  mapLabel: '#12203A',
};

/**
 * High-contrast override set (SET-06, 12-UI-SPEC.md § "High-contrast
 * override") — a contrast BOOST applied on top of whichever scheme is
 * resolved, never a third theme. Holds ONLY the three documented override
 * keys; every other token passes through from `lightColors`/`darkColors`
 * unchanged. `subtleFill` has no override value here because the UI-SPEC
 * calls for REMOVING the low-opacity tint in high-contrast mode (fall back
 * to `surface` + `border` at the consuming call site) rather than
 * substituting a different tint.
 */
export const highContrastOverrides: Record<ColorScheme, Pick<ColorPalette, 'textPrimary' | 'border'>> = {
  light: {
    textPrimary: '#000000',
    border: 'rgba(18,32,58,0.35)',
  },
  dark: {
    textPrimary: '#FFFFFF',
    border: 'rgba(245,246,248,0.35)',
  },
};

/**
 * Single resolution function every consumer goes through (D-12). Returns the
 * base palette for `scheme`, merged with `highContrastOverrides[scheme]` when
 * `highContrast` is true.
 */
export function getColors(scheme: ColorScheme, highContrast = false): ColorPalette {
  const base: ColorPalette = scheme === 'dark' ? darkColors : lightColors;
  if (!highContrast) return base;
  return { ...base, ...highContrastOverrides[scheme] };
}

/**
 * The deprecated flat `color` constant (formerly a top-level alias assigned
 * `lightColors`) is GONE — the theme refactor is complete, not half-migrated
 * (D-12, closed by plan 12-15). There is no flat-constant escape hatch left
 * anywhere in this module. The only sanctioned access paths are:
 *   - `useThemeColors()` (`features/settings/theme/useThemeColors.ts`) inside
 *     any component that can call a hook;
 *   - `getColors(scheme, highContrast)` directly, for the single documented
 *     pre-provider call site (`app/RootNavigator.tsx`'s splash branch, which
 *     renders before `ThemeProvider` can resolve a preference) and the
 *     `ForceLightTheme` escape hatch (SET-05 signature/scanner exception).
 * `tokens.test.ts` asserts `'color' in` the module's export surface is
 * `false` so this cannot silently regress.
 */

/**
 * Traffic-light status color + icon map (UI-SPEC "Traffic-light status
 * palette"). Every status pairs a distinct hue with a distinct
 * MaterialCommunityIcons glyph — never color alone (colorblind safety). Kept at
 * the brighter map-pin hues from the design SSOT (deliberately more saturated
 * than the brand palette for sunlight readability).
 *
 * NOT scheme-varying (UI-SPEC decision, 12-07): these saturated traffic-light
 * hues are deliberately identical in both light and dark theme — they read
 * against a `surface` card in either theme and were chosen for outdoor
 * legibility, not to match the brand palette's tone. `getColors()` never
 * touches this map.
 */
export const statusColor: Record<HouseStatus, string> = {
  new: '#64748B',
  // Blue reads as "come back", not as a result — not_home is the one status
  // added in 0103 that is NOT terminal.
  not_home: '#2563EB',
  follow_up: '#D97706',
  // Warm grey against new's blue-grey. The closest pair in this palette on
  // purpose: both mean "no outcome", and every hue is paired with an icon
  // below, so colour is never the only carrier (six hues is the colourblind
  // ceiling — there is no room for a seventh).
  no_interest: '#78716C',
  blacklist: '#DC2626',
  success: '#16A34A',
};

/** Wallet commission lifecycle state (mirrors deriveWalletState's WalletState;
 * declared locally so this design-token module never imports from a feature). */
export type WalletStateToken = 'secured' | 'in_review' | 'reversed';

/**
 * Wallet-state chip color map (D-01). Reuses the traffic-light hues so the
 * wallet stays consistent with house status: secured→success green,
 * in_review→follow-up amber, reversed→destructive red. Never hardcode these
 * hex values in the WalletScreen — import from here.
 */
export const walletStateColor: Record<WalletStateToken, string> = {
  secured: statusColor.success,
  in_review: statusColor.follow_up,
  reversed: lightColors.destructive,
};

/**
 * MaterialCommunityIcons glyph name per status (UI-SPEC Color table). UI-SPEC
 * describes "Neu" as "filled circle, no icon (default/neutral)" — modeled
 * here as the plain `circle` glyph (the neutral shape itself) rather than a
 * `null` entry, so every status has both a color AND an icon glyph
 * (colorblind-safe pairing for all four, never relying on color alone).
 */
export const statusIcon: Record<HouseStatus, string> = {
  new: 'circle',
  not_home: 'door-closed',
  follow_up: 'clock-outline',
  no_interest: 'thumb-down-outline',
  // `cancel` vs `thumb-down-outline`: the legal lock is a hard stop sign, the
  // polite no is a gesture. At pin size that difference has to be readable
  // without the colour, because the two mean very different things.
  blacklist: 'cancel',
  success: 'check-circle',
};
