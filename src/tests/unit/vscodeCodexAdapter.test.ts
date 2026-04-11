import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockReaddirSync,
  mockReadFileSync,
  mockStatSync,
  mockDatabaseGet,
  mockDatabaseRun,
  mockCollectSnapshot,
  mockStartChatGptLogin,
  mockWaitForChatGptLoginCompletion,
  mockDispose,
  mockIsManagedIdeProcessRunning,
  mockCloseManagedIde,
  mockStartManagedIde,
  mockGetManagedIdeDbPaths,
  mockGetManagedIdeStoragePaths,
  mockGetManagedIdeExecutablePath,
  mockIsWsl,
  mockLoadConfig,
  mockGetSetting,
  mockSetSetting,
  mockIsCloudStorageUnavailableError,
  mockLoggerWarn,
  mockLoggerError,
  mockLoggerDebug,
  mockListAccounts,
  mockGetAccount,
  mockGetByAccountId,
  mockGetByIdentityKey,
  mockGetActiveAccount,
  mockReadStoredAuthFile,
  mockUpsertAccount,
  mockUpdateSnapshot,
  mockUpdateMetadata,
  mockGetHydrationState,
  mockSetHydrationState,
  mockSetActiveAccount,
  mockRemoveAccount,
  mockReadCodexAuthFile,
  mockWriteCodexAuthFile,
  mockGetCodexEmailHint,
  mockGetCodexWorkspaceFromAuthFile,
  mockGetCodexAuthFilePath,
  mockGetCodexChromeWorkspaceLabel,
  mockOpenExternal,
  mockSpawn,
  mockSpawnUnref,
  mockMkdtemp,
  mockRm,
  mockGetActiveVsCodeWindowRuntimeId,
  mockGetActiveVsCodeWslAuthority,
  mockGetKnownWslAuthorities,
  mockResolveWslRuntimeHome,
  mockToAccessibleWslPath,
  mockGetWindowsUser,
  mockExecSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockDatabaseGet: vi.fn(),
  mockDatabaseRun: vi.fn(),
  mockCollectSnapshot: vi.fn(),
  mockStartChatGptLogin: vi.fn(),
  mockWaitForChatGptLoginCompletion: vi.fn(),
  mockDispose: vi.fn(),
  mockIsManagedIdeProcessRunning: vi.fn(),
  mockCloseManagedIde: vi.fn(),
  mockStartManagedIde: vi.fn(),
  mockGetManagedIdeDbPaths: vi.fn(),
  mockGetManagedIdeStoragePaths: vi.fn(),
  mockGetManagedIdeExecutablePath: vi.fn(),
  mockIsWsl: vi.fn(),
  mockLoadConfig: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockIsCloudStorageUnavailableError: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerDebug: vi.fn(),
  mockListAccounts: vi.fn(),
  mockGetAccount: vi.fn(),
  mockGetByAccountId: vi.fn(),
  mockGetByIdentityKey: vi.fn(),
  mockGetActiveAccount: vi.fn(),
  mockReadStoredAuthFile: vi.fn(),
  mockUpsertAccount: vi.fn(),
  mockUpdateSnapshot: vi.fn(),
  mockUpdateMetadata: vi.fn(),
  mockGetHydrationState: vi.fn(),
  mockSetHydrationState: vi.fn(),
  mockSetActiveAccount: vi.fn(),
  mockRemoveAccount: vi.fn(),
  mockReadCodexAuthFile: vi.fn(),
  mockWriteCodexAuthFile: vi.fn(),
  mockGetCodexEmailHint: vi.fn(),
  mockGetCodexWorkspaceFromAuthFile: vi.fn(),
  mockGetCodexAuthFilePath: vi.fn(),
  mockGetCodexChromeWorkspaceLabel: vi.fn(),
  mockOpenExternal: vi.fn(),
  mockSpawn: vi.fn(),
  mockSpawnUnref: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockRm: vi.fn(),
  mockGetActiveVsCodeWindowRuntimeId: vi.fn(),
  mockGetActiveVsCodeWslAuthority: vi.fn(),
  mockGetKnownWslAuthorities: vi.fn(),
  mockResolveWslRuntimeHome: vi.fn(),
  mockToAccessibleWslPath: vi.fn(),
  mockGetWindowsUser: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    statSync: mockStatSync,
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdtemp: mockMkdtemp,
    rm: mockRm,
  },
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    prepare() {
      return {
        get: mockDatabaseGet,
        run: mockDatabaseRun,
      };
    }

    close() {
      // no-op
    }
  },
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: mockOpenExternal,
  },
}));

vi.mock('../../managedIde/codexAppServerClient', () => ({
  CodexAppServerClient: class MockCodexAppServerClient {
    collectSnapshot = mockCollectSnapshot;
    startChatGptLogin = mockStartChatGptLogin;
    waitForChatGptLoginCompletion = mockWaitForChatGptLoginCompletion;
    loginWithChatGpt = vi.fn(
      async (options: { openUrl: (url: string) => Promise<void> | void; timeoutMs?: number }) => {
        const result = await mockStartChatGptLogin();
        await options.openUrl(result.authUrl);
        return mockWaitForChatGptLoginCompletion(result.loginId, options.timeoutMs);
      },
    );
    dispose = mockDispose;
  },
}));

vi.mock('../../ipc/process/handler', () => ({
  isManagedIdeProcessRunning: mockIsManagedIdeProcessRunning,
  closeManagedIde: mockCloseManagedIde,
  startManagedIde: mockStartManagedIde,
}));

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    loadConfig: mockLoadConfig,
  },
}));

