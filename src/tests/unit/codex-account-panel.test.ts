import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAccountPanel } from '@/components/CodexAccountPanel';

const mockUseManagedIdeStatus = vi.fn();
const mockUseCodexAccounts = vi.fn();
const mockUseAddCodexAccount = vi.fn();
const mockUseImportCurrentCodexAccount = vi.fn();
const mockUseRefreshAllCodexAccounts = vi.fn();
const mockUseRefreshCodexAccount = vi.fn();
const mockUseActivateCodexAccount = vi.fn();
const mockUseDeleteCodexAccount = vi.fn();
const mockToast = vi.fn();
const mockSaveConfig = vi.fn();
const mockConfig = {
  codex_auto_switch_enabled: false,
  grid_layout: '2-col',
};

vi.mock('@/hooks/useManagedIde', () => ({
  useManagedIdeStatus: (...args: unknown[]) => mockUseManagedIdeStatus(...args),
  useCodexAccounts: () => mockUseCodexAccounts(),
  useAddCodexAccount: () => mockUseAddCodexAccount(),
  useImportCurrentCodexAccount: () => mockUseImportCurrentCodexAccount(),
  useRefreshAllCodexAccounts: () => mockUseRefreshAllCodexAccounts(),
  useRefreshCodexAccount: () => mockUseRefreshCodexAccount(),
  useActivateCodexAccount: () => mockUseActivateCodexAccount(),
  useDeleteCodexAccount: () => mockUseDeleteCodexAccount(),
}));

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => ({
    config: mockConfig,
    saveConfig: mockSaveConfig,
    isSaving: false,
  }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, fallbackOrOptions?: unknown) => {
      const translations: Record<string, string> = {
        'cloud.autoSwitch': 'Auto-Switch',
        'cloud.batch.selectAll': 'Select All',
        'cloud.batch.selected': `Selected ${
          typeof fallbackOrOptions === 'object' && fallbackOrOptions && 'count' in fallbackOrOptions
            ? String((fallbackOrOptions as { count: number }).count)
            : ''
        }`.trim(),
        'cloud.batch.delete': 'Delete Selected',
        'cloud.batch.confirmDelete': 'Delete selected accounts?',
        'cloud.batch.deleted': 'Deleted accounts.',
        'cloud.connectedIdentities.addNew': 'Add New Account',
        'cloud.addAccount': 'Add Account',
        'cloud.codex.actions.importCurrent': 'Import Current Session',
        'cloud.codex.actions.refreshAll': 'Refresh All',
        'cloud.codex.confirmDelete': 'Remove {{target}} from the Codex pool?',
        'cloud.codex.actions.activate': 'Activate',
        'cloud.codex.emptyTitle': 'No Codex account added yet',
        'cloud.codex.emptyDescription':
          'Import your current VS Code session or add a new ChatGPT/Codex account to start building your Codex pool.',
        'cloud.layout.twoCol': 'Two Columns',
        'cloud.layout.list': 'List Layout',
        'cloud.card.active': 'Active',
        'cloud.card.delete': 'Delete',
        'managedIde.actions.refresh': 'Refresh',
        'managedIde.labels.lastUpdated': 'Last updated',
        'managedIde.empty.unknown': 'Unknown',
        'managedIde.empty.unavailable': 'Unavailable',
        'managedIde.empty.noAccount': 'No account',
        'managedIde.session.ready': 'Ready',
        'cloud.codex.health.ready': 'Healthy',
        'cloud.codex.health.limited': 'Limited',
        'cloud.codex.health.attention': 'Needs attention',
        'cloud.codex.labels.plan': 'Plan',
        'cloud.codex.labels.status': 'Status',
        'cloud.codex.labels.primaryQuota': 'Primary window',
        'cloud.codex.labels.secondaryQuota': 'Secondary window',
        'cloud.codex.labels.accountIdPrefix': 'Account ID',
        'cloud.codex.windows.fiveHours': '5-hour window',
        'cloud.codex.windows.weekly': 'Weekly window',
        'cloud.codex.windows.generic': 'Request window',
        'a11y.expand': 'Expand',
        'a11y.collapse': 'Collapse',
        'a11y.selectAccount': 'Select {{target}}',
        'cloud.errors.codexDeleteActiveBlocked': 'Active account cannot be deleted',
      };

      let template = translations[key] ?? key;
      if (typeof fallbackOrOptions === 'object' && fallbackOrOptions) {
        for (const [optionKey, optionValue] of Object.entries(fallbackOrOptions)) {
          template = template.replace(`{{${optionKey}}}`, String(optionValue));
        }
      }

      return template;
    },
  }),
}));

function createIdleMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  };
}

function createAccount(id: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    id,
    email: `${id}@example.com`,
    label: null,
    accountId: `${id}-account`,
    authMode: 'chatgpt',
    isActive: false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 2,
    lastRefreshedAt: 123,
    snapshot: {
      session: {
        state: 'ready',
        planType: 'team',
      },
      quota: {
        primary: {
          usedPercent: 25,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 35,
          windowDurationMins: 10080,
        },
      },
      lastUpdatedAt: 123,
    },
    ...overrides,
  };
}

describe('CodexAccountPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    mockSaveConfig.mockResolvedValue(undefined);
    mockConfig.codex_auto_switch_enabled = false;
    mockConfig.grid_layout = '2-col';

    mockUseManagedIdeStatus.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: {
        installation: {
          available: true,
          idePath: 'C:\\VSCode\\Code.exe',
          codexCliPath: 'C:\\VSCode\\codex.exe',
          reason: 'ready',
        },
        session: {
          state: 'ready',
        },
      },
    });
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [],
      refetch: vi.fn(),
    });

    mockUseAddCodexAccount.mockReturnValue(createIdleMutation());
    mockUseImportCurrentCodexAccount.mockReturnValue(createIdleMutation());
    mockUseRefreshAllCodexAccounts.mockReturnValue(createIdleMutation());
    mockUseRefreshCodexAccount.mockReturnValue(createIdleMutation());
    mockUseActivateCodexAccount.mockReturnValue(createIdleMutation());
    mockUseDeleteCodexAccount.mockReturnValue(createIdleMutation());
  });

  it('uses a fixed 5 minute refresh cadence for Codex status polling', () => {
    render(React.createElement(CodexAccountPanel));

    expect(mockUseManagedIdeStatus).toHaveBeenCalledWith('vscode-codex', {
      enabled: true,
      refresh: false,
      refetchInterval: 300000,
    });
  });

  it('renders the parity toolbar and keeps import current only in the empty state', () => {
    render(React.createElement(CodexAccountPanel));

    expect(screen.getByText('Auto-Switch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh All/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add New Account' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Two Columns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'List Layout' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open VS Code' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Import Current Session' })).toHaveLength(1);
  });

  it('selects only deletable inactive accounts for batch delete', () => {
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('active', { isActive: true }), createAccount('standby-1')],
      refetch: vi.fn(),
    });

    render(React.createElement(CodexAccountPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));

    expect(screen.getByText('Selected 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeTruthy();
  });

  it('keeps Codex cards in the fixed compact view without expand controls', () => {
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('standby-1')],
      refetch: vi.fn(),
    });

    render(React.createElement(CodexAccountPanel));

    expect(screen.getAllByText('standby-1@example.com')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse' })).toBeNull();
  });

  it('applies distinct grid classes for 2-col and list layouts', () => {
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('standby-1'), createAccount('standby-2')],
      refetch: vi.fn(),
    });

    const { unmount } = render(React.createElement(CodexAccountPanel));

    expect(screen.getByTestId('codex-account-grid').className).toContain('md:grid-cols-2');

    unmount();
    mockConfig.grid_layout = 'list';

    render(React.createElement(CodexAccountPanel));

    expect(screen.getByTestId('codex-account-grid').className).toContain('grid-cols-1');
    expect(screen.getByTestId('codex-account-grid').className).not.toContain('md:grid-cols-2');
  });

  it('requires confirmation before deleting a single Codex account', () => {
    const deleteMutation = createIdleMutation();
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    mockUseDeleteCodexAccount.mockReturnValue(deleteMutation);
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('standby-1')],
      refetch: vi.fn(),
    });

    render(React.createElement(CodexAccountPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirmMock).toHaveBeenCalledWith('Remove standby-1@example.com from the Codex pool?');
    expect(deleteMutation.mutate).not.toHaveBeenCalled();
  });
});
