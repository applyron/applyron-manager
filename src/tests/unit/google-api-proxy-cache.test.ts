import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedConfigOrLoad, mockProxyAgent, mockLoggerWarn } = vi.hoisted(() => ({
  mockGetCachedConfigOrLoad: vi.fn(),
  mockProxyAgent: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('../../ipc/config/manager', () => ({
  ConfigManager: {
    getCachedConfigOrLoad: mockGetCachedConfigOrLoad,
  },
}));

vi.mock('undici', () => ({
  ProxyAgent: mockProxyAgent,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

describe('GoogleAPIService proxy agent caching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const service = GoogleAPIService as unknown as {
      clearCachedProxyAgent: () => void;
    };
    service.clearCachedProxyAgent();
  });

  it('reuses the cached ProxyAgent for the same upstream proxy URL', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mockProxyAgent.mockImplementation(function (this: { close: typeof close }) {
      this.close = close;
    });
    mockGetCachedConfigOrLoad.mockReturnValue({
      proxy: {
        upstream_proxy: {
          enabled: true,
          url: 'http://proxy-a:8080',
        },
      },
    });

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const service = GoogleAPIService as unknown as {
      getFetchOptions: () => { dispatcher?: unknown };
    };

    const first = service.getFetchOptions();
    const second = service.getFetchOptions();
    const [agent] = mockProxyAgent.mock.instances;

    expect(first.dispatcher).toBe(agent);
    expect(second.dispatcher).toBe(agent);
    expect(mockProxyAgent).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('replaces and closes the cached ProxyAgent when the upstream proxy URL changes', async () => {
    const firstClose = vi.fn().mockResolvedValue(undefined);
    const secondClose = vi.fn().mockResolvedValue(undefined);
    mockProxyAgent
      .mockImplementationOnce(function (this: { close: typeof firstClose }) {
        this.close = firstClose;
      })
      .mockImplementationOnce(function (this: { close: typeof secondClose }) {
        this.close = secondClose;
      });
    mockGetCachedConfigOrLoad
      .mockReturnValueOnce({
        proxy: {
          upstream_proxy: {
            enabled: true,
            url: 'http://proxy-a:8080',
          },
        },
      })
      .mockReturnValueOnce({
        proxy: {
          upstream_proxy: {
            enabled: true,
            url: 'http://proxy-b:9090',
          },
        },
      });

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const service = GoogleAPIService as unknown as {
      getFetchOptions: () => { dispatcher?: unknown };
    };

    const first = service.getFetchOptions();
    const second = service.getFetchOptions();
    const [firstAgent, secondAgent] = mockProxyAgent.mock.instances;

    expect(first.dispatcher).toBe(firstAgent);
    expect(second.dispatcher).toBe(secondAgent);
    expect(mockProxyAgent).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
  });
});
