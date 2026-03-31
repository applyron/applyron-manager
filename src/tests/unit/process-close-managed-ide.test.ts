import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadProcessHandler() {
  vi.resetModules();

  const execSync = vi.fn((command: string) => {
    if (command.startsWith('powershell -NoProfile -Command')) {
      return '"ProcessId","Name","CommandLine"\n';
    }

    return '';
  });
  const exec = vi.fn();

  vi.doMock('child_process', () => ({
    exec,
    execSync,
    default: {
      exec,
      execSync,
    },
  }));

  vi.doMock('find-process', () => ({
    default: vi.fn(),
  }));

  vi.doMock('../../utils/logger', () => ({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

  vi.doMock('../../utils/paths', () => ({
    getManagedIdeExecutablePath: vi.fn(() => 'C:\\Program Files\\Microsoft VS Code\\Code.exe'),
    isWsl: vi.fn(() => false),
  }));

  const handler = await import('../../ipc/process/handler');
  return {
    closeManagedIde: handler.closeManagedIde,
    execSync,
  };
}

describe('closeManagedIde Windows process tree handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'pid', { value: 4242, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('omits /T for VS Code account activation restarts', async () => {
    const { closeManagedIde, execSync } = await loadProcessHandler();

    const closePromise = closeManagedIde('vscode-codex', {
      includeProcessTree: false,
    });
    await vi.runAllTimersAsync();
    await closePromise;

    expect(execSync).toHaveBeenNthCalledWith(
      1,
      'taskkill /IM "Code.exe"',
      expect.objectContaining({
        stdio: 'ignore',
        timeout: 2000,
      }),
    );
  });

  it('keeps /T by default for existing process-control calls', async () => {
    const { closeManagedIde, execSync } = await loadProcessHandler();

    const closePromise = closeManagedIde('vscode-codex');
    await vi.runAllTimersAsync();
    await closePromise;

    expect(execSync).toHaveBeenNthCalledWith(
      1,
      'taskkill /IM "Code.exe" /T',
      expect.objectContaining({
        stdio: 'ignore',
        timeout: 2000,
      }),
    );
  });
});
