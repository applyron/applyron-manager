import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../types/config';

describe('ConfigManager', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applyron-config-'));
    configPath = path.join(tempDir, 'gui_config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('backs up invalid config files and falls back to defaults', async () => {
    fs.writeFileSync(configPath, '{invalid json', 'utf8');

    vi.doMock('../../config/managerBrand', () => ({
      getManagerConfigPath: () => configPath,
    }));
    vi.doMock('../../utils/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const { ServiceHealthRegistry } = await import('../../services/ServiceHealthRegistry');
    ServiceHealthRegistry.resetForTesting();

    const { ConfigManager } = await import('../../ipc/config/manager');
    const loaded = ConfigManager.loadConfig();

    expect(loaded).toEqual({
      ...DEFAULT_APP_CONFIG,
      proxy: expect.objectContaining({
        ...DEFAULT_APP_CONFIG.proxy,
        api_key: expect.stringMatching(/^sk-[a-f0-9]{32}$/),
      }),
    });

    const backupFiles = fs
      .readdirSync(tempDir)
      .filter((fileName) => fileName.includes('.invalid.json'));
    expect(backupFiles.length).toBe(1);
    expect(
      ServiceHealthRegistry.getSummary().services.find((item) => item.id === 'config')?.state,
    ).toBe('error');
  });

  it('generates and persists a proxy API key when config is missing', async () => {
    vi.doMock('../../config/managerBrand', () => ({
      getManagerConfigPath: () => configPath,
    }));
    vi.doMock('../../utils/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const { ConfigManager } = await import('../../ipc/config/manager');
    const loaded = ConfigManager.loadConfig();
    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(loaded.proxy.api_key).toMatch(/^sk-[a-f0-9]{32}$/);
    expect(persisted.proxy.api_key).toBe(loaded.proxy.api_key);
  });

  it('normalizes legacy grid layout values to the supported contract', async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ...DEFAULT_APP_CONFIG,
        grid_layout: '3-col',
      }),
      'utf8',
    );

    vi.doMock('../../config/managerBrand', () => ({
      getManagerConfigPath: () => configPath,
    }));
    vi.doMock('../../utils/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    const { ConfigManager } = await import('../../ipc/config/manager');
    const loaded = ConfigManager.loadConfig();
    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(loaded.grid_layout).toBe('2-col');
    expect(persisted.grid_layout).toBe('2-col');
  });
});
