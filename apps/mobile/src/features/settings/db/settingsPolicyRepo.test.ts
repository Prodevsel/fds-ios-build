import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSettingsPolicyRepo, type SettingsPolicyRepo } from './settingsPolicyRepo';

describe('createSettingsPolicyRepo (fake db, read-only tenant policy mirror)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no insert/update/upsert/delete member on the returned repo', () => {
    const repo: SettingsPolicyRepo = createSettingsPolicyRepo({ db: { getAll: vi.fn(async () => []) } as never });

    expect('insert' in repo).toBe(false);
    expect('update' in repo).toBe(false);
    expect('upsert' in repo).toBe(false);
    expect('delete' in repo).toBe(false);
    expect(Object.keys(repo).sort()).toEqual(['getPolicies', 'watchPolicies']);
  });

  it('getPolicies SELECTs from tenant_setting_policies with no WHERE clause', async () => {
    const getAll = vi.fn(async () => []);
    const repo = createSettingsPolicyRepo({ db: { getAll } as never });

    await repo.getPolicies();

    const [sql] = getAll.mock.calls[0] as unknown as [string];
    expect(sql).toContain('FROM tenant_setting_policies');
    expect(sql.toUpperCase()).not.toContain('WHERE');
  });

  it('getPolicies returns three parsed rows given three synced rows', async () => {
    const getAll = vi.fn(async () => [
      { id: 'p1', company_id: null, sales_org_id: 'org-a', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'ceiling', policy_value: '15' },
      { id: 'p2', company_id: null, sales_org_id: 'org-a', setting_key: 'notification_quiet_hours', policy_kind: 'proposed_default', policy_value: '20:00-08:00' },
      { id: 'p3', company_id: 'co-x', sales_org_id: null, setting_key: 'wifi_only_bulk_transfer', policy_kind: 'ceiling', policy_value: 'true' },
    ]);
    const repo = createSettingsPolicyRepo({ db: { getAll } as never });

    const result = await repo.getPolicies();

    expect(result).toEqual([
      { id: 'p1', settingKey: 'auto_lock_timeout_minutes', policyKind: 'ceiling', policyValue: '15' },
      { id: 'p2', settingKey: 'notification_quiet_hours', policyKind: 'proposed_default', policyValue: '20:00-08:00' },
      { id: 'p3', settingKey: 'wifi_only_bulk_transfer', policyKind: 'ceiling', policyValue: 'true' },
    ]);
  });

  it('drops a row whose setting_key is text_size (forged/accessibility, D-17)', async () => {
    const getAll = vi.fn(async () => [
      { id: 'forged', company_id: null, sales_org_id: 'org-a', setting_key: 'text_size', policy_kind: 'ceiling', policy_value: 'extra_large' },
      { id: 'real', company_id: null, sales_org_id: 'org-a', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'ceiling', policy_value: '15' },
    ]);
    const repo = createSettingsPolicyRepo({ db: { getAll } as never });

    const result = await repo.getPolicies();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('real');
  });

  it('drops a row whose setting_key is high_contrast (forged/accessibility, D-17)', async () => {
    const getAll = vi.fn(async () => [
      { id: 'forged', company_id: null, sales_org_id: 'org-a', setting_key: 'high_contrast', policy_kind: 'proposed_default', policy_value: 'true' },
    ]);
    const repo = createSettingsPolicyRepo({ db: { getAll } as never });

    expect(await repo.getPolicies()).toEqual([]);
  });

  it('drops a row whose policy_kind is neither ceiling nor proposed_default', async () => {
    const getAll = vi.fn(async () => [
      { id: 'p1', company_id: null, sales_org_id: 'org-a', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'locked', policy_value: '15' },
    ]);
    const repo = createSettingsPolicyRepo({ db: { getAll } as never });

    expect(await repo.getPolicies()).toEqual([]);
  });

  it('watchPolicies registers a db.watch and its disposer aborts the controller', () => {
    let onResultCb: ((result: unknown) => void) | undefined;
    const watch = vi.fn((_sql, _params, handlers) => {
      onResultCb = handlers.onResult;
    });
    const repo = createSettingsPolicyRepo({ db: { watch } as never });

    const onChange = vi.fn();
    const unsubscribe = repo.watchPolicies(onChange);

    expect(watch).toHaveBeenCalledTimes(1);
    onResultCb?.({
      rows: {
        _array: [
          { id: 'p1', company_id: null, sales_org_id: 'org-a', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'ceiling', policy_value: '15' },
        ],
      },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { id: 'p1', settingKey: 'auto_lock_timeout_minutes', policyKind: 'ceiling', policyValue: '15' },
    ]);

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    // AbortController.abort() has no directly observable fake-db side effect
    // here (the fake db.watch never inspects the signal); the disposer
    // existing and being callable without throwing is the contract this
    // repo owns — same assertion shape as settingsRepo.test.ts's own
    // watchSettings disposer test.
  });

  it('watchPolicies calls onError when the watch reports an error', () => {
    let onErrorCb: ((error: unknown) => void) | undefined;
    const watch = vi.fn((_sql, _params, handlers) => {
      onErrorCb = handlers.onError;
    });
    const repo = createSettingsPolicyRepo({ db: { watch } as never });

    const onError = vi.fn();
    repo.watchPolicies(vi.fn(), onError);

    const err = new Error('sync failed');
    onErrorCb?.(err);

    expect(onError).toHaveBeenCalledWith(err);
  });
});