vi.mock('../../utils/paths', () => ({
  getManagedIdeDbPaths: mockGetManagedIdeDbPaths,
  getManagedIdeStoragePaths: mockGetManagedIdeStoragePaths,
  getManagedIdeExecutablePath: mockGetManagedIdeExecutablePath,
  isWsl: mockIsWsl,
}));

vi.mock('../../ipc/database/cloudHandler', () => ({
  CloudAccountRepo: {
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
  },
  isCloudStorageUnavailableError: mockIsCloudStorageUnavailableError,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  },
}));

vi.mock('../../managedIde/codexAccountStore', () => ({
  CodexAccountStore: {
    listAccounts: mockListAccounts,
    getAccount: mockGetAccount,
    getByAccountId: mockGetByAccountId,
    getByIdentityKey: mockGetByIdentityKey,
    getActiveAccount: mockGetActiveAccount,
    readAuthFile: mockReadStoredAuthFile,
    upsertAccount: mockUpsertAccount,
    updateSnapshot: mockUpdateSnapshot,
    updateMetadata: mockUpdateMetadata,
    getHydrationState: mockGetHydrationState,
    setHydrationState: mockSetHydrationState,
    setActive: mockSetActiveAccount,
    removeAccount: mockRemoveAccount,
  },
}));

vi.mock('../../managedIde/codexAuth', () => ({
  getCodexAuthFilePath: mockGetCodexAuthFilePath,
  getCodexEmailHint: mockGetCodexEmailHint,
  getCodexWorkspaceFromAuthFile: mockGetCodexWorkspaceFromAuthFile,
  readCodexAuthFile: mockReadCodexAuthFile,
  writeCodexAuthFile: mockWriteCodexAuthFile,
}));

vi.mock('../../managedIde/codexChromeWorkspaceHints', () => ({
  getCodexChromeWorkspaceLabel: mockGetCodexChromeWorkspaceLabel,
}));

vi.mock('../../utils/wslRuntime', () => ({
  getActiveVsCodeWindowRuntimeId: mockGetActiveVsCodeWindowRuntimeId,
  getActiveVsCodeWslAuthority: mockGetActiveVsCodeWslAuthority,
  getKnownWslAuthorities: mockGetKnownWslAuthorities,
  resolveWslRuntimeHome: mockResolveWslRuntimeHome,
  toAccessibleWslPath: mockToAccessibleWslPath,
}));

vi.mock('../../utils/platformPaths', () => ({
  getWindowsUser: mockGetWindowsUser,
}));

vi.mock('child_process', () => {
  const childProcessModule = {
    execSync: mockExecSync,
    spawn: mockSpawn.mockImplementation(() => ({
      unref: mockSpawnUnref,
    })),
  };
  return {
    ...childProcessModule,
    default: childProcessModule,
  };
});

import { VscodeCodexAdapter } from '../../managedIde/vscodeCodexAdapter';

const extensionDirectoryName = 'openai.chatgpt-26.318.11754-win32-x64';
const extensionPath = path.join(os.homedir(), '.vscode', 'extensions', extensionDirectoryName);
const codePath = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
const codexCliPath = path.join(extensionPath, 'bin', 'windows-x86_64', 'codex.exe');
const defaultAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
const wslAccessibleHome = '\\\\wsl$\\Ubuntu\\home\\ahmet';
const wslLinuxHome = '/home/ahmet';
const wslAuthPath = path.join(wslAccessibleHome, '.codex', 'auth.json');
const _wslStateDbPath = path.join(
  wslAccessibleHome,
  '.vscode-server',
  'data',
  'User',
  'globalStorage',
  'state.vscdb',
);
const temporaryCodexHome = 'C:\\Temp\\applyron-codex-login-123';
const temporaryCodexAuthPath = `${temporaryCodexHome}\\auth.json`;

function createLiveSnapshot(
  overrides?: Partial<{
    email: string;
    planType: string;
    serviceTier: string | null;
    authMode: string;
  }>,
) {
  return {
    account: {
      account: {
        type: 'chatgpt' as const,
        email: overrides?.email ?? 'admin@applyron.com',
        planType: overrides?.planType ?? 'team',
      },
      requiresOpenaiAuth: true,
    },
    rateLimits: {
      rateLimits: {
        limitId: 'codex',
        limitName: null,
        planType: 'team',
        primary: {
          usedPercent: 75,
          resetsAt: 1774053821,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 25,
          resetsAt: 1774560329,
          windowDurationMins: 10080,
        },
        credits: {
          hasCredits: false,
          unlimited: false,
          balance: null,
        },
      },
      rateLimitsByLimitId: null,
    },
    authStatus: {
      authMethod: 'chatgpt' as const,
      authToken: null,
      requiresOpenaiAuth: true,
    },
    config: {
      config: {
        service_tier: overrides?.serviceTier ?? 'flex',
      },
    },
    authMode: (overrides?.authMode ?? 'chatgpt') as 'chatgpt',
    planTypeHint: overrides?.planType ?? 'team',
    latestRateLimitsNotification: null,
  };
}

function createAuthFile(accountId = 'acc-1') {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: 'id-token',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      account_id: accountId,
    },
    last_refresh: '2026-03-21T12:00:00.000Z',
  };
}

