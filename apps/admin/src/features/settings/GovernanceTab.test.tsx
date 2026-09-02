import i18n from '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { GovernanceTab } from './GovernanceTab';

/**
 * D-19 proof: the fourth "Vorgaben" tab renders exactly the five allowed
 * auto-lock values (the admin-side half of the D-18 anti-drift net), never
 * offers a control for a key without a real column or without a legal basis
 * (D-04), and a non-operator session sees no write affordance at all.
 */

function renderTab(props: Partial<React.ComponentProps<typeof GovernanceTab>> = {}) {
  const defaultProps: React.ComponentProps<typeof GovernanceTab> = {
    role: 'operator',
    loading: false,
    hasAnyPolicy: true,
    autoLockValue: 15,
    onAutoLockChange: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <GovernanceTab {...defaultProps} {...props} />
    </I18nextProvider>,
  );
}

describe('GovernanceTab', () => {
  it('renders exactly five auto-lock options with values 1, 5, 15, 30, 60', () => {
    renderTab();
    const select = screen.getByLabelText('Automatische Sperre nach') as HTMLSelectElement;
    const optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(optionValues).toEqual(['1', '5', '15', '30', '60']);
  });

  it('calls onAutoLockChange with the numeric value when a new option is selected', () => {
    const onAutoLockChange = vi.fn();
    renderTab({ onAutoLockChange });
    const select = screen.getByLabelText('Automatische Sperre nach') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '30' } });
    expect(onAutoLockChange).toHaveBeenCalledWith(30);
  });

  it('shows the empty state when the tenant has no policy rows at all', () => {
    renderTab({ hasAnyPolicy: false, autoLockValue: null });
    expect(screen.getByText('Noch keine Vorgaben festgelegt')).toBeTruthy();
  });

  it('does not show the empty state once a policy row exists', () => {
    renderTab({ hasAnyPolicy: true, autoLockValue: 15 });
    expect(screen.queryByText('Noch keine Vorgaben festgelegt')).toBeNull();
  });

  it('a non-operator session renders no select control and no save affordance', () => {
    renderTab({ role: 'team_lead' });
    expect(screen.queryByLabelText('Automatische Sperre nach')).toBeNull();
    expect(screen.queryByRole('button', { name: /speichern/i })).toBeNull();
  });

  it('a non-operator session renders no select control even when role is null', () => {
    renderTab({ role: null });
    expect(screen.queryByLabelText('Automatische Sperre nach')).toBeNull();
  });

  it('renders no control or reference for keys without a real column or a legal ceiling basis', () => {
    const { container } = renderTab();
    expect(container.innerHTML).not.toMatch(
      /notification_quiet_hours|scanner_torch_default|wifi_only_bulk_transfer/,
    );
  });

  it('shows a loading skeleton while data resolves', () => {
    const { container } = renderTab({ loading: true });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByLabelText('Automatische Sperre nach')).toBeNull();
  });
});
