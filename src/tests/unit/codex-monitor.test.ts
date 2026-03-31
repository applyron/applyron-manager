import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCurrentStatus, mockRefreshAllCodexAccounts } = vi.hoisted(() => ({
  mockGetCurrentStatus: vi.fn(),
  mockRefreshAllCodexAccounts: vi.fn(),
}));

vi.mock('../../managedIde/service', () => ({
  ManagedIdeService: {
    getCurrentStatus: mockGetCurrentStatus,
    refreshAllCodexAccounts: mockRefreshAllCodexAccounts,
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../../utils/logger';
import { CodexMonitorService } from '../../services/CodexMonitorService';

describe('CodexMonitorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.clearAllMocks();
    CodexMonitorService.resetStateForTesting();
    mockGetCurrentStatus.mockResolvedValue({
      installation: {
        available: true,
      },
    });
    mockRefreshAllCodexAccounts.mockResolvedValue([]);
  });

  afterEach(() => {
    CodexMonitorService.stop();
    vi.useRealTimers();
  });

  it('starts with an immediate poll and repeats every 5 minutes', async () => {
    const pollSpy = vi.spyOn(CodexMonitorService, 'poll').mockResolvedValue(undefined);

    CodexMonitorService.start();
    expect(pollSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000 * 60 * 5);
    expect(pollSpy).toHaveBeenCalledTimes(2);
  });

  it('refreshes Codex status and account pool when available', async () => {
    await CodexMonitorService.poll();

    expect(mockGetCurrentStatus).toHaveBeenCalledWith({
      targetId: 'vscode-codex',
      refresh: true,
    });
    expect(mockRefreshAllCodexAccounts).toHaveBeenCalledTimes(1);
  });

  it('skips account refresh when VS Code Codex is unavailable', async () => {
    mockGetCurrentStatus.mockResolvedValue({
      installation: {
        available: false,
      },
    });

    await CodexMonitorService.poll();

    expect(mockRefreshAllCodexAccounts).not.toHaveBeenCalled();
  });

  it('debounces focus-triggered polls and resets the interval after a successful refresh', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const pollSpy = vi.spyOn(CodexMonitorService, 'poll').mockResolvedValue(undefined);

    CodexMonitorService.start();
    vi.setSystemTime(Date.now() + 20000);

    await CodexMonitorService.handleAppFocus();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('does not trigger a focus poll while debounce is active', async () => {
    const pollSpy = vi.spyOn(CodexMonitorService, 'poll').mockResolvedValue(undefined);

    CodexMonitorService.start();
    vi.setSystemTime(Date.now() + 1000);

    await CodexMonitorService.handleAppFocus();

    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('debounce active'));
  });
});
