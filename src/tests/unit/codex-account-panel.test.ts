import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const mockUseSyncCodexRuntimeState = vi.fn();
const mockOpenExternalUrl = vi.fn();
const mockToast = vi.fn();
const mockSaveConfig = vi.fn();
const mockConfig = {
  codex_auto_switch_enabled: false,
  grid_layout: '2-col',
  codex_runtime_override: null,
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
  useSyncCodexRuntimeState: () => mockUseSyncCodexRuntimeState(),
}));

vi.mock('@/actions/system', () => ({
  openExternalUrl: (input: { url: string; intent: string }) => mockOpenExternalUrl(input),
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
        'cloud.codex.actions.syncRuntime': 'WSL Sync',
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
        'managedIde.session.requires_login': 'Sign-in required',
        'cloud.codex.health.ready': 'Healthy',
        'cloud.codex.health.limited': 'Limited',
        'cloud.codex.health.attention': 'Needs attention',
        'cloud.codex.badges.runtimeMismatch': 'Runtime mismatch',
        'cloud.codex.badges.runtimeSelectionNeeded': 'Runtime selection needed',
        'cloud.codex.runtime.activeRuntime': 'Active runtime: {{name}}',
        'cloud.codex.runtime.selectionTitle':
          'Choose which runtime should receive Codex account actions.',
        'cloud.codex.runtime.selectionDescription':
          'Windows Local and WSL Remote are both available, but the active VS Code side could not be detected automatically.',
        'cloud.codex.runtime.useWindowsLocal': 'Use Windows Local',
        'cloud.codex.runtime.useWslRemote': 'Use WSL Remote',
        'cloud.codex.runtime.stateSummary': '{{name}} · {{state}}',
        'cloud.codex.pendingApply.title': 'Codex account change is queued',
        'cloud.codex.pendingApply.description':
          '{{account}} is selected for {{runtime}}. Reload or close VS Code to apply this account.',
        'cloud.codex.pendingApply.reloadAction': 'Reload VS Code',
        'cloud.codex.labels.plan': 'Plan',
        'cloud.codex.labels.status': 'Status',
        'cloud.codex.labels.primaryQuota': 'Primary window',
        'cloud.codex.labels.secondaryQuota': 'Secondary window',
        'cloud.codex.labels.accountIdPrefix': 'Account ID',
        'cloud.codex.windows.fiveHours': '5-hour window',
        'cloud.codex.windows.weekly': 'Weekly window',
        'cloud.codex.windows.generic': 'Request window',
        'cloud.codex.toast.runtimeSyncTitle': 'WSL runtime sync completed',
        'cloud.codex.toast.runtimeSyncDescription': '{{source}} -> {{target}}',
        'cloud.codex.toast.runtimeSyncFailedTitle': 'WSL runtime sync failed',
        'cloud.codex.toast.runtimeSyncWarningTitle': 'WSL runtime sync completed with warnings',
        'cloud.codex.toast.runtimeSyncWarningDescription': '{{source}} -> {{target}}. {{warnings}}',
        'cloud.codex.toast.activatedTitle': 'Codex account activated',
        'cloud.codex.toast.activatedDescription':
          'Applyron Manager switched VS Code Codex to the selected account.',
        'cloud.codex.toast.deferredActivationTitle': 'Codex account queued',
        'cloud.codex.toast.deferredActivationDescription':
          '{{account}} will be applied to {{runtime}} after you reload or close VS Code.',
        'cloud.errors.codexRuntimeSyncStateSkipped':
          'Extension state was skipped because the source or target state database was missing.',
        'a11y.expand': 'Expand',
        'a11y.collapse': 'Collapse',
        'a11y.selectAccount': 'Select {{target}}',
        'cloud.errors.codexDeleteActiveBlocked': 'Active account cannot be deleted',
        'cloud.errors.codexRuntimeSelectionRequired':
          'Choose the active Codex runtime first, then try the action again.',
        'managedIde.labels.activeRuntime': 'Active runtime',
        'managedIde.runtimes.windowsLocal': 'Windows Local',
        'managedIde.runtimes.wslRemote': 'WSL Remote',
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
    mockConfig.codex_runtime_override = null;

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
        liveAccountIdentityKey: null,
        session: {
          state: 'ready',
        },
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        pendingRuntimeApply: null,
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready' },
          },
        ],
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
    mockUseSyncCodexRuntimeState.mockReturnValue(createIdleMutation());
    mockOpenExternalUrl.mockResolvedValue(undefined);
  });

  it('uses a fixed 5 minute refresh cadence for Codex status polling', () => {
    render(React.createElement(CodexAccountPanel));

    const options = mockUseManagedIdeStatus.mock.calls[0]?.[1];
    expect(mockUseManagedIdeStatus).toHaveBeenCalledWith('vscode-codex', {
      enabled: true,
      refresh: false,
      refetchInterval: expect.any(Function),
    });
    expect(options.refetchInterval({ state: { data: undefined } })).toBe(300000);
  });

  it('switches to a 5 second refresh cadence while a runtime apply is pending', async () => {
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
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        pendingRuntimeApply: {
          runtimeId: 'wsl-remote',
          recordId: 'standby-1',
          requestedAt: 123,
        },
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready' },
          },
        ],
      },
    });

    render(React.createElement(CodexAccountPanel));

    await waitFor(() => {
      const options = mockUseManagedIdeStatus.mock.calls.at(-1)?.[1];
      expect(options).toEqual({
        enabled: true,
        refresh: false,
        refetchInterval: expect.any(Function),
      });
      expect(
        options.refetchInterval({
          state: { data: mockUseManagedIdeStatus.mock.results.at(-1)?.value.data },
        }),
      ).toBe(5000);
    });
  });

  it('renders the parity toolbar and keeps import current only in the empty state', () => {
    render(React.createElement(CodexAccountPanel));

    expect(screen.getByText('Auto-Switch')).toBeTruthy();
    expect(screen.getByText('Active runtime')).toBeTruthy();
    expect(screen.getByText('Windows Local')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Refresh All/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add New Account' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Two Columns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'List Layout' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open VS Code' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Import Current Session' })).toHaveLength(1);
  });

  it('shows runtime mismatch and sync controls when both runtimes are available', () => {
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
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: true,
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready', email: 'first@example.com' },
          },
          {
            id: 'wsl-remote',
            installation: { available: true },
            session: { state: 'ready', email: 'second@example.com' },
          },
        ],
      },
    });

    render(React.createElement(CodexAccountPanel));

    expect(screen.getByText('Runtime mismatch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'WSL Sync' })).toBeTruthy();
  });

  it('treats state-only WSL sync warnings as a normal success toast', () => {
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
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready' },
          },
          {
            id: 'wsl-remote',
            installation: { available: true },
            session: { state: 'ready' },
          },
        ],
      },
    });
    mockUseSyncCodexRuntimeState.mockReturnValue({
      isPending: false,
      variables: undefined,
      mutate: (
        _value: unknown,
        options?: {
          onSuccess?: (result: {
            sourceRuntimeId: string;
            targetRuntimeId: string;
            syncedAuthFile: boolean;
            syncedExtensionState: boolean;
            warnings: string[];
          }) => void;
        },
      ) => {
        options?.onSuccess?.({
          sourceRuntimeId: 'windows-local',
          targetRuntimeId: 'wsl-remote',
          syncedAuthFile: true,
          syncedExtensionState: false,
          warnings: ['CODEX_RUNTIME_SYNC_STATE_SKIPPED'],
        });
      },
    });

    render(React.createElement(CodexAccountPanel));

    fireEvent.click(screen.getByRole('button', { name: 'WSL Sync' }));

    const toastCall = mockToast.mock.calls.at(-1)?.[0];
    expect(toastCall).toEqual({
      title: 'WSL runtime sync completed',
      description: 'Windows Local -> WSL Remote',
    });
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

  it('prefers the live runtime identity when marking the active Codex card', () => {
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
        liveAccountIdentityKey: 'standby-1-account',
        session: {
          state: 'ready',
        },
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        pendingRuntimeApply: null,
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready' },
          },
        ],
      },
    });
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('stale-active', { isActive: true }), createAccount('standby-1')],
      refetch: vi.fn(),
    });

    render(React.createElement(CodexAccountPanel));

    const liveHeading = screen.getByRole('heading', { name: 'standby-1@example.com' });
    const staleHeading = screen.getByRole('heading', { name: 'stale-active@example.com' });

    expect(liveHeading.parentElement?.textContent).toContain('Active');
    expect(staleHeading.parentElement?.textContent).not.toContain('Active');
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeTruthy();
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

  it('shows a pending runtime apply banner with the selected account and runtime', () => {
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
        activeRuntimeId: 'windows-local',
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        pendingRuntimeApply: {
          runtimeId: 'wsl-remote',
          recordId: 'standby-1',
          requestedAt: 123,
        },
        runtimes: [
          {
            id: 'windows-local',
            installation: { available: true },
            session: { state: 'ready' },
          },
        ],
      },
    });
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('standby-1')],
      refetch: vi.fn(),
    });

    render(React.createElement(CodexAccountPanel));

    expect(screen.getByTestId('codex-pending-runtime-apply')).toBeTruthy();
    expect(screen.getByText('Codex account change is queued')).toBeTruthy();
    expect(
      screen.getByText(
        'standby-1@example.com is selected for WSL Remote. Reload or close VS Code to apply this account.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload VS Code' }));
    expect(mockOpenExternalUrl).toHaveBeenCalledWith({
      url: 'vscode://command/workbench.action.reloadWindow',
      intent: 'vscode_command',
    });
  });

  it('shows a deferred activation toast when VS Code must close before apply', () => {
    mockUseCodexAccounts.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [createAccount('standby-1')],
      refetch: vi.fn(),
    });
    mockUseActivateCodexAccount.mockReturnValue({
      isPending: false,
      variables: undefined,
      mutate: (
        accountId: string,
        options?: {
          onSuccess?: (result: {
            account: { id: string; email: string | null };
            appliedRuntimeId: 'windows-local' | 'wsl-remote';
            didRestartIde: boolean;
            deferredUntilIdeRestart: boolean;
          }) => void;
        },
      ) => {
        expect(accountId).toBe('standby-1');
        options?.onSuccess?.({
          account: {
            id: 'standby-1',
            email: 'standby-1@example.com',
          },
          appliedRuntimeId: 'wsl-remote',
          didRestartIde: false,
          deferredUntilIdeRestart: true,
        });
      },
    });

    render(React.createElement(CodexAccountPanel));

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(mockToast).toHaveBeenLastCalledWith({
      title: 'Codex account queued',
      description:
        'standby-1@example.com will be applied to WSL Remote after you reload or close VS Code.',
    });
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
