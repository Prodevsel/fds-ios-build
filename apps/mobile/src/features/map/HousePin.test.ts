import { describe, expect, it, vi } from 'vitest';

// Node test environment: HousePin.tsx pulls in react-native and the icon set,
// neither of which loads outside a native runtime. Mocked exactly the way
// MapScreen.test.tsx mocks them — nothing here renders, this file asserts the
// exported metric object and the token pairing table only (no
// react-test-renderer exists in this workspace).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

import { housePinMetrics } from './HousePin';
import { spacing, statusColor, statusIcon } from '../../design/tokens';

describe('housePinMetrics (defect 3: smaller pins, unchanged accessibility invariants)', () => {
  it('keeps the tap zone at spacing.touchTarget — asserted against the token, never a literal', () => {
    expect(housePinMetrics.touchZone).toBe(spacing.touchTarget);
  });

  it('shrinks the visible disc to 32dp, strictly inside the tap zone', () => {
    expect(housePinMetrics.circle).toBe(32);
    expect(housePinMetrics.circle).toBeLessThan(housePinMetrics.touchZone);
  });

  it('keeps a ring: it may shrink to 2dp but must never vanish (sunlight contrast)', () => {
    expect(housePinMetrics.ring).toBe(2);
    expect(housePinMetrics.ring).toBeGreaterThan(0);
  });

  it('holds the glyph/circle ratio at the 0.5 it had at 44/22', () => {
    expect(housePinMetrics.icon).toBe(16);
    expect(housePinMetrics.icon / housePinMetrics.circle).toBe(0.5);
  });

  it('keeps the 0088 open-units badge inside the tap zone and hugging the smaller circle', () => {
    const { touchZone, circle, badge } = housePinMetrics;
    expect(badge.size + 2 * badge.ring).toBeLessThanOrEqual(touchZone);

    // Boxes in tap-zone coordinates. The circle is centred in the zone.
    const inset = (touchZone - circle) / 2;
    const circleBox = { left: inset, right: inset + circle, top: inset, bottom: inset + circle };
    const badgeBox = {
      left: touchZone - badge.right - badge.size,
      right: touchZone - badge.right,
      top: badge.top,
      bottom: badge.top + badge.size,
    };

    // Entirely inside the 48dp zone …
    expect(badgeBox.left).toBeGreaterThanOrEqual(0);
    expect(badgeBox.right).toBeLessThanOrEqual(touchZone);
    expect(badgeBox.top).toBeGreaterThanOrEqual(0);
    expect(badgeBox.bottom).toBeLessThanOrEqual(touchZone);

    // … and overlapping the circle's TOP-RIGHT corner, never floating detached.
    expect(badgeBox.left).toBeLessThan(circleBox.right);
    expect(badgeBox.right).toBeGreaterThan(circleBox.left);
    expect(badgeBox.top).toBeLessThan(circleBox.bottom);
    expect(badgeBox.bottom).toBeGreaterThan(circleBox.top);
    expect(badgeBox.right).toBeGreaterThan((circleBox.left + circleBox.right) / 2);
    expect(badgeBox.top).toBeLessThan((circleBox.top + circleBox.bottom) / 2);
  });

  it('never scales the open-units digit down with the circle', () => {
    expect(badgeFontSize()).toBeGreaterThanOrEqual(11);
  });

  const badgeFontSize = () => housePinMetrics.badge.fontSize;
});

describe('colour is never the only signal (UI-SPEC icon-pairing requirement)', () => {
  it('pairs every status colour with its own distinct glyph', () => {
    const statuses = Object.keys(statusColor);
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(statusIcon[status as keyof typeof statusIcon]).toBeTruthy();
    }
    const glyphs = statuses.map((status) => statusIcon[status as keyof typeof statusIcon]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
