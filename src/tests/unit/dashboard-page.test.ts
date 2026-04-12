import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '@/components/DashboardPage';
import type { AppUpdateStatus } from '@/types/dashboard';

const mockGetDashboardAnnouncements = vi.fn();
const mockGetServiceHealthSummary = vi.fn();
const mockCheckForUpdatesManual = vi.fn();
const mockInstallDownloadedUpdate = vi.fn();
const mockOpenExternalUrl = vi.fn();
const mockUseAppUpdateStatus = vi.fn();
const mockUseCloudAccounts = vi.fn();
const mockUseCodexAccounts = vi.fn();
const mockUseManagedIdeStatus = vi.fn();
const mockUseAppConfig = vi.fn();
const mockUseConnectivityStatus = vi.fn();
const mockToast = vi.fn();

vi.mock('@/actions/app', () => ({
  getDashboardAnnouncements: () => mockGetDashboardAnnouncements(),
  getServiceHealthSummary: () => mockGetServiceHealthSummary(),
  checkForUpdatesManual: () => mockCheckForUpdatesManual(),
  installDownloadedUpdate: () => mockInstallDownloadedUpdate(),
}));

vi.mock('@/hooks/useAppUpdateStatus', () => ({
  APP_UPDATE_STATUS_QUERY_KEY: ['app', 'update-status'],
  useAppUpdateStatus: (options?: { owner?: boolean }) => mockUseAppUpdateStatus(options),
}));

vi.mock('@/actions/system', () => ({
  openExternalUrl: (input: { url: string; intent: string }) => mockOpenExternalUrl(input),
}));

vi.mock('@/hooks/useCloudAccounts', () => ({
  useCloudAccounts: () => mockUseCloudAccounts(),
}));

vi.mock('@/hooks/useManagedIde', () => ({
  useCodexAccounts: () => mockUseCodexAccounts(),
  useManagedIdeStatus: (...args: unknown[]) => mockUseManagedIdeStatus(...args),
}));

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => mockUseAppConfig(),
}));

