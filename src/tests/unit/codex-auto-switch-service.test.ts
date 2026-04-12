import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadConfig,
  mockGetCurrentStatus,
  mockRefreshAllCodexAccounts,
  mockTryAutoSwitchCodexAccount,
  mockIsPackagedE2EEnvironment,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockGetCurrentStatus: vi.fn(),
  mockRefreshAllCodexAccounts: vi.fn(),
  mockTryAutoSwitchCodexAccount: vi.fn(),
  mockIsPackagedE2EEnvironment: vi.fn(() => false),
}));

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    getCachedConfigOrLoad: mockLoadConfig,
    loadConfig: mockLoadConfig,
  },
}));

vi.mock('../../managedIde/service', () => ({
  ManagedIdeService: {
    getCurrentStatus: mockGetCurrentStatus,
    refreshAllCodexAccounts: mockRefreshAllCodexAccounts,
    tryAutoSwitchCodexAccount: mockTryAutoSwitchCodexAccount,
  },
}));

vi.mock('../../utils/runtimeMode', () => ({
  isPackagedE2EEnvironment: mockIsPackagedE2EEnvironment,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { CodexAutoSwitchService } from '../../services/CodexAutoSwitchService';

function createAccount(
  id: string,
  overrides?: Partial<{
    isActive: boolean;
    sessionState: 'ready' | 'requires_login' | 'unavailable';
    primaryUsed: number;
    secondaryUsed: number;
    updatedAt: number;
  }>,
) {
  return {
    id,
    email: `${id}@example.com`,
    label: null,
    accountId: `${id}-account`,
    authMode: 'chatgpt',
    isActive: overrides?.isActive ?? false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: overrides?.updatedAt ?? 10,
    lastRefreshedAt: 100,
    snapshot: {
      session: {
        state: overrides?.sessionState ?? 'ready',
        accountType: 'chatgpt',
        authMode: 'chatgpt',
        email: `${id}@example.com`,
        planType: 'team',
        requiresOpenaiAuth: false,
        serviceTier: 'team',
        agentMode: null,
        lastUpdatedAt: 100,
      },
      quota: {
        limitId: null,
        limitName: null,
        planType: 'team',
        primary: {
          usedPercent: overrides?.primaryUsed ?? 25,
          resetsAt: null,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: overrides?.secondaryUsed ?? 25,
          resetsAt: null,
          windowDurationMins: 10080,
        },
        credits: null,
      },
      quotaByLimitId: null,
      lastUpdatedAt: 100,
    },
  };
}

describe('CodexAutoSwitchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CodexAutoSwitchService.resetStateForTesting();
    mockLoadConfig.mockReturnValue({ codex_auto_switch_enabled: true });
    mockGetCurrentStatus.mockResolvedValue({
      installation: {
        available: true,
      },
      pendingRuntimeApply: null,
    });
    mockRefreshAllCodexAccounts.mockResolvedValue([]);
    mockTryAutoSwitchCodexAccount.mockResolvedValue(true);
    mockIsPackagedE2EEnvironment.mockReturnValue(false);
  });

  it('switches to the healthiest ready standby account when the active account is limited', async () => {
    mockRefreshAllCodexAccounts.mockResolvedValue([
      createAccount('active', { isActive: true, primaryUsed: 95, secondaryUsed: 30 }),
      createAccount('standby-better', { secondaryUsed: 10, updatedAt: 50 }),
      createAccount('standby-worse', { secondaryUsed: 40, updatedAt: 40 }),
    ]);

    const switched = await CodexAutoSwitchService.poll();

    expect(switched).toBe(true);
    expect(mockTryAutoSwitchCodexAccount).toHaveBeenCalledWith('standby-better', 'active');
  });

  it('does not switch when no ready standby account exists', async () => {
    mockRefreshAllCodexAccounts.mockResolvedValue([
      createAccount('active', { isActive: true, primaryUsed: 95 }),
      createAccount('attention', { sessionState: 'requires_login' }),
      createAccount('limited', { primaryUsed: 91 }),
    ]);

    const switched = await CodexAutoSwitchService.poll();

    expect(switched).toBe(false);
    expect(mockTryAutoSwitchCodexAccount).not.toHaveBeenCalled();
  });

  it('does not switch while a deferred runtime apply is pending', async () => {
    mockGetCurrentStatus.mockResolvedValue({
      installation: {
        available: true,
      },
      pendingRuntimeApply: {
        runtimeId: 'wsl-remote',
        recordId: 'standby-better',
      },
    });

    const switched = await CodexAutoSwitchService.poll();

    expect(switched).toBe(false);
    expect(mockRefreshAllCodexAccounts).not.toHaveBeenCalled();
    expect(mockTryAutoSwitchCodexAccount).not.toHaveBeenCalled();
  });

  it('starts and stops from config sync while preserving the packaged E2E exception', async () => {
    const startSpy = vi.spyOn(CodexAutoSwitchService, 'start').mockImplementation(() => undefined);
    const stopSpy = vi.spyOn(CodexAutoSwitchService, 'stop').mockImplementation(() => undefined);

    await CodexAutoSwitchService.syncWithConfig({ codex_auto_switch_enabled: true } as never);
    expect(startSpy).toHaveBeenCalledTimes(1);

    startSpy.mockClear();
    mockIsPackagedE2EEnvironment.mockReturnValue(true);

    await CodexAutoSwitchService.syncWithConfig({ codex_auto_switch_enabled: true } as never);
    expect(startSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});
