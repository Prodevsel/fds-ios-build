import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

/**
 * Design-token contract (05-UI-SPEC.md Color/Spacing tables are the BINDING
 * source). These assertions pin the palette + spacing + status-map invariants
 * so the token module can never silently drift from the UI-SPEC.
 */
describe('design tokens', () => {
  it('encodes the 05-UI-SPEC palette hexes exactly', () => {
    expect(tokens.color.accent).toBe('#E8862C'); // Porch-Light Amber
    expect(tokens.color.dominant).toBe('#F5F6F8'); // Paper Grey
    expect(tokens.color.ink).toBe('#12203A'); // Ink Navy
    expect(tokens.color.destructive).toBe('#C0362C'); // Brick Red
  });

  it('uses a spacing scale where every token is a multiple of 4', () => {
    const values = Object.values(tokens.spacing);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value % 4).toBe(0);
    }
  });

  it('exposes exactly delivered/pending/dead_letter statuses, each with a color AND an icon', () => {
    expect(Object.keys(tokens.status).sort()).toEqual(['dead_letter', 'delivered', 'pending']);
    for (const entry of Object.values(tokens.status)) {
      expect(entry.color).toMatch(/^#[0-9A-Fa-f]{6}$/); // never icon-less
      expect(entry.icon.length).toBeGreaterThan(0); // never color alone
    }
  });
});
