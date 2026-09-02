import { describe, expect, it } from 'vitest';
import {
  deriveSettingRowState,
  isLockableSettingKey,
  isPolicyKind,
  LOCKABLE_SETTING_KEYS,
  type TenantSettingPolicy,
} from './settingRowState';

function policy(overrides: Partial<TenantSettingPolicy>): TenantSettingPolicy {
  return {
    id: 'policy-1',
    settingKey: 'auto_lock_timeout_minutes',
    policyKind: 'ceiling',
    policyValue: '15',
    ...overrides,
  };
}

describe('LOCKABLE_SETTING_KEYS (mirrors the closed Postgres lockable_setting_key enum, 0070)', () => {
  it('has exactly the four Postgres enum members', () => {
    expect(LOCKABLE_SETTING_KEYS).toEqual([
      'auto_lock_timeout_minutes',
      'notification_quiet_hours',
      'scanner_torch_default',
      'wifi_only_bulk_transfer',
    ]);
  });

  it('excludes text_size and high_contrast — D-17/SET-06', () => {
    expect(LOCKABLE_SETTING_KEYS).not.toContain('text_size');
    expect(LOCKABLE_SETTING_KEYS).not.toContain('high_contrast');
  });
});

describe('isLockableSettingKey / isPolicyKind (narrowing guards)', () => {
  it('accepts all four lockable keys, rejects everything else including accessibility keys', () => {
    for (const key of LOCKABLE_SETTING_KEYS) {
      expect(isLockableSettingKey(key)).toBe(true);
    }
    expect(isLockableSettingKey('text_size')).toBe(false);
    expect(isLockableSettingKey('high_contrast')).toBe(false);
    expect(isLockableSettingKey('made_up_key')).toBe(false);
    expect(isLockableSettingKey(42)).toBe(false);
  });

  it('accepts ceiling/proposed_default, rejects anything else', () => {
    expect(isPolicyKind('ceiling')).toBe(true);
    expect(isPolicyKind('proposed_default')).toBe(true);
    expect(isPolicyKind('locked')).toBe(false);
    expect(isPolicyKind(null)).toBe(false);
  });
});

describe('deriveSettingRowState — the three states', () => {
  it('no policy row for the key -> free', () => {
    const result = deriveSettingRowState('auto_lock_timeout_minutes', []);
    expect(result).toEqual({ kind: 'free' });
  });

  it('one proposed_default row -> proposed, carrying its value', () => {
    const result = deriveSettingRowState('notification_quiet_hours', [
      policy({ settingKey: 'notification_quiet_hours', policyKind: 'proposed_default', policyValue: '20:00-08:00' }),
    ]);
    expect(result).toEqual({ kind: 'proposed', value: '20:00-08:00' });
  });

  it('one ceiling row -> ceiling, carrying its value', () => {
    const result = deriveSettingRowState('auto_lock_timeout_minutes', [
      policy({ policyKind: 'ceiling', policyValue: '15' }),
    ]);
    expect(result).toEqual({ kind: 'ceiling', value: '15' });
  });

  it('two ceiling rows (15 and 30) for auto_lock_timeout_minutes -> the stricter (15) wins', () => {
    const result = deriveSettingRowState('auto_lock_timeout_minutes', [
      policy({ id: 'p-30', policyKind: 'ceiling', policyValue: '30' }),
      policy({ id: 'p-15', policyKind: 'ceiling', policyValue: '15' }),
    ]);
    expect(result).toEqual({ kind: 'ceiling', value: '15' });
  });

  it('a ceiling row and a proposed row for the same key -> ceiling wins (it is enforced, the proposal is not)', () => {
    const result = deriveSettingRowState('auto_lock_timeout_minutes', [
      policy({ id: 'p-proposed', policyKind: 'proposed_default', policyValue: '60' }),
      policy({ id: 'p-ceiling', policyKind: 'ceiling', policyValue: '15' }),
    ]);
    expect(result).toEqual({ kind: 'ceiling', value: '15' });
  });

  it('rows for a different key never leak into this key state (free)', () => {
    const result = deriveSettingRowState('wifi_only_bulk_transfer', [
      policy({ settingKey: 'auto_lock_timeout_minutes', policyKind: 'ceiling', policyValue: '15' }),
    ]);
    expect(result).toEqual({ kind: 'free' });
  });

  it('is a pure function: same inputs, same output, across repeated calls', () => {
    const policies = [policy({ policyKind: 'ceiling', policyValue: '15' })];
    const first = deriveSettingRowState('auto_lock_timeout_minutes', policies);
    const second = deriveSettingRowState('auto_lock_timeout_minutes', policies);
    expect(first).toEqual(second);
  });
});

describe('D-17 / SET-06 regression gate — accessibility keys are unreachable, by type AND at runtime', () => {
  it('a forged policy row naming text_size or high_contrast is ignored: every real lockable key still derives its own correct state', () => {
    // Production code can never construct a TenantSettingPolicy with
    // settingKey: 'text_size' — LockableSettingKey has no such member. The
    // cast through `unknown` below is deliberately confined to this test: it
    // simulates a compromised sync layer (a forged/future-shaped row
    // reaching the device), which is exactly the threat T-13-03-01 names.
    const forgedTextSizeRow = {
      id: 'forged-1',
      settingKey: 'text_size',
      policyKind: 'ceiling',
      policyValue: 'extra_large',
    } as unknown as TenantSettingPolicy;
    const forgedHighContrastRow = {
      id: 'forged-2',
      settingKey: 'high_contrast',
      policyKind: 'ceiling',
      policyValue: 'true',
    } as unknown as TenantSettingPolicy;

    const policies = [
      forgedTextSizeRow,
      forgedHighContrastRow,
      policy({ settingKey: 'auto_lock_timeout_minutes', policyKind: 'ceiling', policyValue: '15' }),
    ];

    // The real lockable key is unaffected by the forged rows sitting
    // alongside it in the same snapshot.
    expect(deriveSettingRowState('auto_lock_timeout_minutes', policies)).toEqual({ kind: 'ceiling', value: '15' });

    // isLockableSettingKey is the runtime half of the D-17/SET-06 defence:
    // both forged rows fail it, so they can never contribute a ceiling or
    // proposed state to any key.
    expect(isLockableSettingKey(forgedTextSizeRow.settingKey)).toBe(false);
    expect(isLockableSettingKey(forgedHighContrastRow.settingKey)).toBe(false);
  });

  it('no exported function accepts "text_size" or "high_contrast" as a LockableSettingKey argument (compile-time proof)', () => {
    // @ts-expect-error — D-17/SET-06: 'text_size' is not a member of
    // LockableSettingKey (the closed 0070 enum). If this line ever stops
    // producing a type error, the type-domain half of the D-17 guard has
    // been silently widened — a SET-06 violation. `pnpm --filter mobile
    // typecheck` fails loudly on that regression; this assertion documents
    // the intent inline, next to the runtime proof above.
    deriveSettingRowState('text_size', []);
    // @ts-expect-error — same guard, high_contrast.
    deriveSettingRowState('high_contrast', []);

    expect(true).toBe(true);
  });
});
