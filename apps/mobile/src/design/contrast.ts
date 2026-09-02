/**
 * Pure WCAG 2.x relative-luminance contrast-ratio calculator (12-07 Task 2,
 * T-12-07-02). Proves the light/dark palettes actually clear the
 * 4.5:1 AA floor (normal mode) and 7:1 AAA target (high-contrast mode) by
 * computed math over the real token values — never a visual spot-check.
 *
 * No dependency, no `react-native` import — stays test-safe under
 * vitest/node, mirroring `tokens.ts`'s own header requirement.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses `#rrggbb` (case-insensitive) into 0-255 channel values. */
function parseHex(value: string): Rgb {
  const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) {
    throw new Error(`contrastRatio: not a #rrggbb hex color: "${value}"`);
  }
  const hex = match[1] as string;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

/** Parses `rgba(r,g,b,a)` (whitespace-tolerant) into channel values + alpha (0-1). */
function parseRgba(value: string): Rgb & { a: number } {
  const match = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(value.trim());
  if (!match) {
    throw new Error(`contrastRatio: not an rgba(...) color: "${value}"`);
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: Number(match[4]),
  };
}

/**
 * Parses either `#rrggbb` or `rgba(r,g,b,a)` into opaque 0-255 channels,
 * compositing an `rgba(...)` foreground over the supplied opaque background
 * so alpha-bearing tokens (e.g. `border`, `subtleFill`) produce a real
 * number rather than NaN.
 */
function toOpaqueRgb(color: string, background: Rgb): Rgb {
  if (color.startsWith('rgba(')) {
    const { r, g, b, a } = parseRgba(color);
    return {
      r: r * a + background.r * (1 - a),
      g: g * a + background.g * (1 - a),
      b: b * a + background.b * (1 - a),
    };
  }
  return parseHex(color);
}

/** WCAG relative-luminance channel transform. */
function linearizeChannel(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0-1) of an opaque RGB color. */
function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * WCAG contrast ratio between `foreground` and `background`, both `#rrggbb`
 * or `rgba(r,g,b,a)`. An `rgba(...)` foreground is composited over the
 * (assumed-opaque) background before the ratio is computed. Range: 1
 * (identical) to 21 (pure black vs. pure white).
 */
export function contrastRatio(foreground: string, background: string): number {
  const backgroundRgb = toOpaqueRgb(background, { r: 255, g: 255, b: 255 });
  const foregroundRgb = toOpaqueRgb(foreground, backgroundRgb);

  const lFg = relativeLuminance(foregroundRgb);
  const lBg = relativeLuminance(backgroundRgb);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 13-04 addition (T-13-04-03): composites a translucent `foreground` (hex or
 * `rgba(...)`) over an OPAQUE `background` (`#rrggbb`), returning the
 * resulting opaque `#rrggbb`. `contrastRatio()`'s own default backdrop for an
 * `rgba(...)` argument is pure white — correct for a foreground glyph/text
 * color, but understates the real on-screen result for a translucent FILL
 * token (e.g. dark theme's `colors.secondary`, ~8% white) that is always
 * rendered nested on a concrete dark card/row surface (`colors.surface`),
 * never on white. Callers measuring a translucent fill's contrast against the
 * surface it actually renders on should flatten it with this function first,
 * then pass the result as `contrastRatio(text, compositeOver(fill, surface))`.
 */
export function compositeOver(foreground: string, background: string): string {
  const backgroundRgb = parseHex(background);
  const { r, g, b } = toOpaqueRgb(foreground, backgroundRgb);
  const toHex = (channel: number) => Math.round(channel).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