function createAccountRecord(
  overrides?: Partial<{
    id: string;
    email: string | null;
    accountId: string;
    authMode: string | null;
    workspace: {
      id: string;
      title: string | null;
      role: string | null;
      isDefault: boolean;
    } | null;
    isActive: boolean;
    updatedAt: number;
    lastRefreshedAt: number | null;
    snapshot: Record<string, unknown> | null;
  }>,
) {
  return {
    id: overrides?.id ?? 'codex-1',
    email: overrides?.email ?? 'admin@applyron.com',
    label: null,
    accountId: overrides?.accountId ?? 'acc-1',
    authMode: overrides?.authMode ?? 'chatgpt',
    workspace: overrides?.workspace ?? null,
    isActive: overrides?.isActive ?? false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: overrides?.updatedAt ?? 2,
    lastRefreshedAt: overrides?.lastRefreshedAt ?? 123,
    snapshot: overrides?.snapshot ?? null,
  };
}

function createRuntimeStatus(
  overrides?: Partial<{
    id: 'windows-local' | 'wsl-remote';
    displayName: string;
    installation: Record<string, unknown>;
    session: Record<string, unknown>;
  }>,
) {
  return {
    id: overrides?.id ?? 'windows-local',
    displayName: overrides?.displayName ?? 'Windows Local',
    installation: overrides?.installation ?? {
      targetId: 'vscode-codex',
      platformSupported: true,
      available: true,
      reason: 'ready',
      idePath: codePath,
      ideVersion: '1.99.0',
      extensionPath,
      extensionVersion: '26.300.0',
      codexCliPath,
      extensionId: 'openai.chatgpt',
    },
    session: overrides?.session ?? {
      state: 'ready',
      accountType: 'chatgpt',
      authMode: 'chatgpt',
      email: 'admin@applyron.com',
      planType: 'team',
      requiresOpenaiAuth: true,
      serviceTier: 'flex',
      agentMode: 'full-access',
      lastUpdatedAt: 123,
    },
    quota: null,
    quotaByLimitId: null,
    authFilePath: defaultAuthPath,
    stateDbPath: 'C:\\Users\\ahmet\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb',
    storagePath: 'C:\\Users\\ahmet\\AppData\\Roaming\\Code\\User\\globalStorage\\storage.json',
    authLastUpdatedAt: 123,
    extensionStateUpdatedAt: 123,
    lastUpdatedAt: 123,
  };
}

