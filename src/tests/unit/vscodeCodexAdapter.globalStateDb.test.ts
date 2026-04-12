import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockStatSync,
  mockPrepare,
  mockGet,
  mockRun,
  mockDatabaseFactory,
  mockWarn,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockPrepare: vi.fn(),
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockDatabaseFactory: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    statSync: mockStatSync,
  },
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    constructor(...args: unknown[]) {
      return mockDatabaseFactory(...args);
    }
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: mockWarn,
  },
}));

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    getCachedConfigOrLoad: vi.fn(() => ({})),
  },
}));

vi.mock('../../utils/paths', () => ({
  getManagedIdeDbPaths: vi.fn(() => []),
  getManagedIdeExecutablePath: vi.fn(() => null),
  getManagedIdeStoragePaths: vi.fn(() => []),
  isWsl: vi.fn(() => false),
}));

vi.mock('../../utils/wslRuntime', () => ({
  getActiveVsCodeWindowRuntimeId: vi.fn(() => null),
  getActiveVsCodeWslAuthority: vi.fn(() => null),
  getKnownWslAuthorities: vi.fn(() => []),
  getWslExecutableCommand: vi.fn(() => 'wsl.exe'),
  resolveWslRuntimeHome: vi.fn(() => null),
}));

vi.mock('../../utils/platformPaths', () => ({
  getWindowsUser: vi.fn(() => 'ahmet'),
}));

describe('vscodeCodexAdapter/globalStateDb', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReset();
    mockStatSync.mockReturnValue({ mtimeMs: 1234 });
    mockPrepare.mockReset();
    mockGet.mockReset();
    mockRun.mockReset();
    mockWarn.mockReset();
    mockDatabaseFactory.mockReset();
    mockDatabaseFactory.mockImplementation(() => ({
      prepare: mockPrepare.mockReturnValue({
        get: mockGet,
        run: mockRun,
      }),
      close: vi.fn(),
    }));
  });

  it('parses stringified persisted atom state from state.vscdb', async () => {
    mockGet.mockReturnValue({
      value: JSON.stringify({
        'persisted-atom-state': JSON.stringify({
          'service-tier': 'flex',
          'agent-mode': 'full-auto',
        }),
        'codex-cloud-access': 'enabled_needs_setup',
      }),
    });

    const { readCodexGlobalStateSnapshot } =
      await import('../../managedIde/vscodeCodexAdapter/globalStateDb');
    const snapshot = readCodexGlobalStateSnapshot('C:/state.vscdb');

    expect(snapshot.codexCloudAccess).toBe('enabled_needs_setup');
    expect(snapshot.defaultServiceTier).toBe('flex');
    expect(snapshot.agentMode).toBe('full-auto');
    expect(snapshot.updatedAt).toBe(1234);
  });

  it('backs off repeated reads after a sqlite lock error', async () => {
    mockDatabaseFactory.mockImplementationOnce(() => {
      throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    });

    const { readCodexGlobalStateSnapshot } =
      await import('../../managedIde/vscodeCodexAdapter/globalStateDb');

    const first = readCodexGlobalStateSnapshot('C:/state.vscdb');
    const second = readCodexGlobalStateSnapshot('C:/state.vscdb');

    expect(first.rawValue).toBeNull();
    expect(second.rawValue).toBeNull();
    expect(mockDatabaseFactory).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      'VS Code Codex global state read skipped because state.vscdb is locked',
      expect.any(Error),
    );
  });
});
