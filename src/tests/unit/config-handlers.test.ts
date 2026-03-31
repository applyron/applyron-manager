import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../types/config';

const mockGetCachedConfig = vi.fn();
const mockLoadConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockSyncAutoStart = vi.fn();
const mockSetServerConfig = vi.fn();
const mockUpdateTrayMenu = vi.fn();
const mockSyncCodexAutoSwitch = vi.fn();

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    getCachedConfig: mockGetCachedConfig,
    loadConfig: mockLoadConfig,
    saveConfig: mockSaveConfig,
  },
}));

vi.mock('../../utils/autoStart', () => ({
  syncAutoStart: mockSyncAutoStart,
}));

vi.mock('../../utils/logger', () => ({
  logger: {},
}));

vi.mock('../../server/server-config', () => ({
  setServerConfig: mockSetServerConfig,
}));

vi.mock('../../ipc/tray/handler', () => ({
  updateTrayMenu: mockUpdateTrayMenu,
}));

vi.mock('../../services/CodexAutoSwitchService', () => ({
  CodexAutoSwitchService: {
    syncWithConfig: mockSyncCodexAutoSwitch,
  },
}));

describe('config handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedConfig.mockReturnValue(DEFAULT_APP_CONFIG);
    mockLoadConfig.mockReturnValue(DEFAULT_APP_CONFIG);
    mockSaveConfig.mockResolvedValue(undefined);
    mockSyncCodexAutoSwitch.mockResolvedValue(undefined);
  });

  it('syncs Codex auto-switch lifecycle after persisting config', async () => {
    const { saveConfig } = await import('../../ipc/config/handlers');
    const nextConfig = {
      ...DEFAULT_APP_CONFIG,
      codex_auto_switch_enabled: true,
    };
    mockGetCachedConfig.mockReturnValueOnce(DEFAULT_APP_CONFIG).mockReturnValue(nextConfig);

    await saveConfig(nextConfig);

    expect(mockSaveConfig).toHaveBeenCalledWith(nextConfig);
    expect(mockSetServerConfig).toHaveBeenCalledWith(nextConfig.proxy);
    expect(mockSyncCodexAutoSwitch).toHaveBeenCalledWith(nextConfig);
  });
});
