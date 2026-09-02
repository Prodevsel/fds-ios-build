import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionsTab, deriveConfirmTier, deriveRowState } from './SessionsTab';

/**
 * D-23/SEC-06 proof: the admin Sessions tab lists real session rows over
 * `useMySessions()`, offers a two-tier destructive confirmation (heavier for
 * the caller's own current session), never claims a completed/instant
 * revocation, and never truncates the raw Gerätekennung column.
 */

interface RawRow {
  id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user_agent?: unknown;
  ip?: unknown;
  refreshed_at?: unknown;
  not_after?: unknown;
  is_current?: unknown;
}

interface FakeRpcCall {
  fn: string;
  args: unknown;
}

function makeFakeSupabase(
  options: { rows?: RawRow[]; revokeError?: Error | null } = {},
) {
  const calls: FakeRpcCall[] = [];
  let rows = options.rows ?? [];
  const revokeError = options.revokeError ?? null;

  const supabase = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      if (fn === 'list_my_sessions') {
        return Promise.resolve({ data: rows, error: null });
      }
      if (fn === 'revoke_my_session') {
        return Promise.resolve(revokeError ? { data: null, error: revokeError } : { data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    supabase,
    calls,
    setRows(next: RawRow[]) {
      rows = next;
    },
  };
}

let currentFake: ReturnType<typeof makeFakeSupabase> = makeFakeSupabase();

vi.mock('@/lib/supabase', () => ({ getSupabase: () => currentFake.supabase }));

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(I18nextProvider, { i18n }, createElement(SessionsTab)),
    ),
  );
}

const current: RawRow = {
  id: 's1',
  created_at: '2026-08-10T10:00:00Z',
  updated_at: '2026-08-14T09:00:00Z',
  user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 — a genuinely long fixture user agent string that must wrap, not truncate',
  ip: '203.0.113.9',
  refreshed_at: '2026-08-14T09:00:00Z',
  not_after: '2026-08-14T09:15:00Z',
  is_current: true,
};

const other: RawRow = {
  id: 's2',
  created_at: '2026-08-05T10:00:00Z',
  updated_at: '2026-08-12T09:00:00Z',
  user_agent: 'okhttp/4.10.0',
  ip: null,
  refreshed_at: '2026-08-12T09:00:00Z',
  not_after: '2026-08-14T09:15:00Z',
  is_current: false,
};

/** The REAL-WORLD row shape (14-REVIEW CR-01): `not_after` is NULL for every
 *  session this project creates (`[auth.sessions].timebox` unset) and
 *  `refreshed_at` is NULL until the session's first token refresh. */
const realWorld: RawRow = {
  id: 's3',
  created_at: '2026-08-14T08:59:00Z',
  updated_at: '2026-08-14T08:59:00Z',
  user_agent: 'okhttp/5.0.0',
  ip: '203.0.113.10',
  refreshed_at: null,
  not_after: null,
  is_current: false,
};

afterEach(() => {
  currentFake = makeFakeSupabase();
});

describe('deriveConfirmTier', () => {
  it('returns "current" exactly when isCurrent is true', () => {
    expect(deriveConfirmTier({ isCurrent: true })).toBe('current');
    expect(deriveConfirmTier({ isCurrent: false })).toBe('standard');
  });
});

describe('deriveRowState', () => {
  it('returns "revoking" exactly for ids in the revoking set, "idle" otherwise', () => {
    const revokingIds = new Set(['s1']);
    expect(deriveRowState({ id: 's1' }, revokingIds)).toBe('revoking');
    expect(deriveRowState({ id: 's2' }, revokingIds)).toBe('idle');
  });
});

