import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_CONFIG } from '../../types/config';

describe('server config store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.APPLYRON_DEFAULT_PROJECT_ID;
  });

  it('returns frozen snapshots without exposing mutable references', async () => {
    const { getServerConfig, setServerConfig } = await import('../../server/server-config');

    const runtimeConfig = {
      ...DEFAULT_APP_CONFIG.proxy,
      preferred_account_id: 'acc-2',
      upstream_proxy: {
        ...DEFAULT_APP_CONFIG.proxy.upstream_proxy,
        enabled: true,
        url: 'http://localhost:9000',
      },
    };

    setServerConfig(runtimeConfig);
    const snapshot = getServerConfig();

    expect(snapshot).not.toBe(runtimeConfig);
    expect(snapshot?.upstream_proxy).not.toBe(runtimeConfig.upstream_proxy);
    expect(snapshot?.preferred_account_id).toBe('acc-2');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.upstream_proxy)).toBe(true);

    expect(() => {
      (snapshot as { preferred_account_id: string }).preferred_account_id = 'mutated';
    }).toThrow();

    expect(getServerConfig()?.preferred_account_id).toBe('acc-2');
  });

  it('prefers runtime snapshot when resolving default project id', async () => {
    process.env.APPLYRON_DEFAULT_PROJECT_ID = 'env-seed-project';

    vi.doMock('../../ipc/config/manager', () => ({
      ConfigManager: {
        getCachedConfig: () => ({
          ...DEFAULT_APP_CONFIG,
          proxy: {
            ...DEFAULT_APP_CONFIG.proxy,
            default_project_id: 'cached-project-id',
          },
        }),
      },
    }));

    const { resolveServerDefaultProjectId, setServerConfig } =
      await import('../../server/server-config');

    setServerConfig({
      ...DEFAULT_APP_CONFIG.proxy,
      default_project_id: 'runtime-project-id',
    });

    expect(resolveServerDefaultProjectId()).toBe('runtime-project-id');
  });

  it('falls back from cached config to env seed to legacy default', async () => {
    process.env.APPLYRON_DEFAULT_PROJECT_ID = 'env-seed-project';

    vi.doMock('../../ipc/config/manager', () => ({
      ConfigManager: {
        getCachedConfig: () => null,
      },
    }));

    let serverConfig = await import('../../server/server-config');
    expect(serverConfig.resolveServerDefaultProjectId()).toBe('env-seed-project');

    delete process.env.APPLYRON_DEFAULT_PROJECT_ID;
    vi.resetModules();

    vi.doMock('../../ipc/config/manager', () => ({
      ConfigManager: {
        getCachedConfig: () => null,
      },
    }));

    serverConfig = await import('../../server/server-config');
    expect(serverConfig.resolveServerDefaultProjectId()).toBe(
      DEFAULT_APP_CONFIG.proxy.default_project_id,
    );
  });
});
