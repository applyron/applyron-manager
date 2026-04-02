import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetInstallationStatus,
  mockGetCurrentStatus,
  mockListAccounts,
  mockAddAccount,
  mockImportCurrentSession,
  mockRefreshAccount,
  mockRefreshAllAccounts,
  mockActivateAccount,
  mockDeleteAccount,
  mockOpenIde,
  mockOpenLoginGuidance,
  mockLoadConfig,
  mockSaveConfig,
  mockIsManagedIdeProcessRunning,
  mockGetManagedIdeExecutablePath,
} = vi.hoisted(() => ({
  mockGetInstallationStatus: vi.fn(),
  mockGetCurrentStatus: vi.fn(),
  mockListAccounts: vi.fn(),
  mockAddAccount: vi.fn(),
  mockImportCurrentSession: vi.fn(),
  mockRefreshAccount: vi.fn(),
  mockRefreshAllAccounts: vi.fn(),
  mockActivateAccount: vi.fn(),
  mockDeleteAccount: vi.fn(),
  mockOpenIde: vi.fn(),
  mockOpenLoginGuidance: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockIsManagedIdeProcessRunning: vi.fn(),
  mockGetManagedIdeExecutablePath: vi.fn(),
}));

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    loadConfig: mockLoadConfig,
    saveConfig: mockSaveConfig,
  },
}));

vi.mock('../../ipc/process/handler', () => ({
  isManagedIdeProcessRunning: mockIsManagedIdeProcessRunning,
}));

vi.mock('../../utils/paths', () => ({
  getManagedIdeExecutablePath: mockGetManagedIdeExecutablePath,
}));

vi.mock('../../managedIde/vscodeCodexAdapter', () => ({
  VscodeCodexAdapter: class MockVscodeCodexAdapter {
    getInstallationStatus = mockGetInstallationStatus;
    getCurrentStatus = mockGetCurrentStatus;
    listAccounts = mockListAccounts;
    addAccount = mockAddAccount;
    importCurrentSession = mockImportCurrentSession;
    refreshAccount = mockRefreshAccount;
    refreshAllAccounts = mockRefreshAllAccounts;
    activateAccount = mockActivateAccount;
    deleteAccount = mockDeleteAccount;
    openIde = mockOpenIde;
    openLoginGuidance = mockOpenLoginGuidance;
  },
}));

import { ManagedIdeService } from '../../managedIde/service';

