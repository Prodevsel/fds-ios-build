import { describe, expect, it, vi } from 'vitest';
import { createAssignableRepsRepo, UNNAMED_REP_PLACEHOLDER } from './assignableRepsRepo';

interface FakeDb {
  watch: ReturnType<typeof vi.fn>;
}

function fakeDb(): FakeDb {
  return { watch: vi.fn() };
}

describe('assignableRepsRepo.watchAssignableReps', () => {
  it('queries memberships joined to app_users, scoped to the given team_id', () => {
    const db = fakeDb();
    const repo = createAssignableRepsRepo({ db: db as never });

    repo.watchAssignableReps('team-a', vi.fn());

    expect(db.watch).toHaveBeenCalledTimes(1);
    const [sql, params] = db.watch.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM memberships');
    expect(sql).toContain('JOIN app_users');
    expect(sql).toContain('memberships.team_id = ?');
    expect(params).toEqual(['team-a']);
  });

  it('maps rows to { id, fullName }', () => {
    const db = fakeDb();
    const repo = createAssignableRepsRepo({ db: db as never });
    const onChange = vi.fn();

    repo.watchAssignableReps('team-a', onChange);
    const onResult = db.watch.mock.calls[0]![2].onResult as (result: unknown) => void;
    onResult({
      rows: { _array: [{ id: 'rep-1', full_name: 'Rep One' }] },
    });

    expect(onChange).toHaveBeenCalledWith([{ id: 'rep-1', fullName: 'Rep One' }]);
  });

  it('falls back to a stable placeholder when full_name is null/empty', () => {
    const db = fakeDb();
    const repo = createAssignableRepsRepo({ db: db as never });
    const onChange = vi.fn();

    repo.watchAssignableReps('team-a', onChange);
    const onResult = db.watch.mock.calls[0]![2].onResult as (result: unknown) => void;
    onResult({
      rows: {
        _array: [
          { id: 'rep-1', full_name: null },
          { id: 'rep-2', full_name: '' },
        ],
      },
    });

    expect(onChange).toHaveBeenCalledWith([
      { id: 'rep-1', fullName: UNNAMED_REP_PLACEHOLDER },
      { id: 'rep-2', fullName: UNNAMED_REP_PLACEHOLDER },
    ]);
  });

  it('forwards watch errors to onError', () => {
    const db = fakeDb();
    const repo = createAssignableRepsRepo({ db: db as never });
    const onError = vi.fn();

    repo.watchAssignableReps('team-a', vi.fn(), onError);
    const onWatchError = db.watch.mock.calls[0]![2].onError as (error: unknown) => void;
    onWatchError('boom');

    expect(onError).toHaveBeenCalledWith('boom');
  });
});
