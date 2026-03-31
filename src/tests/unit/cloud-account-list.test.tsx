import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudAccountList } from '../../components/CloudAccountList';

const mockStartAuthFlow = vi.fn();
const mockToast = vi.fn();
const mockUseCloudAccounts = vi.fn();
const mockDeleteCloudAccount = vi.fn();
const mockDeleteCloudAccountsBatch = vi.fn();

vi.mock('../../hooks/useCloudAccounts', () => ({
  useCloudAccounts: () => mockUseCloudAccounts(),
  useRefreshQuota: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useDeleteCloudAccount: () => ({
    mutate: mockDeleteCloudAccount,
    isPending: false,
    variables: undefined,
  }),
  useDeleteCloudAccountsBatch: () => ({
    mutate: mockDeleteCloudAccountsBatch,
    isPending: false,
    variables: undefined,
  }),
  useAddGoogleAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useSwitchCloudAccount: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useAutoSwitchEnabled: () => ({ data: false, isLoading: false }),
  useSetAutoSwitchEnabled: () => ({ mutate: vi.fn(), isPending: false }),
  useForcePollCloudMonitor: () => ({ mutate: vi.fn(), isPending: false }),
  startAuthFlow: () => mockStartAuthFlow(),
}));

vi.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: {
      grid_layout: '2-col',
      model_visibility: {},
    },
    saveConfig: vi.fn(),
  }),
}));

vi.mock('../../components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('../../components/CloudAccountCard', () => ({
  CloudAccountCard: ({
    account,
    onToggleSelection,
  }: {
    account: { id: string; email: string };
    onToggleSelection: (id: string, selected: boolean) => void;
  }) =>
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': `cloud-account-card-${account.id}`,
        onClick: () => onToggleSelection(account.id, true),
      },
      account.email,
    ),
}));

vi.mock('../../components/IdentityProfileDialog', () => ({
  IdentityProfileDialog: () =>
    React.createElement('div', { 'data-testid': 'identity-profile-dialog' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'cloud.connectedIdentities.addNew': 'Add New Account',
        'cloud.addAccount': 'Add Account',
        'cloud.authDialog.title': 'Add Google Account',
        'cloud.authDialog.description': 'Authorize the application.',
        'cloud.authDialog.openLogin': 'Open Login Page',
        'cloud.authDialog.startErrorTitle': 'Google sign-in could not be started',
        'cloud.authDialog.authCode': 'Authorization Code',
        'cloud.authDialog.placeholder': 'Paste the code',
        'cloud.authDialog.instruction': 'Copy the localhost code.',
        'cloud.authDialog.verify': 'Verify & Add',
        'cloud.connectedIdentities.title': 'Connected AI Identities',
        'cloud.connectedIdentities.description': 'Manage your neural network integrations',
        'cloud.stats.total': 'Total Accounts',
        'cloud.stats.active': 'Active',
        'cloud.stats.rateLimited': 'Rate Limited',
        'cloud.autoSwitch': 'Auto-Switch',
        'cloud.batch.selectAll': 'Select All',
        'cloud.batch.selected': '{{count}} selected',
        'cloud.batch.delete': 'Delete Selected',
        'cloud.batch.confirmDelete': 'Delete {{count}} accounts?',
        'cloud.batch.deleted': '{{count}} accounts deleted',
        'cloud.batch.partialDeleteTitle': 'Some accounts could not be deleted',
        'cloud.batch.resultSummary': '{{deletedCount}} deleted / {{failedCount}} failed',
        'cloud.checkQuota': 'Check Quota',
        'cloud.layout.twoCol': '2 Columns',
        'cloud.layout.list': 'List',
        'cloud.list.noAccounts': 'No cloud accounts yet.',
        'cloud.list.emptyDescription': 'Click Add New Account to connect one.',
        'cloud.toast.deleted': 'Deleted',
        'cloud.toast.deleteFailed': 'Delete failed',
        'cloud.errors.authFlowStartFailed':
          'Google sign-in could not be started. Please try again.',
      };

      let template = translations[key] ?? key;
      if (options) {
        for (const [optionKey, optionValue] of Object.entries(options)) {
          template = template.replace(`{{${optionKey}}}`, String(optionValue));
        }
      }
      return template;
    },
  }),
}));

describe('CloudAccountList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCloudAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      errorUpdatedAt: 0,
      refetch: vi.fn(),
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('shows an inline error banner when Google auth flow cannot start', async () => {
    mockStartAuthFlow.mockRejectedValue(new Error('Loopback port is already in use.'));

    render(React.createElement(CloudAccountList));

    await userEvent.click(screen.getByRole('button', { name: 'Add New Account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Login Page' }));

    await waitFor(() => {
      expect(screen.getByTestId('cloud-auth-start-error')).toBeTruthy();
    });

    expect(screen.getByText('Google sign-in could not be started')).toBeTruthy();
    expect(screen.getByText('Google sign-in could not be started. Please try again.')).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('keeps failed accounts selected and shows a partial summary after batch delete', async () => {
    mockUseCloudAccounts.mockReturnValue({
      data: [
        {
          id: 'acc-1',
          email: 'one@test.dev',
          name: 'One',
          provider: 'google',
          token: {
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 3600,
            expiry_timestamp: 9999999999,
            token_type: 'Bearer',
            email: 'one@test.dev',
          },
          created_at: 1,
          last_used: 1,
        },
        {
          id: 'acc-2',
          email: 'two@test.dev',
          name: 'Two',
          provider: 'google',
          token: {
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 3600,
            expiry_timestamp: 9999999999,
            token_type: 'Bearer',
            email: 'two@test.dev',
          },
          created_at: 1,
          last_used: 1,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      errorUpdatedAt: 0,
      refetch: vi.fn(),
    });
    mockDeleteCloudAccountsBatch.mockImplementation(
      (
        _input: { accountIds: string[] },
        options?: {
          onSuccess?: (result: {
            deletedIds: string[];
            failed: Array<{ accountId: string; message: string }>;
          }) => void;
        },
      ) => {
        options?.onSuccess?.({
          deletedIds: ['acc-1'],
          failed: [{ accountId: 'acc-2', message: 'locked' }],
        });
      },
    );

    render(React.createElement(CloudAccountList));

    await userEvent.click(screen.getByTestId('cloud-account-card-acc-1'));
    await userEvent.click(screen.getByTestId('cloud-account-card-acc-2'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));

    expect(mockDeleteCloudAccountsBatch).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Some accounts could not be deleted',
        description: '1 deleted / 1 failed',
        variant: 'destructive',
      }),
    );
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('renders the fallback error state when cloud accounts fail to load', async () => {
    mockUseCloudAccounts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('internal server error'),
      errorUpdatedAt: 123,
      refetch: vi.fn(),
    });

    render(React.createElement(CloudAccountList));

    expect(screen.getByTestId('cloud-load-error-fallback')).toBeTruthy();
    expect(screen.getByTestId('cloud-load-error-retry')).toBeTruthy();
  });
});
