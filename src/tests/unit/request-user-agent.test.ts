import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
  },
}));

vi.mock('../../utils/antigravityVersion', () => ({
  getAntigravityVersion: () => ({
    shortVersion: '1.20.0',
  }),
}));

import {
  buildUserAgent,
  resetRequestUserAgentResolutionCache,
  resolveRequestUserAgent,
  resolveRequestUserAgentConfig,
} from '../../server/modules/proxy/request-user-agent';

describe('request user agent resolution', () => {
  beforeEach(() => {
    delete process.env.APPLYRON_REQUEST_USER_AGENT;
    delete process.env.APPLYRON_REMOTE_VERSION_URL;
    delete process.env.APPLYRON_CHANGELOG_URL;
    resetRequestUserAgentResolutionCache();
    mockAxiosGet.mockReset();
  });

  it('keeps legacy discovery defaults when no overrides are provided', async () => {
    expect(resolveRequestUserAgentConfig()).toEqual({
      userAgentOverride: null,
      remoteVersionUrl: 'https://antigravity-auto-updater-974169037036.us-central1.run.app',
      changelogUrl: 'https://antigravity.google/changelog',
    });

    await expect(resolveRequestUserAgent()).resolves.toBe(buildUserAgent('1.20.0'));
  });

  it('returns an explicit user agent override without remote discovery', async () => {
    process.env.APPLYRON_REQUEST_USER_AGENT = 'applyron-manager/override-test';

    await expect(resolveRequestUserAgent()).resolves.toBe('applyron-manager/override-test');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('accepts explicit remote discovery URL overrides', () => {
    process.env.APPLYRON_REMOTE_VERSION_URL = 'https://updates.applyron.example/version';
    process.env.APPLYRON_CHANGELOG_URL = 'https://updates.applyron.example/changelog';

    expect(resolveRequestUserAgentConfig()).toEqual({
      userAgentOverride: null,
      remoteVersionUrl: 'https://updates.applyron.example/version',
      changelogUrl: 'https://updates.applyron.example/changelog',
    });
  });
});
