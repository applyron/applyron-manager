import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexRuntimeEnvironment } from '../../managedIde/vscodeCodexAdapter/types';

const { mockGetActiveVsCodeWindowRuntimeId } = vi.hoisted(() => ({
  mockGetActiveVsCodeWindowRuntimeId: vi.fn(),
}));

vi.mock('../../utils/wslRuntime', () => ({
  getActiveVsCodeWindowRuntimeId: mockGetActiveVsCodeWindowRuntimeId,
  getActiveVsCodeWslAuthority: vi.fn(),
  getKnownWslAuthorities: vi.fn(() => []),
  getWslExecutableCommand: vi.fn(() => 'wsl.exe'),
  resolveWslRuntimeHome: vi.fn(),
}));

vi.mock('../../utils/paths', () => ({
  getManagedIdeDbPaths: vi.fn(() => []),
  getManagedIdeExecutablePath: vi.fn(() => null),
  getManagedIdeStoragePaths: vi.fn(() => []),
  getAgentDir: vi.fn(() => '/tmp/agent'),
  isWsl: vi.fn(() => true),
}));

vi.mock('../../utils/platformPaths', () => ({
  getWindowsUser: vi.fn(() => 'ahmet'),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  },
}));

function createRuntime(id: CodexRuntimeEnvironment['id']): CodexRuntimeEnvironment {
  return {
    id,
    displayName: id,
    installation: {
      targetId: 'vscode-codex',
      platformSupported: true,
      available: true,
      reason: 'ready',
      idePath: null,
      ideVersion: null,
      extensionPath: null,
      extensionVersion: null,
      codexCliPath: null,
      extensionId: null,
    },
    authFilePath: null,
    stateDbPath: null,
    storagePath: null,
    authLastUpdatedAt: null,
    extensionStateUpdatedAt: null,
    codexCliExecutionPath: null,
    wslDistroName: null,
    wslLinuxHomePath: null,
  };
}

describe('vscodeCodexAdapter/runtimeEnvironment', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue(null);
  });

  it('falls back to Windows Local when multiple runtimes are available and nothing is detected', async () => {
    const { resolveCodexRuntimeSelection } = await import(
      '../../managedIde/vscodeCodexAdapter/runtimeEnvironment'
    );

    const selection = resolveCodexRuntimeSelection([
      createRuntime('windows-local'),
      createRuntime('wsl-remote'),
    ]);

    expect(selection.activeRuntimeId).toBe('windows-local');
    expect(selection.requiresRuntimeSelection).toBe(false);
  });

  it('still prefers the detected WSL runtime when the active VS Code window is remote', async () => {
    mockGetActiveVsCodeWindowRuntimeId.mockReturnValue('wsl-remote');
    const { resolveCodexRuntimeSelection } = await import(
      '../../managedIde/vscodeCodexAdapter/runtimeEnvironment'
    );

    const selection = resolveCodexRuntimeSelection([
      createRuntime('windows-local'),
      createRuntime('wsl-remote'),
    ]);

    expect(selection.activeRuntimeId).toBe('wsl-remote');
    expect(selection.requiresRuntimeSelection).toBe(false);
  });
});
