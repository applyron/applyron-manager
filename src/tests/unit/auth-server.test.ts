import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceHealthRegistry } from '../../services/ServiceHealthRegistry';

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    loadConfig: vi.fn(() => ({ language: 'en' })),
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuthServer', () => {
  beforeEach(() => {
    vi.resetModules();
    ServiceHealthRegistry.resetForTesting();
  });

  afterEach(async () => {
    const { AuthServer } = await import('../../ipc/cloud/authServer');
    AuthServer.stop();
  });

  it('starts on a random loopback port and exposes the redirect URI', async () => {
    const { AuthServer } = await import('../../ipc/cloud/authServer');

    const first = await AuthServer.startOrReuse();
    const second = await AuthServer.startOrReuse();

    expect(first.port).toBeGreaterThan(0);
    expect(first.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth-callback$/);
    expect(second.redirectUri).toBe(first.redirectUri);
    expect(AuthServer.getStatus()).toMatchObject({
      state: 'ready',
      port: first.port,
      redirectUri: first.redirectUri,
    });

    AuthServer.stop();

    expect(AuthServer.getStatus().state).toBe('idle');
    expect(
      ServiceHealthRegistry.getSummary().services.find((item) => item.id === 'auth_server')?.state,
    ).toBe('idle');
  });
});
