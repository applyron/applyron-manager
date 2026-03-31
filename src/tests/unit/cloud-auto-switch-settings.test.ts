import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSettingMock = vi.fn();
const startMock = vi.fn();
const pollMock = vi.fn(async () => undefined);
const isPackagedE2EEnvironmentMock = vi.fn(() => false);

vi.mock('../../ipc/database/cloudHandler', () => ({
  CloudAccountRepo: {
    setSetting: setSettingMock,
    getSetting: vi.fn(),
  },
}));

vi.mock('../../services/CloudMonitorService', () => ({
  cloudMonitorService: {
    start: startMock,
    poll: pollMock,
  },
}));

vi.mock('../../utils/runtimeMode', () => ({
  isPackagedE2EEnvironment: isPackagedE2EEnvironmentMock,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock('../../ipc/tray/handler', () => ({
  updateTrayMenu: vi.fn(),
}));

vi.mock('../../ipc/device/handler', () => ({
  ensureGlobalOriginalFromCurrentStorage: vi.fn(),
  generateDeviceProfile: vi.fn(),
  getStorageDirectoryPath: vi.fn(() => 'mock-storage'),
  isIdentityProfileApplyEnabled: vi.fn(() => true),
  loadGlobalOriginalProfile: vi.fn(),
  readCurrentDeviceProfile: vi.fn(),
  saveGlobalOriginalProfile: vi.fn(),
}));

vi.mock('../../utils/paths', () => ({
  getAntigravityDbPaths: vi.fn(() => []),
}));

vi.mock('../../services/GoogleAPIService', () => ({
  GoogleAPIService: {
    refreshAccessToken: vi.fn(),
  },
}));

vi.mock('../../ipc/switchGuard', () => ({
  runWithSwitchGuard: vi.fn(async (_owner: string, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../../ipc/switchFlow', () => ({
  executeSwitchFlow: vi.fn(),
}));

describe('setAutoSwitchEnabled', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    isPackagedE2EEnvironmentMock.mockReturnValue(false);
    pollMock.mockResolvedValue(undefined);
  });

  it('starts the quota monitor and triggers an immediate poll when enabling auto-switch', async () => {
    const { setAutoSwitchEnabled } = await import('../../ipc/cloud/handler');

    await setAutoSwitchEnabled(true);

    expect(setSettingMock).toHaveBeenCalledWith('auto_switch_enabled', true);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(pollMock).toHaveBeenCalledTimes(1);
    expect(startMock.mock.invocationCallOrder[0]).toBeLessThan(
      pollMock.mock.invocationCallOrder[0],
    );
  });

  it('only persists the setting when disabling auto-switch', async () => {
    const { setAutoSwitchEnabled } = await import('../../ipc/cloud/handler');

    await setAutoSwitchEnabled(false);

    expect(setSettingMock).toHaveBeenCalledWith('auto_switch_enabled', false);
    expect(startMock).not.toHaveBeenCalled();
    expect(pollMock).not.toHaveBeenCalled();
  });

  it('preserves the packaged E2E exception when enabling auto-switch', async () => {
    isPackagedE2EEnvironmentMock.mockReturnValue(true);
    const { setAutoSwitchEnabled } = await import('../../ipc/cloud/handler');

    await setAutoSwitchEnabled(true);

    expect(setSettingMock).toHaveBeenCalledWith('auto_switch_enabled', true);
    expect(startMock).not.toHaveBeenCalled();
    expect(pollMock).not.toHaveBeenCalled();
  });
});
