import i18n from '@/i18n';
import type { AdminRole } from '@/lib/auth/roles';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteWipeTab } from './RemoteWipeTab';
import type { DeviceWipeOrderRow } from './useDeviceWipeOrders';

/**
 * D-02/D-03 proof: the "Fernlöschung" tab renders the four-state,
 * count-bearing status model (never a boolean pill), splits `locked_stalled`
 * into two DIFFERENT presentations sharing one badge variant, and gates the
 * destructive escape hatch three ways — role, status, and a count-bearing
 * confirmation whose rendered number is exactly what `forcePurge` receives.
 */

const mocks = vi.hoisted(() => ({
  session: { session: null, role: 'operator' as AdminRole | null, loading: false },
  wipeOrders: {
    rows: [] as DeviceWipeOrderRow[],
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
    issue: vi.fn(async () => 'queued' as const),
    forcePurge: vi.fn(async () => 'forced' as const),
  },
  reps: {
    data: [
      { id: 'm1', userId: 'rep-1', name: 'Alice Rep', role: 'rep', status: 'synced' },
      { id: 'm2', userId: 'rep-2', name: 'Bob Rep', role: 'rep', status: 'synced' },
    ],
  },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));
vi.mock('@/features/reps/useReps', () => ({ useReps: () => mocks.reps }));
vi.mock('./useDeviceWipeOrders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDeviceWipeOrders')>();
  return { ...actual, useDeviceWipeOrders: () => mocks.wipeOrders };
});

function renderTab() {
  return render(createElement(I18nextProvider, { i18n }, createElement(RemoteWipeTab)));
}

function baseRow(overrides: Partial<DeviceWipeOrderRow> = {}): DeviceWipeOrderRow {
  return {
    id: 'order-1',
    repId: 'rep-1',
    repName: 'Alice Rep',
    deviceId: 'device-abc',
    status: 'locked_draining',
    stallReason: null,
    pendingArtifactCount: 5,
    issuedAt: '2026-08-10T10:00:00Z',
    lastProgressAt: '2026-08-11T10:00:00Z',
    completedAt: null,
    forcedByName: null,
    forcedAt: null,
    forcedDiscardedCount: null,
    ...overrides,
  };
}

afterEach(() => {
  mocks.session = { session: null, role: 'operator', loading: false };
  mocks.wipeOrders = {
    rows: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    issue: vi.fn(async () => 'queued'),
    forcePurge: vi.fn(async () => 'forced'),
  };
  mocks.reps = {
    data: [
      { id: 'm1', userId: 'rep-1', name: 'Alice Rep', role: 'rep', status: 'synced' },
      { id: 'm2', userId: 'rep-2', name: 'Bob Rep', role: 'rep', status: 'synced' },
    ],
  };
});

describe('RemoteWipeTab', () => {
  it('a locked_stalled row with stallReason "unverified_path" renders the escalation copy, NOT the queue sentence', () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'locked_stalled', stallReason: 'unverified_path' })];
    renderTab();

    expect(
      screen.getByText(/Speicherort auf dem Gerät nicht bestätigt/),
    ).toBeTruthy();
    expect(screen.queryByText(/Warteschlange blockiert/)).toBeNull();
  });

  it('the unverified-path copy renders no artifact count', () => {
    mocks.wipeOrders.rows = [
      baseRow({ status: 'locked_stalled', stallReason: 'unverified_path', pendingArtifactCount: 9 }),
    ];
    renderTab();

    const statusText = screen.getByText(/Speicherort auf dem Gerät nicht bestätigt/).textContent ?? '';
    expect(statusText).not.toMatch(/9/);
  });

  it('a locked_stalled row with stallReason "queue" renders the queue sentence with the live count', () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'locked_stalled', stallReason: 'queue', pendingArtifactCount: 3 })];
    renderTab();

    expect(screen.getByText(/Warteschlange blockiert, 3 Artefakte hängen fest/)).toBeTruthy();
  });

  it('a locked_draining row renders the draining copy with the live count', () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'locked_draining', pendingArtifactCount: 5 })];
    renderTab();

    expect(screen.getByText(/5 Artefakte werden noch übertragen/)).toBeTruthy();
  });

  it('the force-purge CTA is absent for a queued row', () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'queued', pendingArtifactCount: 0 })];
    renderTab();

    expect(screen.queryByRole('button', { name: 'Jetzt löschen' })).toBeNull();
  });

  it('the force-purge CTA is absent for a non-operator role, and the whole tab renders the not-authorized card instead', () => {
    mocks.session = { session: null, role: 'team_lead', loading: false };
    mocks.wipeOrders.rows = [baseRow({ status: 'locked_draining' })];
    renderTab();

    expect(screen.queryByRole('button', { name: 'Jetzt löschen' })).toBeNull();
    expect(screen.getByText('Nur Operator können eine Fernlöschung auslösen.')).toBeTruthy();
  });

  it('the force-confirm button label contains the discard count, and the same count is passed to forcePurge', async () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'locked_draining', pendingArtifactCount: 12 })];
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt löschen' }));

    const confirmButton = screen.getByRole('button', { name: 'Ja, 12 Elemente verwerfen' });
    expect(confirmButton).toBeTruthy();

    fireEvent.click(confirmButton);
    expect(mocks.wipeOrders.forcePurge).toHaveBeenCalledWith('order-1', 12);
  });

  it('the trigger CTA renders with variant="outline", never variant="destructive"', () => {
    mocks.wipeOrders.rows = [];
    renderTab();

    const triggerButton = screen.getByRole('button', { name: 'Fernlöschung auslösen' });
    expect(triggerButton.className).toMatch(/border-input/); // outline variant token class
    expect(triggerButton.className).not.toMatch(/bg-destructive/);
  });

  it('wipe.forcedNote renders with all three interpolations once forcedAt is set', () => {
    mocks.wipeOrders.rows = [
      baseRow({
        status: 'purged_complete',
        completedAt: '2026-08-15T12:00:00Z',
        forcedAt: '2026-08-15T12:00:00Z',
        forcedByName: 'Carla Operator',
        forcedDiscardedCount: 4,
      }),
    ];
    renderTab();

    expect(screen.getByText(/Manuell abgeschlossen von Carla Operator am/)).toBeTruthy();
    expect(screen.getByText(/4 Elemente verworfen\./)).toBeTruthy();
  });

  it('shows the empty state when no orders exist', () => {
    mocks.wipeOrders.rows = [];
    renderTab();

    expect(screen.getByText('Keine Fernlöschungen angeordnet')).toBeTruthy();
  });

  it('renders an em dash for a device id that has not claimed the order yet', () => {
    mocks.wipeOrders.rows = [baseRow({ status: 'queued', deviceId: null, pendingArtifactCount: 0 })];
    renderTab();

    expect(screen.getByText('—')).toBeTruthy();
  });
});
