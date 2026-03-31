import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveReleaseRepository,
  resolveReleaseRepositorySlug,
  resolveReleaseUpdateSource,
  resolveReleaseRepositoryUrl,
  resolveStaticUpdateBaseUrl,
  resolveTrustedStaticUpdateHost,
  validateReleaseUpdateSource,
} from '../../config/managerBrand';

const originalOwner = process.env.APPLYRON_GITHUB_OWNER;
const originalRepo = process.env.APPLYRON_GITHUB_REPO;
const originalUrl = process.env.APPLYRON_RELEASE_REPO_URL;
const originalUpdateSource = process.env.APPLYRON_UPDATE_SOURCE;
const originalUpdateBaseUrl = process.env.APPLYRON_UPDATE_BASE_URL;

function restoreEnv() {
  if (originalOwner === undefined) {
    delete process.env.APPLYRON_GITHUB_OWNER;
  } else {
    process.env.APPLYRON_GITHUB_OWNER = originalOwner;
  }

  if (originalRepo === undefined) {
    delete process.env.APPLYRON_GITHUB_REPO;
  } else {
    process.env.APPLYRON_GITHUB_REPO = originalRepo;
  }

  if (originalUrl === undefined) {
    delete process.env.APPLYRON_RELEASE_REPO_URL;
  } else {
    process.env.APPLYRON_RELEASE_REPO_URL = originalUrl;
  }

  if (originalUpdateSource === undefined) {
    delete process.env.APPLYRON_UPDATE_SOURCE;
  } else {
    process.env.APPLYRON_UPDATE_SOURCE = originalUpdateSource;
  }

  if (originalUpdateBaseUrl === undefined) {
    delete process.env.APPLYRON_UPDATE_BASE_URL;
  } else {
    process.env.APPLYRON_UPDATE_BASE_URL = originalUpdateBaseUrl;
  }
}

afterEach(() => {
  restoreEnv();
});

describe('manager brand release defaults', () => {
  it('defaults release metadata to the Applyron repository', () => {
    delete process.env.APPLYRON_GITHUB_OWNER;
    delete process.env.APPLYRON_GITHUB_REPO;
    delete process.env.APPLYRON_RELEASE_REPO_URL;

    expect(resolveReleaseRepository()).toEqual({
      owner: 'applyron',
      name: 'applyron-manager',
    });
    expect(resolveReleaseRepositorySlug()).toBe('applyron/applyron-manager');
    expect(resolveReleaseRepositoryUrl()).toBe('https://github.com/applyron/applyron-manager');
  });

  it('allows env overrides for repository owner, repo, and URL', () => {
    process.env.APPLYRON_GITHUB_OWNER = 'custom-owner';
    process.env.APPLYRON_GITHUB_REPO = 'custom-repo';
    process.env.APPLYRON_RELEASE_REPO_URL = 'https://example.com/releases/custom';

    expect(resolveReleaseRepository()).toEqual({
      owner: 'custom-owner',
      name: 'custom-repo',
    });
    expect(resolveReleaseRepositorySlug()).toBe('custom-owner/custom-repo');
    expect(resolveReleaseRepositoryUrl()).toBe('https://example.com/releases/custom');
  });

  it('defaults Windows update checks to the static update server', () => {
    delete process.env.APPLYRON_UPDATE_SOURCE;
    delete process.env.APPLYRON_UPDATE_BASE_URL;

    expect(resolveStaticUpdateBaseUrl({ platform: 'win32', arch: 'x64' })).toBe(
      'https://updates.applyron.com/applyron-manager/win32/x64',
    );
    expect(resolveReleaseUpdateSource({ platform: 'win32', arch: 'x64' })).toEqual({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/win32/x64',
    });
  });

  it('defaults macOS update checks to the static update server', () => {
    delete process.env.APPLYRON_UPDATE_SOURCE;
    delete process.env.APPLYRON_UPDATE_BASE_URL;

    expect(resolveReleaseUpdateSource({ platform: 'darwin', arch: 'arm64' })).toEqual({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/darwin/arm64',
    });
  });

  it('allows env overrides for static update hosting when overrides are enabled', () => {
    process.env.APPLYRON_UPDATE_SOURCE = 'static';
    process.env.APPLYRON_UPDATE_BASE_URL = 'https://downloads.example.com/applyron';

    expect(
      resolveStaticUpdateBaseUrl({ platform: 'darwin', arch: 'arm64', allowEnvOverride: true }),
    ).toBe('https://downloads.example.com/applyron/darwin/arm64');
    expect(
      resolveReleaseUpdateSource({ platform: 'darwin', arch: 'arm64', allowEnvOverride: true }),
    ).toEqual({
      type: 'static',
      baseUrl: 'https://downloads.example.com/applyron/darwin/arm64',
    });
  });

  it('allows forcing GitHub updates only when overrides are enabled', () => {
    process.env.APPLYRON_UPDATE_SOURCE = 'github';

    expect(
      resolveReleaseUpdateSource({ platform: 'win32', arch: 'arm64', allowEnvOverride: true }),
    ).toEqual({
      type: 'github',
      repo: 'applyron/applyron-manager',
    });
  });

  it('ignores updater env overrides when packaged-production rules are enforced', () => {
    process.env.APPLYRON_UPDATE_SOURCE = 'github';
    process.env.APPLYRON_UPDATE_BASE_URL = 'https://downloads.example.com/applyron';

    expect(
      resolveStaticUpdateBaseUrl({ platform: 'darwin', arch: 'arm64', allowEnvOverride: false }),
    ).toBe('https://updates.applyron.com/applyron-manager/darwin/arm64');
    expect(resolveTrustedStaticUpdateHost({ allowEnvOverride: false })).toBe(
      'updates.applyron.com',
    );
    expect(
      resolveReleaseUpdateSource({ platform: 'darwin', arch: 'arm64', allowEnvOverride: false }),
    ).toEqual({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/darwin/arm64',
    });
  });

  it('rejects non-HTTPS static update sources', () => {
    expect(() =>
      validateReleaseUpdateSource({
        type: 'static',
        baseUrl: 'http://updates.applyron.com/applyron-manager/win32/x64',
      }),
    ).toThrow('Automatic updates are disabled because the static update source must use HTTPS.');
  });

  it('rejects static update hosts that do not match the trusted host', () => {
    expect(() =>
      validateReleaseUpdateSource({
        type: 'static',
        baseUrl: 'https://evil.example/applyron-manager/win32/x64',
      }),
    ).toThrow(
      'Automatic updates are disabled because the static update host must match updates.applyron.com.',
    );
  });

  it('rejects GitHub update sources that do not match the trusted repo slug', () => {
    expect(() =>
      validateReleaseUpdateSource({
        type: 'github',
        repo: 'evil/repo',
      }),
    ).toThrow(
      'Automatic updates are disabled because the release repository must match applyron/applyron-manager.',
    );
  });
});
