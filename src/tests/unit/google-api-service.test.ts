import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GoogleOAuthBuildGlobals = typeof globalThis & {
  __APPLYRON_GOOGLE_CLIENT_ID__?: string;
  __APPLYRON_GOOGLE_CLIENT_SECRET__?: string;
};

describe('GoogleAPIService OAuth configuration', () => {
  const buildGlobals = globalThis as GoogleOAuthBuildGlobals;
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.APPLYRON_GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.APPLYRON_GOOGLE_CLIENT_SECRET;
  const originalEmbeddedClientId = buildGlobals.__APPLYRON_GOOGLE_CLIENT_ID__;
  const originalEmbeddedClientSecret = buildGlobals.__APPLYRON_GOOGLE_CLIENT_SECRET__;

  beforeEach(() => {
    delete process.env.APPLYRON_GOOGLE_CLIENT_ID;
    delete process.env.APPLYRON_GOOGLE_CLIENT_SECRET;
    delete buildGlobals.__APPLYRON_GOOGLE_CLIENT_ID__;
    delete buildGlobals.__APPLYRON_GOOGLE_CLIENT_SECRET__;
  });

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.APPLYRON_GOOGLE_CLIENT_ID;
    } else {
      process.env.APPLYRON_GOOGLE_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.APPLYRON_GOOGLE_CLIENT_SECRET;
    } else {
      process.env.APPLYRON_GOOGLE_CLIENT_SECRET = originalClientSecret;
    }

    if (originalEmbeddedClientId === undefined) {
      delete buildGlobals.__APPLYRON_GOOGLE_CLIENT_ID__;
    } else {
      buildGlobals.__APPLYRON_GOOGLE_CLIENT_ID__ = originalEmbeddedClientId;
    }

    if (originalEmbeddedClientSecret === undefined) {
      delete buildGlobals.__APPLYRON_GOOGLE_CLIENT_SECRET__;
    } else {
      buildGlobals.__APPLYRON_GOOGLE_CLIENT_SECRET__ = originalEmbeddedClientSecret;
    }

    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch');
    } else {
      globalThis.fetch = originalFetch;
    }

    vi.restoreAllMocks();
  });

  it('rejects auth URL generation when OAuth env vars are missing', async () => {
    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    expect(() => GoogleAPIService.getAuthUrl('http://127.0.0.1/callback')).toThrow(
      'GOOGLE_OAUTH_NOT_CONFIGURED',
    );
  });

  it('builds the auth URL when OAuth env vars exist', async () => {
    process.env.APPLYRON_GOOGLE_CLIENT_ID = 'client-id';
    process.env.APPLYRON_GOOGLE_CLIENT_SECRET = 'client-secret';

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const url = GoogleAPIService.getAuthUrl('http://127.0.0.1/callback');

    expect(url).toContain('client_id=client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback');
  });

  it('falls back to embedded OAuth credentials when runtime env vars are missing', async () => {
    buildGlobals.__APPLYRON_GOOGLE_CLIENT_ID__ = 'embedded-client-id';
    buildGlobals.__APPLYRON_GOOGLE_CLIENT_SECRET__ = 'embedded-client-secret';

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const url = GoogleAPIService.getAuthUrl('http://127.0.0.1/callback');

    expect(url).toContain('client_id=embedded-client-id');
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback');
  });

  it('ignores quota models whose remaining fraction is missing or non-numeric', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: {
          'gemini-2.5-flash': {
            quotaInfo: {
              remainingFraction: 0.42,
              resetTime: '2026-03-30T18:00:00.000Z',
            },
          },
          'gemini-2.5-pro': {
            quotaInfo: {
              remainingFraction: 'unknown',
              resetTime: '2026-03-30T18:00:00.000Z',
            },
          },
          'gemini-2.5-thinking': {
            quotaInfo: {
              resetTime: '2026-03-30T18:00:00.000Z',
            },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const fetchProjectContextSpy = vi
      .spyOn(GoogleAPIService, 'fetchProjectContext')
      .mockResolvedValue({
        projectId: 'resolved-project',
        subscriptionTier: 'pro',
      });

    const quota = await GoogleAPIService.fetchQuota('access-token');

    expect(fetchProjectContextSpy).toHaveBeenCalledWith('access-token');
    expect(quota.subscription_tier).toBe('pro');
    expect(quota.models).toEqual({
      'gemini-2.5-flash': {
        percentage: 42,
        resetTime: '2026-03-30T18:00:00.000Z',
        display_name: undefined,
        supports_images: undefined,
        supports_thinking: undefined,
        thinking_budget: undefined,
        recommended: undefined,
        max_tokens: undefined,
        max_output_tokens: undefined,
        supported_mime_types: undefined,
      },
    });
  });

  it('reuses a stored project id without reloading project context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: {
          'gemini-2.5-flash': {
            quotaInfo: {
              remainingFraction: 0.77,
              resetTime: '2026-03-30T18:00:00.000Z',
            },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const { GoogleAPIService } = await import('../../services/GoogleAPIService');
    const fetchProjectContextSpy = vi.spyOn(GoogleAPIService, 'fetchProjectContext');

    const quota = await GoogleAPIService.fetchQuota('access-token', {
      projectId: 'stored-project',
      subscriptionTier: 'enterprise',
    });

    expect(fetchProjectContextSpy).not.toHaveBeenCalled();
    expect(quota.subscription_tier).toBe('enterprise');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ project: 'stored-project' }),
      }),
    );
  });
});
