import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '@/routeTree.gen';

const mockUseAppConfig = vi.fn();
const mockUseAppUpdateStatus = vi.fn();
const mockUseCloudAccounts = vi.fn();
const mockUseCodexAccounts = vi.fn();
const mockUseManagedIdeTargets = vi.fn();
const mockToast = vi.fn();

const { ipcClient } = vi.hoisted(() => ({
  ipcClient: {
    config: {
      load: vi.fn(async () => ({
        proxy: {
          enabled: false,
          auto_start: false,
          api_key: 'proxy-key',
          port: 8045,
          request_timeout: 120,
          upstream_proxy: { enabled: false, url: '' },
          anthropic_mapping: {},
        },
      })),
    },
    gateway: {
      status: vi.fn(async () => ({ running: false })),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      generateKey: vi.fn(async () => ({ api_key: 'next-key' })),
    },
    system: {
      get_local_ips: vi.fn(async () => [
        { address: '127.0.0.1', name: 'localhost', isRecommended: true },
      ]),
    },
  },
}));

vi.mock('@/hooks/useAppConfig', () => ({
  useAppConfig: () => mockUseAppConfig(),
}));

vi.mock('@/hooks/useAppUpdateStatus', () => ({
  APP_UPDATE_STATUS_QUERY_KEY: ['app', 'update-status'],
  useAppUpdateStatus: (options?: { owner?: boolean }) => mockUseAppUpdateStatus(options),
}));

vi.mock('@/hooks/useCloudAccounts', () => ({
  useCloudAccounts: () => mockUseCloudAccounts(),
}));

vi.mock('@/hooks/useManagedIde', () => ({
  useCodexAccounts: () => mockUseCodexAccounts(),
  useManagedIdeTargets: () => mockUseManagedIdeTargets(),
}));

vi.mock('@/components/CloudAccountList', () => ({
  CloudAccountList: () => React.createElement('div', null, 'Cloud accounts list'),
}));

vi.mock('@/components/CodexAccountPanel', () => ({
  CodexAccountPanel: () => React.createElement('div', null, 'Codex account panel'),
}));

vi.mock('@/components/ModelVisibilitySettings', () => ({
  ModelVisibilitySettings: () => React.createElement('div', null, 'Model visibility settings'),
}));

vi.mock('@/components/StatusBar', () => ({
  StatusBar: () => React.createElement('div', { 'data-testid': 'status-bar' }, 'status-bar'),
}));

vi.mock('@/components/UpdatePopup', () => ({
  UpdatePopup: () => React.createElement('div', { 'data-testid': 'update-popup' }, 'update-popup'),
}));

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/actions/app', () => ({
  getAppVersion: vi.fn(async () => '0.10.0'),
  getPlatform: vi.fn(async () => 'win32'),
  getDashboardAnnouncements: vi.fn(async () => []),
  getServiceHealthSummary: vi.fn(async () => ({
    services: [],
    hasErrors: false,
    updatedAt: Date.now(),
  })),
  checkForUpdatesManual: vi.fn(async () => ({
    status: 'checking',
    currentVersion: '0.10.0',
    latestVersion: null,
    lastCheckedAt: Date.now(),
    message: null,
  })),
  installDownloadedUpdate: vi.fn(async () => ({
    status: 'ready_to_install',
    currentVersion: '0.10.0',
    latestVersion: '0.10.1',
    lastCheckedAt: Date.now(),
    message: null,
  })),
  getProxyDiagnostics: vi.fn(async () => ({
    status: {
      running: false,
      port: 8045,
      baseUrl: 'http://127.0.0.1:8045',
      active_accounts: 0,
    },
    serviceHealth: {
      state: 'idle',
      message: 'Idle',
    },
    metrics: {
      totalRequests: 0,
      successResponses: 0,
      errorResponses: 0,
      capacityRejects: 0,
      rateLimitEvents: 0,
      streamRequests: 0,
      avgLatencyMs: 0,
      lastRequestAt: null,
      lastError: null,
      modelRequestCounts: {},
    },
    capacity: {
      reason: null,
      retryAfterSec: null,
    },
    rateLimits: {
      cooldownCount: 0,
      upstreamLockCount: 0,
      reasonSummary: {},
      nextRetrySec: null,
    },
    parity: {
      enabled: false,
      shadowEnabled: false,
      noGoBlocked: false,
      parityRequestCount: 0,
      shadowMismatchCount: 0,
      parityErrorCount: 0,
    },
  })),
}));

vi.mock('@/actions/system', () => ({
  openExternalUrl: vi.fn(async () => undefined),
  openLogDirectory: vi.fn(async () => undefined),
}));

vi.mock('@/actions/language', () => ({
  setAppLanguage: vi.fn(),
  updateAppLanguage: vi.fn(),
}));

