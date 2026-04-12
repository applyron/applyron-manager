import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMkdtemp,
  mockRm,
  mockCollectSnapshot,
  mockWriteCodexAuthFile,
  mockGetCodexAuthFilePath,
  mockGetCodexPlanTypeHint,
  mockGetCodexWorkspaceFromAuthFile,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockMkdtemp: vi.fn(),
  mockRm: vi.fn(),
  mockCollectSnapshot: vi.fn(),
  mockWriteCodexAuthFile: vi.fn(),
  mockGetCodexAuthFilePath: vi.fn(),
  mockGetCodexPlanTypeHint: vi.fn(),
  mockGetCodexWorkspaceFromAuthFile: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdtemp: mockMkdtemp,
    rm: mockRm,
  },
}));

vi.mock('../../managedIde/codexAppServerClient', () => ({
  CodexAppServerClient: class MockCodexAppServerClient {
    collectSnapshot = mockCollectSnapshot;
  },
}));

vi.mock('../../managedIde/codexAuth', () => ({
  getCodexAuthFilePath: mockGetCodexAuthFilePath,
  getCodexPlanTypeHint: mockGetCodexPlanTypeHint,
  getCodexWorkspaceFromAuthFile: mockGetCodexWorkspaceFromAuthFile,
  readCodexAuthFile: vi.fn(),
  writeCodexAuthFile: mockWriteCodexAuthFile,
}));

vi.mock('../../managedIde/codexChromeWorkspaceHints', () => ({
  getCodexChromeWorkspaceLabel: vi.fn(() => null),
}));

vi.mock('../../ipc/database/cloudHandler', () => ({
  CloudAccountRepo: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  },
}));

vi.mock('../../managedIde/schemas', () => ({
  ManagedIdeCurrentStatusSchema: {
    safeParse: vi.fn(() => ({ success: false })),
  },
}));

vi.mock('../../managedIde/codexMetadata', () => ({
  normalizeCodexAgentMode: vi.fn((value: string | null) => value),
  normalizeCodexServiceTier: vi.fn((value: string | null) => value),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/paths', () => ({
  isWsl: vi.fn(() => false),
}));

vi.mock('../../utils/wslRuntime', () => ({
  getWslExecutableCommand: vi.fn(() => 'wsl.exe'),
  toAccessibleWslPath: vi.fn((_: string, runtimePath: string) => runtimePath),
}));

describe('vscodeCodexAdapter/status', () => {
  beforeEach(() => {
    vi.resetModules();
    mockMkdtemp.mockResolvedValue('/tmp/codex-home');
    mockRm.mockResolvedValue(undefined);
    mockCollectSnapshot.mockReset();
    mockWriteCodexAuthFile.mockReset();
    mockGetCodexAuthFilePath.mockReturnValue('/tmp/codex-home/auth.json');
    mockGetCodexPlanTypeHint.mockReturnValue('team');
    mockGetCodexWorkspaceFromAuthFile.mockReturnValue(null);
    mockLoggerError.mockReset();
  });

  it('normalizes quota snapshots and converts epoch seconds to milliseconds', async () => {
    const { normalizeQuotaSnapshot } = await import('../../managedIde/vscodeCodexAdapter/status');

    const snapshot = normalizeQuotaSnapshot({
      limitId: 'gpt-5',
      primary: {
        usedPercent: 42,
        resetsAt: 1_700_000_000,
      },
    });

    expect(snapshot).toEqual({
      limitId: 'gpt-5',
      limitName: null,
      planType: null,
      primary: {
        usedPercent: 42,
        resetsAt: 1_700_000_000_000,
        windowDurationMins: null,
      },
      secondary: null,
      credits: null,
    });
  });

  it('falls back to an unavailable runtime status when the app-server probe fails', async () => {
    mockCollectSnapshot.mockRejectedValue(new Error('app-server down'));
    mockGetCodexPlanTypeHint.mockReturnValue('plus');

    const { buildRuntimeStatusFromAuthFile } = await import(
      '../../managedIde/vscodeCodexAdapter/status'
    );

    const status = await buildRuntimeStatusFromAuthFile({
      runtime: {
        id: 'windows-local',
        displayName: 'Windows Local',
        installation: {
          targetId: 'vscode-codex',
          platformSupported: true,
          available: true,
          reason: 'ready',
          idePath: 'C:/Code.exe',
          ideVersion: '1.0.0',
          extensionPath: 'C:/ext',
          extensionVersion: '1.0.0',
          codexCliPath: 'C:/ext/bin/codex.exe',
          extensionId: 'openai.chatgpt',
        },
        authFilePath: 'C:/Users/ahmet/.codex/auth.json',
        stateDbPath: null,
        storagePath: null,
        authLastUpdatedAt: null,
        extensionStateUpdatedAt: null,
        codexCliExecutionPath: 'C:/ext/bin/codex.exe',
      },
      authFile: {
        OPENAI_API_KEY: null,
        last_refresh: null,
        auth_mode: 'chatgpt',
        tokens: {
          account_id: 'acct-1',
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        },
      },
      getPreferredCodexEmail: () => 'ahmet@example.com',
    });

    expect(status.session.state).toBe('unavailable');
    expect(status.installation.reason).toBe('ready');
    expect(status.liveAccountIdentityKey).toBe('acct-1');
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('does not mark runtimes as mismatched when they share the same auth identity and only one side needs login', async () => {
    const { getRuntimeMismatch } = await import('../../managedIde/vscodeCodexAdapter/status');

    const hasMismatch = getRuntimeMismatch([
      {
        runtime: {
          installation: { available: true },
        },
        authFile: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: null,
          tokens: {
            account_id: 'acct-shared',
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
        hints: {
          rawValue: '{"service-tier":"fast"}',
          codexCloudAccess: 'enabled',
          defaultServiceTier: 'fast',
          agentMode: 'full-access',
          updatedAt: 1,
        },
        status: {
          session: {
            state: 'ready',
            email: 'admin@applyron.com',
          },
        },
      },
      {
        runtime: {
          installation: { available: true },
        },
        authFile: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: null,
          tokens: {
            account_id: 'acct-shared',
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
        hints: {
          rawValue: null,
          codexCloudAccess: null,
          defaultServiceTier: null,
          agentMode: null,
          updatedAt: null,
        },
        status: {
          session: {
            state: 'requires_login',
            email: null,
          },
        },
      },
    ] as never);

    expect(hasMismatch).toBe(false);
  });

  it('marks runtimes as mismatched when their authenticated identities differ', async () => {
    const { getRuntimeMismatch } = await import('../../managedIde/vscodeCodexAdapter/status');

    const hasMismatch = getRuntimeMismatch([
      {
        runtime: {
          installation: { available: true },
        },
        authFile: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: null,
          tokens: {
            account_id: 'acct-1',
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
        hints: {
          rawValue: null,
          codexCloudAccess: null,
          defaultServiceTier: null,
          agentMode: null,
          updatedAt: null,
        },
        status: {
          session: {
            state: 'ready',
            email: 'first@applyron.com',
          },
        },
      },
      {
        runtime: {
          installation: { available: true },
        },
        authFile: {
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          last_refresh: null,
          tokens: {
            account_id: 'acct-2',
            id_token: 'id',
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
        hints: {
          rawValue: null,
          codexCloudAccess: null,
          defaultServiceTier: null,
          agentMode: null,
          updatedAt: null,
        },
        status: {
          session: {
            state: 'ready',
            email: 'second@applyron.com',
          },
        },
      },
    ] as never);

    expect(hasMismatch).toBe(true);
  });
});