describe('SessionsTab', () => {
  it('renders the current-device badge and both session rows', async () => {
    currentFake = makeFakeSupabase({ rows: [current, other] });
    renderTab();

    await waitFor(() => expect(screen.getByText('Dieses Gerät')).toBeTruthy());
    expect(screen.getByText('okhttp/4.10.0')).toBeTruthy();
    expect(screen.getByText('Nicht verfügbar')).toBeTruthy();
  });

  it('a null ip renders sessions.ipUnavailable rather than an empty cell', async () => {
    currentFake = makeFakeSupabase({ rows: [other] });
    renderTab();

    await waitFor(() => expect(screen.getByText('Nicht verfügbar')).toBeTruthy());
  });

  it('renders a session whose not_after/refreshed_at are null — never the empty state (14-REVIEW CR-01)', async () => {
    currentFake = makeFakeSupabase({ rows: [realWorld] });
    renderTab();

    await waitFor(() => expect(screen.getByText('okhttp/5.0.0')).toBeTruthy());
    expect(screen.queryByText('Keine aktiven Sitzungen gefunden')).toBeNull();
    // "Zuletzt aktiv" falls back to the session's creation moment rather than
    // rendering "Invalid Date" for the null refreshed_at.
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('shows the empty state when zero sessions are returned', async () => {
    currentFake = makeFakeSupabase({ rows: [] });
    renderTab();

    await waitFor(() => expect(screen.getByText('Keine aktiven Sitzungen gefunden')).toBeTruthy());
  });

  it('opens the heavier current-device dialog tier for the current row and revokes on confirm', async () => {
    currentFake = makeFakeSupabase({ rows: [current] });
    renderTab();

    await waitFor(() => expect(screen.getByText('Dieses Gerät')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sitzung widerrufen' }));

    expect(screen.getByText('Dieses Gerät abmelden?')).toBeTruthy();
    expect(
      screen.getByText(
        'Du widerrufst die Sitzung, die du gerade benutzt. Dieses Gerät verliert den Zugriff innerhalb von 15 Minuten.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ja, dieses Gerät abmelden' }));

    await waitFor(() => expect(screen.getByText(/Wird beendet/)).toBeTruthy());
    expect(currentFake.calls.some((c) => c.fn === 'revoke_my_session' && (c.args as { p_session_id: string }).p_session_id === 's1')).toBe(true);
  });

  it('opens the lighter dialog tier for a non-current row', async () => {
    currentFake = makeFakeSupabase({ rows: [other] });
    renderTab();

    await waitFor(() => expect(screen.getByText('okhttp/4.10.0')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sitzung widerrufen' }));

    expect(screen.getByText('Wirklich widerrufen?')).toBeTruthy();
    expect(screen.queryByText('Dieses Gerät abmelden?')).toBeNull();
  });

  it('after a successful revoke the row still renders showing sessions.revokingState — never a completed state', async () => {
    currentFake = makeFakeSupabase({ rows: [other] });
    renderTab();

    await waitFor(() => expect(screen.getByText('okhttp/4.10.0')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sitzung widerrufen' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Sitzung widerrufen' });
    const dialogConfirmButton = confirmButtons.at(-1);
    if (!dialogConfirmButton) throw new Error('dialog confirm button not found');
    fireEvent.click(dialogConfirmButton);

    await waitFor(() => expect(screen.getByText(/Wird beendet/)).toBeTruthy());
    // Forbidden shapes per the UI-SPEC's Revocation-latency honesty table.
    expect(screen.queryByText(/Widerrufen ✓/)).toBeNull();
    expect(screen.queryByText(/^Sitzung beendet$/)).toBeNull();
  });

  it('a failed revoke surfaces sessions.revokeErrorGeneric', async () => {
    currentFake = makeFakeSupabase({ rows: [other], revokeError: new Error('offline') });
    renderTab();

    await waitFor(() => expect(screen.getByText('okhttp/4.10.0')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sitzung widerrufen' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Sitzung widerrufen' });
    const dialogConfirmButton = confirmButtons.at(-1);
    if (!dialogConfirmButton) throw new Error('dialog confirm button not found');
    fireEvent.click(dialogConfirmButton);

    await waitFor(() =>
      expect(
        screen.getByText('Sitzung konnte nicht widerrufen werden. Prüfe deine Verbindung und versuche es erneut.'),
      ).toBeTruthy(),
    );
  });
});