vi.mock('@/ipc/manager', () => ({
  ipc: {
    client: ipcClient,
  },
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
    },
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      const translations: Record<string, string> = {
        appName: 'Applyron Manager',
        'nav.dashboard': 'Dashboard',
        'nav.accounts': 'Accounts',
        'nav.proxy': 'API Proxy',
        'nav.settings': 'Settings',
        'dashboard.eyebrow': 'Mission Control',
        'dashboard.title': 'Dashboard',
        'dashboard.description': 'Dashboard description',
        'dashboard.update.kicker': 'Update Status',
        'dashboard.update.title': 'Application Updates',
        'dashboard.update.currentVersionLabel': 'Installed version',
        'dashboard.update.latestVersionLabel': 'Latest version',
        'dashboard.update.lastCheckedLabel': 'Last checked',
        'dashboard.update.checkButton': 'Check for updates',
        'dashboard.update.restartButton': 'Restart and install',
        'dashboard.update.status.idle': 'Ready to check',
        'dashboard.announcements.kicker': 'Announcements',
        'dashboard.announcements.description': 'Announcements description',
        'dashboard.announcements.loading': 'Loading announcements...',
        'dashboard.announcements.errorTitle': 'Announcements unavailable',
        'dashboard.announcements.errorDescription': 'Announcements error',
        'dashboard.announcements.emptyTitle': 'No announcements yet',
        'dashboard.announcements.emptyDescription': 'Announcements empty',
        'dashboard.activeAccounts.kicker': 'Active Accounts',
        'dashboard.activeAccounts.description': 'Active accounts description',
        'dashboard.activeAccounts.goToAccounts': 'Go to Accounts',
        'dashboard.activeAccounts.loading': 'Loading active accounts...',
        'dashboard.activeAccounts.emptyClassic': 'No active Antigravity account selected.',
        'dashboard.activeAccounts.emptyCodex': 'No active Codex account selected.',
        'dashboard.activeAccounts.slots.antigravity': 'Antigravity',
        'dashboard.activeAccounts.slots.codex': 'Codex',
        'dashboard.activeAccounts.sources.classic': 'Antigravity',
        'dashboard.activeAccounts.sources.codex': 'Codex',
        'dashboard.health.kicker': 'System Health',
        'dashboard.health.description': 'Health description',
        'dashboard.health.lastUpdated': 'Updated',
        'cloud.title': 'Accounts',
        'cloud.descriptionCombined': 'Accounts description',
        'cloud.tabs.gemini': 'Antigravity',
        'cloud.tabs.codex': 'Codex',
        'settings.title': 'Settings',
        'settings.description': 'Settings description',
        'settings.general': 'General',
        'settings.models': 'Models',
        'settings.proxy_tab': 'Proxy',
        'error.generic': 'An unexpected error occurred.',
        'action.retry': 'Retry',
      };

      if (typeof fallbackOrOptions === 'string') {
        return translations[key] ?? fallbackOrOptions;
      }

      const defaultValue =
        typeof fallbackOrOptions === 'object' && fallbackOrOptions
          ? String(fallbackOrOptions.defaultValue ?? '')
          : '';

      return translations[key] ?? (defaultValue || key);
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

function renderRoute(pathname: '/' | '/accounts' | '/proxy' | '/settings') {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [pathname],
    }),
    defaultPendingMinMs: 0,
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: createQueryClient() },
      React.createElement(RouterProvider, { router }),
    ),
  );
}

describe('route smoke coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAppConfig.mockReturnValue({
      config: {
        model_visibility: {},
        managed_ide_target: 'antigravity',
        theme: 'dark',
        language: 'en',
        auto_startup: false,
        proxy: {
          enabled: false,
          auto_start: false,
          api_key: 'proxy-key',
          port: 8045,
          request_timeout: 120,
          upstream_proxy: { enabled: false, url: '' },
          anthropic_mapping: {},
        },
      },
      isLoading: false,
      isSaving: false,
      saveConfig: vi.fn(async () => undefined),
    });

    mockUseAppUpdateStatus.mockReturnValue({
      data: {
        status: 'idle',
        currentVersion: '0.10.0',
        latestVersion: null,
        lastCheckedAt: Date.now(),
        message: null,
      },
      isError: false,
      error: null,
    });

    mockUseCloudAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseCodexAccounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    });

    mockUseManagedIdeTargets.mockReturnValue({
      data: [
        {
          id: 'antigravity',
          displayName: 'Antigravity',
          installation: { available: true, reason: 'ready' },
        },
        {
          id: 'vscode-codex',
          displayName: 'Codex',
          installation: { available: true, reason: 'ready' },
        },
      ],
      isLoading: false,
    });
  });

  it('opens the dashboard by default and navigates through the main routes', async () => {
    renderRoute('/');

    expect(await screen.findByText('Application Updates')).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: 'Accounts' }));
    expect(screen.getByText('Cloud accounts list')).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: 'API Proxy' }));
    expect(await screen.findByText('Service Status')).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByText('General')).toBeTruthy();
  });

  it.each([
    ['/', 'dashboard-route-error-state'],
    ['/accounts', 'accounts-route-error-state'],
    ['/proxy', 'proxy-route-error-state'],
    ['/settings', 'settings-route-error-state'],
  ] as const)(
    'renders the route-level boundary for %s without a duplicate toast',
    async (pathname, testId) => {
      mockUseAppConfig.mockImplementation(() => {
        throw new Error('Route exploded');
      });

      renderRoute(pathname);

      expect(await screen.findByTestId(testId)).toBeTruthy();
      expect(screen.queryByTestId('layout-error-state')).toBeNull();
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy();
      expect(mockToast).not.toHaveBeenCalled();
    },
  );
});