describe('ManagedIdeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockLoadConfig.mockReturnValue({ managed_ide_target: 'vscode-codex' });
    mockSaveConfig.mockResolvedValue(undefined);
    mockIsManagedIdeProcessRunning.mockResolvedValue(false);
    mockGetManagedIdeExecutablePath.mockImplementation((targetId: string) =>
      targetId === 'antigravity'
        ? 'C:\\Antigravity\\Antigravity.exe'
        : 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    );
    mockGetInstallationStatus.mockResolvedValue({
      targetId: 'vscode-codex',
      platformSupported: true,
      available: true,
      reason: 'ready',
      idePath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      ideVersion: '1.100.0',
      extensionPath: 'C:\\Users\\ahmet\\.vscode\\extensions\\openai.chatgpt-1.0.0',
      extensionVersion: '1.0.0',
      codexCliPath:
        'C:\\Users\\ahmet\\.vscode\\extensions\\openai.chatgpt-1.0.0\\bin\\windows-x86_64\\codex.exe',
      extensionId: 'openai.chatgpt',
    });
    mockGetCurrentStatus.mockResolvedValue({
      targetId: 'vscode-codex',
      installation: {
        targetId: 'vscode-codex',
        platformSupported: true,
        available: true,
        reason: 'ready',
        idePath: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        ideVersion: '1.100.0',
        extensionPath: 'C:\\Users\\ahmet\\.vscode\\extensions\\openai.chatgpt-1.0.0',
        extensionVersion: '1.0.0',
        codexCliPath:
          'C:\\Users\\ahmet\\.vscode\\extensions\\openai.chatgpt-1.0.0\\bin\\windows-x86_64\\codex.exe',
        extensionId: 'openai.chatgpt',
      },
      session: {
        state: 'ready',
        accountType: 'chatgpt',
        authMode: 'chatgpt',
        email: 'user@example.com',
        planType: 'team',
        requiresOpenaiAuth: true,
        serviceTier: 'team',
        agentMode: 'agent',
        lastUpdatedAt: 123,
      },
      quota: null,
      quotaByLimitId: null,
      isProcessRunning: true,
      lastUpdatedAt: 123,
      fromCache: false,
    });
    mockListAccounts.mockResolvedValue([
      {
        id: 'codex-1',
        email: 'user@example.com',
        label: null,
        accountId: 'acc-1',
        authMode: 'chatgpt',
        isActive: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 2,
        lastRefreshedAt: 123,
        snapshot: null,
      },
    ]);
    mockAddAccount.mockResolvedValue([
      {
        id: 'codex-2',
        email: 'new@example.com',
        label: null,
        accountId: 'acc-2',
        authMode: 'chatgpt',
        isActive: false,
        sortOrder: 1,
        createdAt: 3,
        updatedAt: 4,
        lastRefreshedAt: 456,
        snapshot: null,
      },
    ]);
    mockImportCurrentSession.mockResolvedValue({
      id: 'codex-3',
      email: 'current@example.com',
      label: null,
      accountId: 'acc-3',
      authMode: 'chatgpt',
      isActive: false,
      sortOrder: 2,
      createdAt: 5,
      updatedAt: 6,
      lastRefreshedAt: 789,
      snapshot: null,
    });
    mockRefreshAccount.mockResolvedValue({
      id: 'codex-1',
      email: 'user@example.com',
      label: null,
      accountId: 'acc-1',
      authMode: 'chatgpt',
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 10,
      lastRefreshedAt: 999,
      snapshot: null,
    });
    mockRefreshAllAccounts.mockResolvedValue([]);
    mockActivateAccount.mockResolvedValue({
      id: 'codex-1',
      email: 'user@example.com',
      label: null,
      accountId: 'acc-1',
      authMode: 'chatgpt',
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 11,
      lastRefreshedAt: 1000,
      snapshot: null,
    });
    mockDeleteAccount.mockResolvedValue(undefined);
  });

  it('lists Antigravity and Codex targets on Windows', async () => {
    const targets = await ManagedIdeService.listTargets();

    expect(targets.map((target) => target.id)).toEqual(['antigravity', 'vscode-codex']);
    expect(targets[0]?.displayName).toBe('Antigravity');
    expect(targets[1]?.installation.extensionId).toBe('openai.chatgpt');
  });

  it('reads current target status from the Codex adapter', async () => {
    const status = await ManagedIdeService.getCurrentStatus();

    expect(mockGetCurrentStatus).toHaveBeenCalledWith({ refresh: undefined });
    expect(status.targetId).toBe('vscode-codex');
    expect(status.session.email).toBe('user@example.com');
  });

  it('refreshes Codex status explicitly', async () => {
    await ManagedIdeService.refreshCurrentStatus('vscode-codex');

    expect(mockGetCurrentStatus).toHaveBeenCalledWith({ refresh: true });
  });

  it('returns Antigravity fallback status without touching the Codex adapter', async () => {
    const status = await ManagedIdeService.getCurrentStatus({ targetId: 'antigravity' });

    expect(status.targetId).toBe('antigravity');
    expect(status.installation.idePath).toContain('Antigravity');
    expect(mockGetCurrentStatus).not.toHaveBeenCalled();
  });

  it('opens the Codex IDE and login guidance through the adapter', async () => {
    await ManagedIdeService.openIde('vscode-codex');
    await ManagedIdeService.openLoginGuidance('vscode-codex');

    expect(mockOpenIde).toHaveBeenCalledTimes(1);
    expect(mockOpenLoginGuidance).toHaveBeenCalledTimes(1);
  });

  it('delegates Codex account CRUD operations to the adapter', async () => {
    const accounts = await ManagedIdeService.listCodexAccounts();
    const added = await ManagedIdeService.addCodexAccount();
    const imported = await ManagedIdeService.importCurrentCodexAccount();
    await ManagedIdeService.refreshCodexAccount('codex-1');
    await ManagedIdeService.refreshAllCodexAccounts();
    await ManagedIdeService.deleteCodexAccount('codex-1');

    expect(accounts).toHaveLength(1);
    expect(added[0]?.email).toBe('new@example.com');
    expect(imported.email).toBe('current@example.com');
    expect(mockRefreshAccount).toHaveBeenCalledWith('codex-1');
    expect(mockRefreshAllAccounts).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).toHaveBeenCalledWith('codex-1');
  });

  it('activates a Codex account and persists vscode-codex as the managed target', async () => {
    mockLoadConfig.mockReturnValueOnce({ managed_ide_target: 'antigravity' });
    const account = await ManagedIdeService.activateCodexAccount('codex-1');

    expect(account.id).toBe('codex-1');
    expect(mockActivateAccount).toHaveBeenCalledWith('codex-1');
    expect(mockSaveConfig).toHaveBeenCalledWith({
      managed_ide_target: 'vscode-codex',
    });
  });
});