vi.mock('@/hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => mockUseConnectivityStatus(),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) =>
    React.createElement('a', { href: to }, children),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'dashboard.eyebrow': 'Mission Control',
        'dashboard.title': 'Dashboard',
        'dashboard.description':
          'Track updates, recent announcements, and the accounts currently powering your workspace.',
        'dashboard.stats.activeAccounts': 'Active Accounts',
        'dashboard.stats.announcements': 'Announcements',
        'dashboard.stats.currentVersion': 'Current Build',
        'dashboard.update.kicker': 'Update Status',
        'dashboard.update.title': 'Application Updates',
        'dashboard.update.description':
          'Keep this installation aligned with the latest Applyron Manager release.',
        'dashboard.update.currentVersionLabel': 'Installed version',
        'dashboard.update.latestVersionLabel': 'Latest version',
        'dashboard.update.lastCheckedLabel': 'Last checked',
        'dashboard.update.checkButton': 'Check for updates',
        'dashboard.update.restartButton': 'Restart and install',
        'dashboard.update.status.idle': 'Ready to check',
        'dashboard.update.status.checking': 'Checking now',
        'dashboard.update.status.up_to_date': 'Up to date',
        'dashboard.update.status.update_available': 'Update available',
        'dashboard.update.status.ready_to_install': 'Ready to install',
        'dashboard.update.status.error': 'Action required',
        'dashboard.announcements.kicker': 'Announcements',
        'dashboard.announcements.title': 'Latest Announcements',
        'dashboard.announcements.description':
          'Release notes, maintenance windows, and important platform notices.',
        'dashboard.announcements.loading': 'Loading announcements...',
        'dashboard.announcements.emptyTitle': 'No announcements yet',
        'dashboard.announcements.emptyDescription': 'New updates and notices will appear here.',
        'dashboard.announcements.errorTitle': 'Announcements are temporarily unavailable',
        'dashboard.announcements.errorDescription':
          'The dashboard could not load the remote feed right now.',
        'dashboard.announcements.level.info': 'Info',
        'dashboard.announcements.level.success': 'Success',
        'dashboard.announcements.level.warning': 'Warning',
        'dashboard.announcements.level.critical': 'Critical',
        'dashboard.activeAccounts.kicker': 'Active Accounts',
        'dashboard.activeAccounts.title': 'Live Account Snapshot',
        'dashboard.activeAccounts.description':
          'See which Antigravity and Codex accounts are currently active without leaving the dashboard.',
        'dashboard.activeAccounts.goToAccounts': 'Go to Accounts',
        'dashboard.activeAccounts.loading': 'Loading active accounts...',
        'dashboard.activeAccounts.emptyTitle': 'No active account yet',
        'dashboard.activeAccounts.emptyDescription':
          'Activate an Antigravity or Codex account to see it here.',
        'dashboard.activeAccounts.emptyClassic': 'No active Antigravity account selected.',
        'dashboard.activeAccounts.emptyCodex': 'No active Codex account selected.',
        'dashboard.activeAccounts.sources.classic': 'Antigravity',
        'dashboard.activeAccounts.sources.codex': 'Codex',
        'dashboard.activeAccounts.slots.antigravity': 'Antigravity',
        'dashboard.activeAccounts.slots.codex': 'Codex',
        'dashboard.activeAccounts.classicNoQuota': 'No quota snapshot yet',
        'dashboard.activeAccounts.codexNoQuota': 'No Codex quota snapshot yet',
        'dashboard.health.kicker': 'System Health',
        'dashboard.health.description':
          'Live service state for config, auth, proxy, monitors, and transport.',
        'dashboard.health.lastUpdated': 'Updated',
        'dashboard.health.states.idle': 'Idle',
        'dashboard.health.states.starting': 'Starting',
        'dashboard.health.states.ready': 'Ready',
        'dashboard.health.states.error': 'Error',
        'dashboard.health.services.config': 'Config',
        'dashboard.health.services.auth_server': 'Google Auth',
        'dashboard.health.services.proxy_server': 'API Proxy',
        'dashboard.health.services.cloud_monitor': 'Antigravity Monitor',
        'dashboard.health.services.codex_monitor': 'Codex Monitor',
        'dashboard.health.services.orpc_transport': 'ORPC Transport',
        'dashboard.operationalAlerts.kicker': 'Operational Alerts',
        'dashboard.operationalAlerts.description':
          'Proactive warnings and blockers gathered from connectivity, account state, and runtime health.',
        'dashboard.operationalAlerts.emptyTitle': 'No active operational alerts',
        'dashboard.operationalAlerts.emptyDescription':
          'The current session looks healthy. New issues will surface here before they become blockers.',
        'dashboard.operationalAlerts.items.offline.title': 'The app is offline',
        'dashboard.operationalAlerts.items.offline.description':
          'Remote operations like update checks and cloud refresh are paused until connectivity returns.',
        'dashboard.operationalAlerts.cta.accounts': 'Open Accounts',
        'dashboard.operationalAlerts.cta.proxy': 'Open Proxy',
        'dashboard.operationalAlerts.cta.settings': 'Open Settings',
        'error.generic': 'An unexpected error occurred.',
        'error.offline': "You're offline right now. Reconnect to continue this network action.",
        'cloud.card.active': 'Active',
        'cloud.card.rateLimited': 'Rate Limited',
        'cloud.card.expired': 'Expired',
        'cloud.codex.health.ready': 'Healthy',
        'cloud.codex.health.limited': 'Limited',
        'cloud.codex.health.attention': 'Needs attention',
        'managedIde.empty.noAccount': 'No account',
      };

      if (key === 'dashboard.activeAccounts.classicQuotaSummary') {
        return `${String(options?.percentage)}% avg across ${String(options?.count)} visible models`;
      }

      if (key === 'dashboard.activeAccounts.primaryRemaining') {
        return `Primary ${String(options?.value)}% left`;
      }

      if (key === 'dashboard.activeAccounts.secondaryRemaining') {
        return `Secondary ${String(options?.value)}% left`;
      }

      if (key === 'dashboard.activeAccounts.planType') {
        return `Plan ${String(options?.value)}`;
      }

      if (typeof options?.defaultValue === 'string' && !(key in translations)) {
        return options.defaultValue;
      }

      return translations[key] ?? key;
    },
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderDashboard() {
  const queryClient = createQueryClient();

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(DashboardPage),
    ),
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    mockUseAppConfig.mockReturnValue({
      config: {
        model_visibility: {},
      },
    });
    mockUseConnectivityStatus.mockReturnValue('online');

    mockUseCloudAccounts.mockReturnValue({
      data: [
        {
          id: 'classic-1',
          email: 'classic@example.com',
          name: 'Antigravity One',
          status: 'active',
          is_active: true,
          quota: {
            models: {
              'gemini-3-flash': {
                percentage: 82,
                resetTime: '2026-03-24T10:00:00Z',
              },
            },
          },
        },
      ],
      isLoading: false,
    });

    mockUseCodexAccounts.mockReturnValue({
      data: [
        {
          id: 'codex-1',
          email: 'codex@example.com',
          label: 'Codex Primary',
          accountId: 'acc-1',
          authMode: 'chatgpt',
          isActive: true,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 2,
          lastRefreshedAt: 3,
          snapshot: {
            session: {
              state: 'ready',
              planType: 'team',
            },
            quota: {
              primary: {
                usedPercent: 25,
              },
              secondary: {
                usedPercent: 40,
              },
            },
          },
        },
      ],
      isLoading: false,
    });
    mockUseManagedIdeStatus.mockReturnValue({
      data: {
        liveAccountIdentityKey: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    const updateStatus: AppUpdateStatus = {
      status: 'up_to_date',
      currentVersion: '0.10.0',
      latestVersion: '0.10.0',
      lastCheckedAt: Date.now(),
      message: null,
    };
    mockUseAppUpdateStatus.mockReturnValue({
      data: updateStatus,
      isError: false,
      error: null,
    });

    mockCheckForUpdatesManual.mockResolvedValue({
      status: 'checking',
      currentVersion: '0.10.0',
      latestVersion: '0.10.1',
      lastCheckedAt: Date.now(),
      message: null,
    });
    mockInstallDownloadedUpdate.mockResolvedValue({
      status: 'ready_to_install',
      currentVersion: '0.10.0',
      latestVersion: '0.10.1',
      lastCheckedAt: Date.now(),
      message: null,
    });

    mockOpenExternalUrl.mockResolvedValue(undefined);
    mockGetServiceHealthSummary.mockResolvedValue({
      services: [
        {
          id: 'config',
          label: 'Config',
          state: 'ready',
          message: null,
          updatedAt: Date.now(),
        },
        {
          id: 'proxy_server',
          label: 'API Proxy',
          state: 'idle',
          message: 'Auto-start is disabled.',
          updatedAt: Date.now(),
        },
      ],
      hasErrors: false,
      updatedAt: Date.now(),
    });
    mockGetDashboardAnnouncements.mockResolvedValue([
      {
        id: 'ann-1',
        publishedAt: '2026-03-24T09:00:00Z',
        level: 'info',
        url: 'https://applyron.com/releases/ann-1',
        title: {
          tr: 'Duyuru 1',
          en: 'Announcement 1',
        },
        body: {
          tr: 'Icerik 1',
          en: 'Body 1',
        },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders update status, announcements, and combined active accounts', async () => {
    renderDashboard();

    expect(await screen.findByText('Application Updates')).toBeTruthy();
    expect(await screen.findByText('Announcement 1')).toBeTruthy();
    expect(await screen.findByText('Antigravity One')).toBeTruthy();
    expect(await screen.findByText('Codex Primary')).toBeTruthy();
    expect(await screen.findByTestId('service-health-config')).toBeTruthy();
    expect(screen.getAllByText('Antigravity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Codex').length).toBeGreaterThan(0);
    expect(mockUseAppUpdateStatus).toHaveBeenCalledWith(undefined);
    expect(mockUseManagedIdeStatus).toHaveBeenCalledWith('vscode-codex', {
      enabled: true,
      refresh: false,
      refetchInterval: false,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

    await waitFor(() => {
      expect(mockCheckForUpdatesManual).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId('announcement-card-ann-1'));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith({
      url: 'https://applyron.com/releases/ann-1',
      intent: 'announcement',
    });
  });

  it('shows the announcement fallback when the remote feed fails', async () => {
    mockGetDashboardAnnouncements.mockRejectedValue(new Error('Announcements feed returned 503'));

    renderDashboard();

    expect(await screen.findByText('Announcements are temporarily unavailable')).toBeTruthy();
  });

  it('shows the empty announcement state when the remote feed returns no items', async () => {
    mockGetDashboardAnnouncements.mockResolvedValue([]);

    renderDashboard();

    expect(await screen.findByText('No announcements yet')).toBeTruthy();
  });

  it('shows account query errors instead of empty states', async () => {
    mockUseCloudAccounts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Cloud list failed'),
    });
    mockUseCodexAccounts.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Codex list failed'),
    });

    renderDashboard();

    expect(await screen.findAllByText('An unexpected error occurred.')).toHaveLength(2);
    expect(screen.queryByText('No active Antigravity account selected.')).toBeNull();
    expect(screen.queryByText('No active Codex account selected.')).toBeNull();
  });

  it('prefers the live Codex runtime identity over a stale stored active flag', async () => {
    mockUseCodexAccounts.mockReturnValue({
      data: [
        {
          id: 'codex-stale',
          email: 'stale@example.com',
          label: 'Stale Active',
          accountId: 'acc-stale',
          authMode: 'chatgpt',
          isActive: true,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 2,
          lastRefreshedAt: 3,
          snapshot: {
            session: {
              state: 'ready',
              planType: 'plus',
            },
            quota: null,
          },
        },
        {
          id: 'codex-live',
          email: 'live@example.com',
          label: 'Live Active',
          accountId: 'acc-live',
          authMode: 'chatgpt',
          isActive: false,
          sortOrder: 1,
          createdAt: 4,
          updatedAt: 5,
          lastRefreshedAt: 6,
          snapshot: {
            session: {
              state: 'ready',
              planType: 'plus',
            },
            quota: null,
          },
        },
      ],
      isLoading: false,
    });
    mockUseManagedIdeStatus.mockReturnValue({
      data: {
        liveAccountIdentityKey: 'acc-live',
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderDashboard();

    expect(await screen.findByText('Live Active')).toBeTruthy();
    expect(screen.queryByText('Stale Active')).toBeNull();
  });

  it('disables the update button while a check is already in progress', async () => {
    mockUseAppUpdateStatus.mockReturnValue({
      data: {
        status: 'checking',
        currentVersion: '0.10.0',
        latestVersion: null,
        lastCheckedAt: Date.now(),
        message: null,
      },
      isError: false,
      error: null,
    });

    renderDashboard();

    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Check for updates' });
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('falls back to an error status when the consumer cache contains an error', async () => {
    mockUseAppUpdateStatus.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error('Update lookup failed'),
    });

    renderDashboard();

    expect(await screen.findByText('An unexpected error occurred.')).toBeTruthy();
  });

  it('surfaces an offline operational alert and disables manual update checks', async () => {
    mockUseConnectivityStatus.mockReturnValue('offline');

    renderDashboard();

    expect(await screen.findByText('The app is offline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The app is offline',
        description:
          'Remote operations like update checks and cloud refresh are paused until connectivity returns.',
        variant: 'destructive',
      }),
    );
  });

  it('advances the announcement ticker counter when multiple announcements exist', async () => {
    let intervalCallback: (() => void) | null = null;
    const setIntervalMock = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((handler: TimerHandler) => {
        if (typeof handler === 'function') {
          intervalCallback = () => {
            handler();
          };
        }

        return 1 as unknown as ReturnType<typeof window.setInterval>;
      });
    const clearIntervalMock = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});

    mockGetDashboardAnnouncements.mockResolvedValue([
      {
        id: 'ann-1',
        publishedAt: '2026-03-24T09:00:00Z',
        level: 'info',
        url: 'https://applyron.com/releases/ann-1',
        title: {
          tr: 'Duyuru 1',
          en: 'Announcement 1',
        },
        body: {
          tr: 'Icerik 1',
          en: 'Body 1',
        },
      },
      {
        id: 'ann-2',
        publishedAt: '2026-03-24T10:00:00Z',
        level: 'warning',
        url: 'https://applyron.com/releases/ann-2',
        title: {
          tr: 'Duyuru 2',
          en: 'Announcement 2',
        },
        body: {
          tr: 'Icerik 2',
          en: 'Body 2',
        },
      },
    ]);

    renderDashboard();

    expect((await screen.findAllByText('Announcement 1')).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Announcements' }).getAttribute('aria-live')).toBe(
      'polite',
    );
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByLabelText('Announcements 1 / 2')).toBeTruthy();
    expect(intervalCallback).toBeTruthy();

    act(() => {
      intervalCallback?.();
    });

    expect(screen.getByText('2 / 2')).toBeTruthy();

    setIntervalMock.mockRestore();
    clearIntervalMock.mockRestore();
  });
});
