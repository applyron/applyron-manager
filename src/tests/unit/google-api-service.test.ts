import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type GoogleOAuthBuildGlobals = typeof globalThis & {
  __APPLYRON_GOOGLE_CLIENT_ID__?: string;
  __APPLYRON_GOOGLE_CLIENT_SECRET__?: string;
};

describe('GoogleAPIService OAuth configuration', () => {
  const buildGlobals = globalThis as GoogleOAuthBuildGlobals;
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
});
