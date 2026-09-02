import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultSettingsRow,
  createSettingsRepo,
  settingsInsertParams,
  toUserSettings,
} from './settingsRepo';

describe('buildDefaultSettingsRow (pure first-login row builder)', () => {
  it('binds id to the rep own auth.uid() verbatim — the primary key IS the identity', () => {
    const row = buildDefaultSettingsRow({ userId: 'abc', nowIso: '2026-08-11T09:00:00.000Z' });

    expect(row.id).toBe('abc');
  });

  it('defaults theme/text_size/high_contrast, seeds language from the device locale', () => {
    const row = buildDefaultSettingsRow({
      userId: 'rep-1',
      language: 'en',
      nowIso: '2026-08-11T09:00:00.000Z',
    });

    expect(row).toEqual({
      id: 'rep-1',
      language: 'en',
      theme: 'system',
      text_size: 'default',
      high_contrast: false,
      auto_lock_timeout_minutes: null,
      updated_at: '2026-08-11T09:00:00.000Z',
    });
  });

  it('defaults auto_lock_timeout_minutes to null — never a non-null value (self-inflicted-lockout guard, D-01)', () => {
    const row = buildDefaultSettingsRow({ userId: 'rep-1', nowIso: '2026-08-11T09:00:00.000Z' });
    expect(row.auto_lock_timeout_minutes).toBeNull();
  });

  it('defaults language to de when no device language is supplied', () => {
    const row = buildDefaultSettingsRow({ userId: 'rep-1', nowIso: '2026-08-11T09:00:00.000Z' });
    expect(row.language).toBe('de');
  });
});

describe('settingsInsertParams (SQL column order)', () => {
  it('emits params in the exact INSERT column order, serializing high_contrast as TEXT', () => {
    const row = buildDefaultSettingsRow({
      userId: 'rep-1',
      language: 'de',
      nowIso: '2026-08-11T09:00:00.000Z',
    });

    expect(settingsInsertParams(row)).toEqual([
      'rep-1',
      'de',
      'system',
      'default',
      '0',
      null,
      '2026-08-11T09:00:00.000Z',
    ]);
  });
});

describe('toUserSettings (pure TEXT-record mapper)', () => {
  const base = {
    id: 'rep-1',
    language: 'de',
    theme: 'dark',
    text_size: 'large',
    high_contrast: '1',
    auto_lock_timeout_minutes: '15',
    updated_at: '2026-08-11T09:00:00.000Z',
  };

  it('parses high_contrast TEXT "1" to true and "0" to false', () => {
    expect(toUserSettings(base).highContrast).toBe(true);
    expect(toUserSettings({ ...base, high_contrast: '0' }).highContrast).toBe(false);
  });

  it('parses high_contrast TEXT "true"/"false" as well', () => {
    expect(toUserSettings({ ...base, high_contrast: 'true' }).highContrast).toBe(true);
    expect(toUserSettings({ ...base, high_contrast: 'false' }).highContrast).toBe(false);
  });

  it('falls back an unrecognized theme value to system', () => {
    expect(toUserSettings({ ...base, theme: 'neon' }).theme).toBe('system');
  });

  it('falls back an unrecognized text_size value to default', () => {
    expect(toUserSettings({ ...base, text_size: 'huge' }).textSize).toBe('default');
  });

  it('passes through a recognized theme/text_size unchanged', () => {
    const result = toUserSettings(base);
    expect(result.theme).toBe('dark');
    expect(result.textSize).toBe('large');
    expect(result.language).toBe('de');
    expect(result.updatedAt).toBe('2026-08-11T09:00:00.000Z');
  });

  it('maps a valid auto_lock_timeout_minutes value', () => {
    expect(toUserSettings(base).autoLockTimeoutMinutes).toBe(15);
  });

  it('maps a null/undefined auto_lock_timeout_minutes to null — the rep has not chosen', () => {
    expect(toUserSettings({ ...base, auto_lock_timeout_minutes: null }).autoLockTimeoutMinutes).toBeNull();
    expect(toUserSettings({ ...base, auto_lock_timeout_minutes: undefined }).autoLockTimeoutMinutes).toBeNull();
  });

  it('maps an unrecognized auto_lock_timeout_minutes value to null, never garbage (T-12-04-01 class of guard)', () => {
    expect(toUserSettings({ ...base, auto_lock_timeout_minutes: '10' }).autoLockTimeoutMinutes).toBeNull();
  });
});