describe('VscodeCodexAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    mockExistsSync.mockImplementation(
      (filePath: string) => !filePath.includes('Google\\Chrome\\Application\\chrome.exe'),
    );
    mockStatSync.mockReturnValue({ mtimeMs: 1_700_000_000_000 });
    mockReaddirSync.mockReturnValue([
      {
        isDirectory: () => true,
        name: extensionDirectoryName,
      },
    ]);
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('openai.chatgpt-') && filePath.endsWith(path.join('package.json'))) {
        return JSON.stringify({ version: '26.318.11754' });
      }

      if (filePath.endsWith(path.join('resources', 'app', 'package.json'))) {
        return JSON.stringify({ version: '1.100.0' });
      }

      return '';
    });
    mockDatabaseGet.mockReturnValue({
      value: JSON.stringify({
        'persisted-atom-state': {
          codexCloudAccess: 'enabled',
          'default-service-tier': 'fast',
          'agent-mode': 'full-access',
        },
      }),
    });
    mockCollectSnapshot.mockResolvedValue(createLiveSnapshot());
    mockStartChatGptLogin.mockResolvedValue({
      authUrl: 'https://chatgpt.com/auth/login?flow=1',
      loginId: 'login-1',
    });
    mockWaitForChatGptLoginCompletion.mockResolvedValue(undefined);
    mockDispose.mockResolvedValue(undefined);
    mockIsManagedIdeProcessRunning.mockResolvedValue(true);
    mockCloseManagedIde.mockResolvedValue(undefined);
    mockStartManagedIde.mockResolvedValue(undefined);
    mockGetManagedIdeDbPaths.mockReturnValue([
      'C:\\Users\\ahmet\\AppData\\Roaming\\Code\\User\\globalStorage\\state.vscdb',
    ]);
    mockGetManagedIdeStoragePaths.mockReturnValue([
      'C:\\Users\\ahmet\\AppData\\Roaming\\Code\\User\\globalStorage\\storage.json',
    ]);
    mockGetManagedIdeExecutablePath.mockReturnValue(codePath);
    mockIsWsl.mockReturnValue(false);
    mockLoadConfig.mockReturnValue({
      managed_ide_target: 'vscode-codex',
      codex_runtime_override: null,
    });
    mockGetSetting.mockReturnValue(null);
    mockSetSetting.mockImplementation(() => undefined);
    mockIsCloudStorageUnavailableError.mockReturnValue(false);
    mockListAccounts.mockResolvedValue([]);
    mockGetAccount.mockResolvedValue(null);
    mockGetByAccountId.mockResolvedValue(null);
    mockGetByIdentityKey.mockResolvedValue(null);
    mockGetActiveAccount.mockResolvedValue(null);
    mockReadStoredAuthFile.mockResolvedValue(null);
    mockUpsertAccount.mockImplementation(async (input) =>
      createAccountRecord({
        accountId: input.accountId,
        email: input.email,
        authMode: input.authMode,
        workspace: input.workspace ?? null,
        isActive: Boolean(input.makeActive),
      }),
    );
    mockUpdateSnapshot.mockResolvedValue(undefined);
    mockUpdateMetadata.mockResolvedValue(undefined);
    mockGetHydrationState.mockResolvedValue('live');
    mockSetHydrationState.mockResolvedValue(undefined);
    mockSetActiveAccount.mockResolvedValue(undefined);
    mockRemoveAccount.mockResolvedValue(undefined);
    mockReadCodexAuthFile.mockImplementation((filePath?: string) => {
      if (!filePath || filePath === defaultAuthPath) {
        return createAuthFile();
      }
      if (filePath === temporaryCodexAuthPath) {
        return createAuthFile('acc-2');
      }
      return null;
    });
    mockWriteCodexAuthFile.mockImplementation(() => undefined);
    mockGetCodexEmailHint.mockImplementation((authFile) => {
      if (authFile?.tokens?.account_id === 'acc-2') {
        return 'ahmet@applyron.com';
      }
      return 'admin@applyron.com';
    });
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue(null);
    mockGetCodexChromeWorkspaceLabel.mockReturnValue(null);
    mockGetCodexAuthFilePath.mockImplementation((codexHome?: string) =>
      codexHome ? `${codexHome}\\auth.json` : defaultAuthPath,
    );
    mockOpenExternal.mockResolvedValue(undefined);
    mockMkdtemp.mockResolvedValue(temporaryCodexHome);
    mockRm.mockResolvedValue(undefined);
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue('windows-local');
    mockGetActiveVsCodeWslAuthority.mockReturnValue(null);
    mockGetKnownWslAuthorities.mockReturnValue([]);
    mockResolveWslRuntimeHome.mockReturnValue(null);
    mockToAccessibleWslPath.mockImplementation(
      (_distro: string, runtimePath: string) => runtimePath,
    );
    mockGetWindowsUser.mockReturnValue('ahmet');
    mockExecSync.mockImplementation(() => Buffer.from('/tmp/applyron-codex-probe-123'));
  });

  it('returns live Codex status even when cache persistence fails', async () => {
    mockSetSetting.mockImplementation(() => {
      throw new Error('native settings unavailable');
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus({ refresh: true });

    expect(status.installation.available).toBe(true);
    expect(status.installation.extensionPath).toBe(extensionPath);
    expect(status.installation.codexCliPath).toBe(codexCliPath);
    expect(status.session.state).toBe('ready');
    expect(status.session.email).toBe('admin@applyron.com');
    expect(status.session.serviceTier).toBe('flex');
    expect(status.session.agentMode).toBe('full-access');
    expect(status.quota?.primary?.resetsAt).toBe(1774053821000);
    expect(status.quota?.secondary?.resetsAt).toBe(1774560329000);
    expect(status.fromCache).toBe(false);
    expect(mockCollectSnapshot).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to cache VS Code Codex status snapshot',
      expect.any(Error),
    );
  });

  it('does not keep serving an unavailable cached snapshot when live Codex data is ready', async () => {
    mockGetSetting.mockReturnValue({
      targetId: 'vscode-codex',
      installation: {
        targetId: 'vscode-codex',
        platformSupported: true,
        available: true,
        reason: 'ready',
        idePath: codePath,
        ideVersion: '1.99.0',
        extensionPath,
        extensionVersion: '26.300.0',
        codexCliPath,
        extensionId: 'openai.chatgpt',
      },
      session: {
        state: 'unavailable',
        accountType: null,
        authMode: null,
        email: null,
        planType: null,
        requiresOpenaiAuth: true,
        serviceTier: null,
        agentMode: null,
        lastUpdatedAt: 123,
      },
      quota: null,
      quotaByLimitId: null,
      isProcessRunning: false,
      lastUpdatedAt: 123,
      fromCache: false,
      activeRuntimeId: 'windows-local',
      requiresRuntimeSelection: false,
      hasRuntimeMismatch: false,
      runtimes: [
        createRuntimeStatus({
          session: {
            state: 'unavailable',
            accountType: null,
            authMode: null,
            email: null,
            planType: null,
            requiresOpenaiAuth: true,
            serviceTier: null,
            agentMode: null,
            lastUpdatedAt: 123,
          },
        }),
      ],
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus();

    expect(mockCollectSnapshot).toHaveBeenCalledTimes(1);
    expect(status.session.state).toBe('ready');
    expect(status.session.email).toBe('admin@applyron.com');
    expect(status.fromCache).toBe(false);
  });

  it('serves a ready cached Codex status without re-scanning processes when refresh is not requested', async () => {
    mockGetSetting.mockReturnValue({
      targetId: 'vscode-codex',
      installation: {
        targetId: 'vscode-codex',
        platformSupported: true,
        available: true,
        reason: 'ready',
        idePath: codePath,
        ideVersion: '1.99.0',
        extensionPath,
        extensionVersion: '26.300.0',
        codexCliPath,
        extensionId: 'openai.chatgpt',
      },
      session: {
        state: 'ready',
        accountType: 'chatgpt',
        authMode: 'chatgpt',
        email: 'admin@applyron.com',
        planType: 'team',
        requiresOpenaiAuth: true,
        serviceTier: 'flex',
        agentMode: 'full-access',
        lastUpdatedAt: 123,
      },
      quota: null,
      quotaByLimitId: null,
      isProcessRunning: true,
      lastUpdatedAt: 123,
      fromCache: false,
      activeRuntimeId: 'windows-local',
      requiresRuntimeSelection: false,
      hasRuntimeMismatch: false,
      runtimes: [createRuntimeStatus()],
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus();

    expect(mockCollectSnapshot).not.toHaveBeenCalled();
    expect(mockIsManagedIdeProcessRunning).not.toHaveBeenCalled();
    expect(status.fromCache).toBe(true);
    expect(status.isProcessRunning).toBe(true);
  });

  it('prefers the WSL remote runtime when the active VS Code window is remote', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue('wsl-remote');
    mockResolveWslRuntimeHome.mockReturnValue({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: wslLinuxHome,
      accessibleHomePath: wslAccessibleHome,
    });
    mockReadCodexAuthFile.mockImplementation((filePath?: string) => {
      if (filePath === wslAuthPath) {
        return createAuthFile('acc-wsl');
      }
      if (!filePath || filePath === defaultAuthPath) {
        return createAuthFile('acc-win');
      }
      if (filePath === temporaryCodexAuthPath) {
        return createAuthFile('acc-2');
      }
      return null;
    });
    mockGetCodexEmailHint.mockImplementation((authFile) => {
      if (authFile?.tokens?.account_id === 'acc-wsl') {
        return 'wsl@applyron.com';
      }
      if (authFile?.tokens?.account_id === 'acc-2') {
        return 'ahmet@applyron.com';
      }
      return 'admin@applyron.com';
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus({ refresh: true });
    expect(status.activeRuntimeId).toBe('wsl-remote');
    expect(status.requiresRuntimeSelection).toBe(false);
    expect(status.session.email).toBe('wsl@applyron.com');
    expect(status.runtimes).toHaveLength(2);
  });

  it('requires manual runtime selection when both runtimes are available and no active side is detected', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue(null);
    mockResolveWslRuntimeHome.mockReturnValue({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: wslLinuxHome,
      accessibleHomePath: wslAccessibleHome,
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus({ refresh: true });

    expect(status.activeRuntimeId).toBeNull();
    expect(status.requiresRuntimeSelection).toBe(true);
    expect(status.runtimes).toHaveLength(2);
  });

  it('reconciles stored team workspaces from auth payloads while listing accounts', async () => {
    const personalWorkspace = {
      id: 'org-personal',
      title: 'Personal',
      role: 'owner',
      isDefault: true,
    };
    const teamWorkspace = {
      id: 'org-vszone',
      title: 'VSZONE',
      role: 'member',
      isDefault: false,
    };
    mockListAccounts.mockResolvedValue([
      createAccountRecord({
        id: 'codex-team',
        accountId: 'acc-team',
        workspace: personalWorkspace,
        snapshot: {
          session: {
            state: 'ready',
            accountType: 'chatgpt',
            authMode: 'chatgpt',
            email: 'admin@applyron.com',
            planType: 'team',
            requiresOpenaiAuth: true,
            serviceTier: 'flex',
            agentMode: 'full-access',
            lastUpdatedAt: 123,
          },
          quota: null,
          quotaByLimitId: null,
          lastUpdatedAt: 123,
        },
      }),
    ]);
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-team'));
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue(teamWorkspace);

    const adapter = new VscodeCodexAdapter();
    const accounts = await adapter.listAccounts();

    expect(mockReadStoredAuthFile).toHaveBeenCalledWith('codex-team', {
      suppressExpectedSecurityLogs: true,
    });
    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: 'codex-team',
        accountId: 'acc-team',
        workspace: teamWorkspace,
      }),
    );
    expect(accounts[0]?.workspace).toEqual(teamWorkspace);
  });

  it('overrides personal team workspace labels with Chrome workspace hints while listing accounts', async () => {
    const personalWorkspace = {
      id: 'org-personal',
      title: 'Personal',
      role: 'owner',
      isDefault: true,
    };
    mockListAccounts.mockResolvedValue([
      createAccountRecord({
        id: 'codex-team-hinted',
        email: 'ahmetfarukturkogluyedek@gmail.com',
        accountId: 'acc-team-hinted',
        workspace: personalWorkspace,
        snapshot: {
          session: {
            state: 'ready',
            accountType: 'chatgpt',
            authMode: 'chatgpt',
            email: 'ahmetfarukturkogluyedek@gmail.com',
            planType: 'team',
            requiresOpenaiAuth: true,
            serviceTier: 'flex',
            agentMode: 'full-access',
            lastUpdatedAt: 123,
          },
          quota: null,
          quotaByLimitId: null,
          lastUpdatedAt: 123,
        },
      }),
    ]);
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-team-hinted'));
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue(personalWorkspace);
    mockGetCodexChromeWorkspaceLabel.mockReturnValue('VSZONE');
    mockGetCodexEmailHint.mockImplementation((authFile) => {
      if (authFile?.tokens?.account_id === 'acc-team-hinted') {
        return 'ahmetfarukturkogluyedek@gmail.com';
      }
      if (authFile?.tokens?.account_id === 'acc-2') {
        return 'ahmet@applyron.com';
      }
      return 'admin@applyron.com';
    });

    const adapter = new VscodeCodexAdapter();
    const accounts = await adapter.listAccounts();

    expect(mockGetCodexChromeWorkspaceLabel).toHaveBeenCalledWith(
      'acc-team-hinted',
      'ahmetfarukturkogluyedek@gmail.com',
    );
    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: 'codex-team-hinted',
        accountId: 'acc-team-hinted',
        workspace: {
          id: 'org-personal',
          title: 'VSZONE',
          role: 'owner',
          isDefault: true,
        },
      }),
    );
    expect(accounts[0]?.workspace?.title).toBe('VSZONE');
  });

  it('syncs the live default Codex session into the Applyron pool as the active account', async () => {
    const adapter = new VscodeCodexAdapter();
    await adapter.getCurrentStatus({ refresh: true });

    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        email: 'admin@applyron.com',
        makeActive: true,
      }),
    );
  });

  it('reads service tier and agent mode from stringified persisted atom state when app-server config is empty', async () => {
    mockDatabaseGet.mockReturnValue({
      value: JSON.stringify({
        'persisted-atom-state': JSON.stringify({
          'default-service-tier': 'fast',
          'agent-mode': 'full_access',
        }),
      }),
    });
    mockCollectSnapshot.mockResolvedValue({
      ...createLiveSnapshot(),
      config: {
        config: {
          service_tier: null,
        },
      },
    });

    const adapter = new VscodeCodexAdapter();
    const status = await adapter.getCurrentStatus({ refresh: true });

    expect(status.session.serviceTier).toBe('fast');
    expect(status.session.agentMode).toBe('full-access');
  });

  it('imports the current default Codex session into the Applyron pool', async () => {
    const adapter = new VscodeCodexAdapter();
    const account = await adapter.importCurrentSession();

    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        email: 'admin@applyron.com',
        authMode: 'chatgpt',
        makeActive: true,
      }),
    );
    expect(account.accountId).toBe('acc-1');
    expect(account.isActive).toBe(true);
  });

  it('keeps importCurrentSession activation behavior even when another Codex account is already active', async () => {
    mockGetActiveAccount.mockResolvedValue(
      createAccountRecord({ id: 'codex-existing', accountId: 'acc-existing', isActive: true }),
    );

    const adapter = new VscodeCodexAdapter();
    await adapter.importCurrentSession();

    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        makeActive: true,
      }),
    );
  });

  it('returns a localized storage error code when the Codex pool cannot be prepared', async () => {
    mockUpsertAccount.mockRejectedValue(new Error('no such table: codex_accounts'));

    const adapter = new VscodeCodexAdapter();

    await expect(adapter.importCurrentSession()).rejects.toThrow('CODEX_ACCOUNT_STORE_UNAVAILABLE');
  });

  it('adds a new Codex account through an isolated login flow', async () => {
    mockCollectSnapshot
      .mockResolvedValueOnce(createLiveSnapshot())
      .mockResolvedValueOnce(createLiveSnapshot({ email: 'ahmet@applyron.com' }));
    mockStartChatGptLogin.mockResolvedValueOnce({
      authUrl: 'https://chatgpt.com/auth/login?flow=1',
      loginId: 'login-1',
    });
    mockUpsertAccount.mockImplementation(async (input) =>
      createAccountRecord({
        id: input.accountId === 'acc-1' ? 'codex-1' : 'codex-2',
        accountId: input.accountId,
        email: input.email,
        authMode: input.authMode,
        workspace: input.workspace ?? null,
        isActive: Boolean(input.makeActive),
      }),
    );
    mockWaitForChatGptLoginCompletion.mockImplementation(async (loginId: string) => {
      expect(loginId).toBe('login-1');
    });
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue({
      id: 'workspace-vszone',
      title: 'VSZONE',
      role: null,
      isDefault: false,
    });

    const adapter = new VscodeCodexAdapter();
    const accounts = await adapter.addAccount();

    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/chatgpt\.com\/auth\/login\?flow=1&applyron_login_nonce=\d+$/,
      ),
    );
    expect(mockUpsertAccount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: 'acc-1',
        email: 'admin@applyron.com',
        makeActive: true,
      }),
    );
    expect(mockUpsertAccount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountId: 'acc-2',
        email: 'ahmet@applyron.com',
        workspace: {
          id: 'workspace-vszone',
          title: 'VSZONE',
          role: null,
          isDefault: false,
        },
        makeActive: false,
      }),
    );
    expect(mockRm).toHaveBeenCalledWith(temporaryCodexHome, {
      recursive: true,
      force: true,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.accountId).toBe('acc-2');
    expect(accounts[0]?.workspace?.title).toBe('VSZONE');
  });

  it('rejects duplicate Codex account additions instead of reporting a false new account', async () => {
    mockCollectSnapshot
      .mockResolvedValueOnce(createLiveSnapshot())
      .mockResolvedValueOnce(createLiveSnapshot({ email: 'ahmet@applyron.com' }));
    mockStartChatGptLogin.mockResolvedValueOnce({
      authUrl: 'https://chatgpt.com/auth/login?flow=1',
      loginId: 'login-1',
    });
    mockWaitForChatGptLoginCompletion.mockResolvedValue(undefined);
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue({
      id: 'workspace-vszone',
      title: 'VSZONE',
      role: null,
      isDefault: false,
    });
    mockGetByIdentityKey.mockResolvedValue(
      createAccountRecord({ id: 'codex-existing', accountId: 'acc-2', isActive: false }),
    );

    const adapter = new VscodeCodexAdapter();

    await expect(adapter.addAccount()).rejects.toThrow('CODEX_ACCOUNT_ALREADY_EXISTS');
  });

  it('keeps the default Codex session active in the pool when live probing falls back to a cached ready snapshot', async () => {
    mockCollectSnapshot.mockRejectedValue(new Error('app-server unavailable'));
    mockGetSetting.mockReturnValue({
      targetId: 'vscode-codex',
      installation: {
        targetId: 'vscode-codex',
        platformSupported: true,
        available: true,
        reason: 'ready',
        idePath: codePath,
        ideVersion: '1.99.0',
        extensionPath,
        extensionVersion: '26.300.0',
        codexCliPath,
        extensionId: 'openai.chatgpt',
      },
      session: {
        state: 'ready',
        accountType: 'chatgpt',
        authMode: 'chatgpt',
        email: 'admin@applyron.com',
        planType: 'team',
        requiresOpenaiAuth: true,
        serviceTier: 'flex',
        agentMode: 'full-access',
        lastUpdatedAt: 123,
      },
      quota: null,
      quotaByLimitId: null,
      isProcessRunning: true,
      lastUpdatedAt: 123,
      fromCache: false,
      activeRuntimeId: 'windows-local',
      requiresRuntimeSelection: false,
      hasRuntimeMismatch: false,
      runtimes: [createRuntimeStatus()],
    });

    const adapter = new VscodeCodexAdapter();
    await adapter.getCurrentStatus({ refresh: true });

    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        email: 'admin@applyron.com',
        makeActive: true,
      }),
    );
  });

  it('activates a stored Codex account by writing auth.json and reloading the running VS Code window', async () => {
    const storedAccount = createAccountRecord({
      id: 'codex-1',
      accountId: 'acc-1',
      isActive: false,
    });
    const activatedAccount = createAccountRecord({
      id: 'codex-1',
      accountId: 'acc-1',
      isActive: true,
      updatedAt: 50,
      lastRefreshedAt: 60,
    });

    mockGetAccount.mockResolvedValueOnce(storedAccount).mockResolvedValueOnce(activatedAccount);
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-1'));

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.activateAccount('codex-1');

    expect(mockWriteCodexAuthFile).toHaveBeenCalledWith(createAuthFile('acc-1'), defaultAuthPath);
    expect(mockSetActiveAccount).toHaveBeenCalledWith('codex-1');
    expect(mockOpenExternal).toHaveBeenCalledWith('vscode://command/workbench.action.reloadWindow');
    expect(mockCloseManagedIde).not.toHaveBeenCalled();
    expect(mockStartManagedIde).not.toHaveBeenCalled();
    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        existingId: 'codex-1',
        accountId: 'acc-1',
        makeActive: true,
      }),
    );
    expect(result.isActive).toBe(true);
  });

  it('falls back to a safe VS Code restart when the reload command cannot be triggered', async () => {
    const storedAccount = createAccountRecord({
      id: 'codex-1',
      accountId: 'acc-1',
      isActive: false,
    });
    const activatedAccount = createAccountRecord({
      id: 'codex-1',
      accountId: 'acc-1',
      isActive: true,
      updatedAt: 50,
      lastRefreshedAt: 60,
    });

    mockOpenExternal.mockRejectedValue(new Error('no vscode handler'));
    mockGetAccount.mockResolvedValueOnce(storedAccount).mockResolvedValueOnce(activatedAccount);
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-1'));

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.activateAccount('codex-1');

    expect(mockOpenExternal).toHaveBeenCalledWith('vscode://command/workbench.action.reloadWindow');
    expect(mockCloseManagedIde).toHaveBeenCalledWith('vscode-codex', {
      includeProcessTree: false,
    });
    expect(mockStartManagedIde).toHaveBeenCalledWith('vscode-codex', false);
    expect(result.isActive).toBe(true);
  });

  it('uses a hard restart the first time an imported account is activated', async () => {
    mockGetHydrationState.mockResolvedValue('needs_import_restore');
    mockGetAccount
      .mockResolvedValueOnce(
        createAccountRecord({ id: 'codex-imported', accountId: 'acc-imported' }),
      )
      .mockResolvedValueOnce(
        createAccountRecord({
          id: 'codex-imported',
          accountId: 'acc-imported',
          isActive: true,
        }),
      );
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-imported'));

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.activateAccount('codex-imported');

    expect(mockOpenExternal).not.toHaveBeenCalledWith(
      'vscode://command/workbench.action.reloadWindow',
    );
    expect(mockCloseManagedIde).toHaveBeenCalledWith('vscode-codex', {
      includeProcessTree: false,
    });
    expect(mockStartManagedIde).toHaveBeenCalledWith('vscode-codex', false);
    expect(mockSetHydrationState).toHaveBeenCalledWith('codex-imported', 'live');
    expect(result.isActive).toBe(true);
  });

  it('writes the selected account into the WSL runtime auth file when the remote runtime is active', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue('wsl-remote');
    mockResolveWslRuntimeHome.mockReturnValue({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: wslLinuxHome,
      accessibleHomePath: wslAccessibleHome,
    });
    mockGetAccount
      .mockResolvedValueOnce(createAccountRecord({ id: 'codex-wsl', accountId: 'acc-wsl' }))
      .mockResolvedValueOnce(
        createAccountRecord({ id: 'codex-wsl', accountId: 'acc-wsl', isActive: true }),
      );
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-wsl'));
    mockReadCodexAuthFile.mockImplementation((filePath?: string) => {
      if (filePath === wslAuthPath) {
        return createAuthFile('acc-wsl');
      }
      if (!filePath || filePath === defaultAuthPath) {
        return createAuthFile('acc-1');
      }
      return null;
    });
    mockGetCodexEmailHint.mockImplementation((authFile) => {
      if (authFile?.tokens?.account_id === 'acc-wsl') {
        return 'wsl@applyron.com';
      }
      return 'admin@applyron.com';
    });

    const adapter = new VscodeCodexAdapter();
    await adapter.activateAccount('codex-wsl');

    expect(mockWriteCodexAuthFile).toHaveBeenCalledWith(createAuthFile('acc-wsl'), wslAuthPath);
  });

  it('stores the imported active account in the pool when runtime selection is still ambiguous', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue(null);
    mockResolveWslRuntimeHome.mockReturnValue({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: wslLinuxHome,
      accessibleHomePath: wslAccessibleHome,
    });
    mockGetAccount.mockResolvedValue(
      createAccountRecord({ id: 'codex-imported', accountId: 'acc-imported' }),
    );
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-imported'));

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.restoreImportedAccount('codex-imported');

    expect(result.status).toBe('stored_only_runtime_selection_required');
    expect(result.appliedRuntimeId).toBeNull();
    expect(mockSetActiveAccount).toHaveBeenCalledWith('codex-imported');
    expect(mockWriteCodexAuthFile).not.toHaveBeenCalled();
  });

  it('restores an imported active account with a full restart when the runtime is resolved', async () => {
    mockGetAccount.mockResolvedValue(
      createAccountRecord({ id: 'codex-imported', accountId: 'acc-imported' }),
    );
    mockReadStoredAuthFile.mockResolvedValue(createAuthFile('acc-imported'));

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.restoreImportedAccount('codex-imported');

    expect(result).toEqual({
      restoredAccountId: 'codex-imported',
      appliedRuntimeId: 'windows-local',
      didRestartIde: true,
      status: 'applied',
      warnings: [],
    });
    expect(mockWriteCodexAuthFile).toHaveBeenCalledWith(
      createAuthFile('acc-imported'),
      defaultAuthPath,
    );
    expect(mockCloseManagedIde).toHaveBeenCalledWith('vscode-codex', {
      includeProcessTree: false,
    });
    expect(mockStartManagedIde).toHaveBeenCalledWith('vscode-codex', false);
    expect(mockSetHydrationState).toHaveBeenCalledWith('codex-imported', 'live');
  });

  it('syncs the fresher runtime state into the other runtime', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue('windows-local');
    mockResolveWslRuntimeHome.mockReturnValue({
      authority: 'ubuntu',
      distroName: 'Ubuntu',
      linuxHomePath: wslLinuxHome,
      accessibleHomePath: wslAccessibleHome,
    });
    mockReadCodexAuthFile.mockImplementation((filePath?: string) => {
      if (filePath === wslAuthPath) {
        return {
          ...createAuthFile('acc-wsl'),
          last_refresh: '2026-03-22T12:00:00.000Z',
        };
      }
      if (!filePath || filePath === defaultAuthPath) {
        return {
          ...createAuthFile('acc-win'),
          last_refresh: '2026-03-20T12:00:00.000Z',
        };
      }
      return null;
    });

    const adapter = new VscodeCodexAdapter();
    const result = await adapter.syncRuntimeState();

    expect(result.sourceRuntimeId).toBe('wsl-remote');
    expect(result.targetRuntimeId).toBe('windows-local');
    expect(mockWriteCodexAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({ account_id: 'acc-wsl' }),
      }),
      defaultAuthPath,
    );
    expect(mockDatabaseRun).toHaveBeenCalled();
  });

  it('marks accounts that fail auth migration as requiring re-login during background refresh', async () => {
    mockListAccounts
      .mockResolvedValueOnce([
        createAccountRecord({
          id: 'codex-broken',
          accountId: 'acc-broken',
          updatedAt: 20,
          lastRefreshedAt: 30,
        }),
      ])
      .mockResolvedValueOnce([
        createAccountRecord({
          id: 'codex-broken',
          accountId: 'acc-broken',
          updatedAt: 20,
          lastRefreshedAt: 30,
        }),
      ]);
    mockGetAccount.mockResolvedValue(
      createAccountRecord({
        id: 'codex-broken',
        accountId: 'acc-broken',
        updatedAt: 20,
        lastRefreshedAt: 30,
      }),
    );
    mockReadStoredAuthFile.mockRejectedValue(new Error('ERR_DATA_MIGRATION_FAILED|HINT_RELOGIN'));

    const adapter = new VscodeCodexAdapter();
    await adapter.refreshAllAccounts();

    expect(mockUpdateSnapshot).toHaveBeenCalledWith(
      'codex-broken',
      expect.objectContaining({
        session: expect.objectContaining({
          state: 'requires_login',
        }),
      }),
    );
  });

  it('skips accounts that already require re-login during background refresh', async () => {
    mockListAccounts
      .mockResolvedValueOnce([
        createAccountRecord({
          id: 'codex-attention',
          accountId: 'acc-attention',
          updatedAt: 20,
          lastRefreshedAt: 30,
          snapshot: {
            session: {
              state: 'requires_login',
              accountType: 'chatgpt',
              authMode: 'chatgpt',
              email: 'admin@applyron.com',
              planType: 'team',
              requiresOpenaiAuth: true,
              serviceTier: 'flex',
              agentMode: 'full-access',
              lastUpdatedAt: 40,
            },
            quota: null,
            quotaByLimitId: null,
            lastUpdatedAt: 40,
          },
        }),
      ])
      .mockResolvedValueOnce([
        createAccountRecord({
          id: 'codex-attention',
          accountId: 'acc-attention',
          updatedAt: 20,
          lastRefreshedAt: 30,
          snapshot: {
            session: {
              state: 'requires_login',
              accountType: 'chatgpt',
              authMode: 'chatgpt',
              email: 'admin@applyron.com',
              planType: 'team',
              requiresOpenaiAuth: true,
              serviceTier: 'flex',
              agentMode: 'full-access',
              lastUpdatedAt: 40,
            },
            quota: null,
            quotaByLimitId: null,
            lastUpdatedAt: 40,
          },
        }),
      ]);

    const adapter = new VscodeCodexAdapter();
    await adapter.refreshAllAccounts();

    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockReadStoredAuthFile).not.toHaveBeenCalled();
  });
});
