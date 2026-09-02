/**
 * Design tokens — the single source of truth (SSOT) for the apps/admin design
 * system. Encodes 05-UI-SPEC.md's OWN palette/spacing/typography (the "site
 * plan / surveyor's document" identity: ink-navy line work on cool paper, one
 * warm porch-light accent) — deliberately distinct from apps/mobile's blue
 * token set (no shared token package; Rule of Two not yet satisfied).
 *
 * NEVER hardcode these values (hex colors, px numbers) directly in components.
 * The Tailwind theme (`tailwind.config.ts`) and the shadcn CSS variables
 * (`src/index.css`) are generated FROM this module — there is no second literal
 * source. Components consume semantic Tailwind classes only.
 */

/** Webhook/API delivery status enum (05-UI-SPEC Color — status semantic set). */
export type DeliveryStatus = 'delivered' | 'pending' | 'dead_letter';

/**
 * House canvassing status — the `houses.status` CHECK constraint's four values
 * (migration 0004), mirrored here so the territory map can colour its pins.
 */
export type HouseStatus =
  | 'new'
  | 'not_home'
  | 'follow_up'
  | 'no_interest'
  | 'blacklist'
  | 'success';

/**
 * Status color + lucide-react icon glyph per status. Every status pairs a
 * distinct hue with a distinct icon — never color alone (colorblind safety /
 * dataviz floor, "ships with icon + label").
 */
type StatusToken = { readonly color: string; readonly icon: string };

export const tokens = {
  /** Palette (05-UI-SPEC Color table — BINDING values). */
  color: {
    /** Dominant (60%) — Paper Grey: app background, content area, card surfaces. */
    dominant: '#F5F6F8',
    /** Secondary (30%) — Ink Navy: sidebar, top bar, table header, code-chip border. */
    ink: '#12203A',
    /** Accent (10%) — Porch-Light Amber: primary CTA, active nav, focus ring, trend line. */
    accent: '#E8862C',
    /** Destructive — Brick Red: destructive actions, dead-letter badge, key deactivation. */
    destructive: '#C0362C',
    /** Pine Green — delivered/active status (status semantic only, never decorative). */
    pine: '#2F8F5B',
  },

  /** Spacing scale (px) — every value a multiple of 4 (05-UI-SPEC Spacing Scale). */
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
  },

  /** Typography — exactly 4 sizes / 2 weights across 2 families + 1 mono family. */
  typography: {
    families: {
      display: "'Space Grotesk', system-ui, sans-serif",
      body: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, monospace",
    },
    size: {
      label: 12,
      body: 14,
      heading: 20,
      display: 28,
    },
  },

  /** Delivery status semantic map (05-UI-SPEC Color — second semantic color). */
  status: {
    delivered: { color: '#2F8F5B', icon: 'check-circle-2' },
    pending: { color: '#E8862C', icon: 'clock' },
    dead_letter: { color: '#C0362C', icon: 'alert-triangle' },
  } satisfies Record<DeliveryStatus, StatusToken>,

  /**
   * House traffic-light hues for the Gebiete map, kept byte-identical to
   * `apps/mobile/src/design/tokens.ts`'s `statusColor` map so the same house
   * reads the same colour on the rep's phone and on the team lead's screen.
   *
   * Deliberately NOT folded into the `color`/`status` maps above: those encode
   * the admin's own 05-UI-SPEC palette, whereas these four hues are borrowed
   * from the mobile UI-SPEC and must track IT, not this file's palette. There
   * is no shared token package yet (Rule of Two is satisfied only once a
   * second admin screen needs them), so this is a documented mirror — the map
   * legend always pairs each hue with a text label, never colour alone.
   */
  houseStatus: {
    new: '#64748B',
    // 0103: blue reads as "come back", not as a result — not_home is the one
    // new status that is NOT terminal.
    not_home: '#2563EB',
    follow_up: '#D97706',
    // Warm grey against new's blue-grey. The two greys are the closest pair in
    // this palette on purpose: both mean "no outcome yet or ever", and the map
    // legend pairs every hue with its label, never colour alone.
    no_interest: '#78716C',
    blacklist: '#DC2626',
    success: '#16A34A',
  } satisfies Record<HouseStatus, string>,

  /**
   * Data-visualization tokens (05-UI-SPEC Data Visualization Contract, ADMN-03).
   * SVG chart marks read colors from HERE, never inline hex — this is the SSOT
   * for chart color just as `color` is for the shell.
   */
  chart: {
    /** Single-series trend line — the reserved Porch-Light Amber accent. */
    trend: '#E8862C',
    /** Recessive grid/axis line: Ink Navy rendered at 10% opacity (stroke-opacity). */
    axisLine: '#12203A',
    /** Chart text (Inter/Label 12px) — Ink Navy for primary, slate for secondary. NEVER a series color. */
    textPrimary: '#12203A',
    textSecondary: '#5C6B85',
    /**
     * Categorical team-comparison palette — one hue per rep, fixed order, mid-tone
     * ~45–55% L. Deliberately excludes red/green (reserved for status semantics).
     * CVD-validated (executor-run CIE76 ΔE, 2026-07-27): adjacent-pair ΔE is
     * blue↔teal 78.8, teal↔purple 86.5, purple↔gold 108.8, gold↔slate 81.2, and
     * the cyclic wrap slate↔blue 44.1 — all ≫ the required ΔE ≥ 8 floor, so a
     * ≤5-rep team (and the rare cyclic reuse past 5) stays distinguishable under
     * deuteranopia/protanopia.
     */
    categorical: ['#3B6FD4', '#1F9E8D', '#8B5FBF', '#C98A1D', '#5C6B85'],
  },
} as const;

export type Tokens = typeof tokens;