describe('createSettingsRepo (fake db, offline-first CRUD queue)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSettings returns null when no row exists', async () => {
    const getAll = vi.fn(async () => []);
    const repo = createSettingsRepo({ db: { getAll } as never });

    expect(await repo.getSettings('rep-1')).toBeNull();
  });

  it('getSettings SELECTs auto_lock_timeout_minutes alongside the other columns', async () => {
    const getAll = vi.fn(async () => []);
    const repo = createSettingsRepo({ db: { getAll } as never });

    await repo.getSettings('rep-1');

    const [sql] = getAll.mock.calls[0] as unknown as [string];
    expect(sql).toContain('auto_lock_timeout_minutes');
  });

  it('getSettings maps the first row when one exists', async () => {
    const getAll = vi.fn(async () => [
      {
        id: 'rep-1',
        language: 'de',
        theme: 'light',
        text_size: 'default',
        high_contrast: '0',
        updated_at: '2026-08-11T09:00:00.000Z',
      },
    ]);
    const repo = createSettingsRepo({ db: { getAll } as never });

    const result = await repo.getSettings('rep-1');
    expect(result?.id).toBe('rep-1');
    expect(result?.theme).toBe('light');
  });

  it('ensureSettingsRow does a local SELECT first and skips the INSERT when a row already exists', async () => {
    const getAll = vi.fn(async () => [
      {
        id: 'rep-1',
        language: 'de',
        theme: 'light',
        text_size: 'default',
        high_contrast: '0',
        updated_at: '2026-08-11T09:00:00.000Z',
      },
    ]);
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { getAll, execute } as never });

    await repo.ensureSettingsRow({ userId: 'rep-1', deviceLanguage: 'en' });

    expect(execute).not.toHaveBeenCalled();
  });

  it('ensureSettingsRow inserts id = userId (never a generated uuid) when no row exists', async () => {
    const getAll = vi.fn(async () => []);
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { getAll, execute } as never });

    await repo.ensureSettingsRow({ userId: 'rep-1', deviceLanguage: 'en' });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO user_settings');
    expect(params[0]).toBe('rep-1');
    expect(params[1]).toBe('en');
  });

  it('updateSettings issues a real local UPDATE ... WHERE id = ? — never an upsert', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { execute } as never });

    await repo.updateSettings('rep-1', { theme: 'dark' });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE user_settings');
    expect(sql).toContain('WHERE id = ?');
    expect(sql.toLowerCase()).not.toContain('on conflict');
    expect(sql.toLowerCase()).not.toContain('insert or replace');
    expect(params[params.length - 1]).toBe('rep-1');
  });

  it('updateSettings only sets the touched columns plus updated_at', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { execute } as never });

    await repo.updateSettings('rep-1', { highContrast: true });

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('high_contrast = ?');
    expect(sql).not.toContain('theme = ?');
    expect(params[0]).toBe('1');
  });

  it('updateSettings sets auto_lock_timeout_minutes when touched', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { execute } as never });

    await repo.updateSettings('rep-1', { autoLockTimeoutMinutes: 5 });

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('auto_lock_timeout_minutes = ?');
    expect(params[0]).toBe(5);
  });

  it('updateSettings accepts a null autoLockTimeoutMinutes (rep clears their choice)', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createSettingsRepo({ db: { execute } as never });

    await repo.updateSettings('rep-1', { autoLockTimeoutMinutes: null });

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('auto_lock_timeout_minutes = ?');
    expect(params[0]).toBeNull();
  });

  it('watchSettings returns an unsubscribe function and re-emits on change', () => {
    let onResultCb: ((result: unknown) => void) | undefined;
    const watch = vi.fn((_sql, _params, handlers) => {
      onResultCb = handlers.onResult;
    });
    const repo = createSettingsRepo({ db: { watch } as never });

    const onChange = vi.fn();
    const unsubscribe = repo.watchSettings('rep-1', onChange);

    expect(typeof unsubscribe).toBe('function');
    onResultCb?.({
      rows: {
        _array: [
          {
            id: 'rep-1',
            language: 'de',
            theme: 'system',
            text_size: 'default',
            high_contrast: '0',
            updated_at: '2026-08-11T09:00:00.000Z',
          },
        ],
      },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]?.id).toBe('rep-1');
  });
});
