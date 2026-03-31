import fs from 'fs';
import os from 'os';
import path from 'path';

export const MANAGER_PRODUCT_NAME = 'Applyron Manager';
export const MANAGER_PRODUCT_SLUG = 'applyron-manager';
export const MANAGER_SHORT_NAME = 'Applyron';
export const MANAGER_KEYCHAIN_SERVICE_NAME = 'ApplyronManager';
export const DEFAULT_RELEASE_REPOSITORY = {
  owner: 'applyron',
  name: 'applyron-manager',
} as const;
export const DEFAULT_STATIC_UPDATE_BASE_URL = 'https://updates.applyron.com/applyron-manager';
export const DEFAULT_ANNOUNCEMENTS_FEED_URL = `${DEFAULT_STATIC_UPDATE_BASE_URL}/announcements.json`;

const LEGACY_KEYCHAIN_SERVICE_NAMES = ['AntigravityManager'];
const LEGACY_MANAGER_STORAGE_DIRS = ['.antigravity-agent'];
const LEGACY_MANAGER_CONFIG_DIRS = ['AntigravityManager', 'Antigravity'];
const LEGACY_MANAGER_USER_DATA_DIRS = [
  'Antigravity Manager',
  'AntigravityManager',
  'antigravity-manager',
];
const PRIMARY_MANAGER_STORAGE_DIR = '.applyron-manager';
const PRIMARY_MANAGER_CONFIG_DIR =
  process.platform === 'linux' ? 'applyron-manager' : 'ApplyronManager';
const PRIMARY_MANAGER_USER_DATA_DIR = MANAGER_PRODUCT_NAME;

export type ReleaseUpdateSource =
  | {
      type: 'github';
      repo: string;
    }
  | {
      type: 'static';
      baseUrl: string;
    };

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function joinUrlPath(baseUrl: string, ...segments: string[]): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedSegments = segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''));

  return [normalizedBaseUrl, ...normalizedSegments].join('/');
}

function getPlatformSupportDir(dirName: string): string {
  const home = os.homedir();

  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', dirName);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), dirName);
    case 'linux':
      return path.join(home, '.config', dirName);
    default:
      return path.join(home, dirName);
  }
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDirectoryIfNeeded(preferredDir: string, legacyDirs: string[]): string {
  if (fs.existsSync(preferredDir)) {
    return preferredDir;
  }

  ensureDirectory(preferredDir);

  const existingLegacyDir = legacyDirs.find((legacyDir) => fs.existsSync(legacyDir));
  if (!existingLegacyDir) {
    return preferredDir;
  }

  try {
    fs.cpSync(existingLegacyDir, preferredDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  } catch {
    // Ignore migration failures here; callers can continue using the new directory.
  }

  return preferredDir;
}

function copyFileIfNeeded(preferredFile: string, legacyFiles: string[]): string {
  if (fs.existsSync(preferredFile)) {
    return preferredFile;
  }

  ensureDirectory(path.dirname(preferredFile));

  const existingLegacyFile = legacyFiles.find((legacyFile) => fs.existsSync(legacyFile));
  if (!existingLegacyFile) {
    return preferredFile;
  }

  try {
    fs.copyFileSync(existingLegacyFile, preferredFile);
  } catch {
    // Ignore migration failures and allow the caller to create a fresh file later.
  }

  return preferredFile;
}

export function getManagerStorageDirCandidates(): string[] {
  return dedupe([
    path.join(os.homedir(), PRIMARY_MANAGER_STORAGE_DIR),
    ...LEGACY_MANAGER_STORAGE_DIRS.map((dirName) => path.join(os.homedir(), dirName)),
  ]);
}

export function getManagerStorageDir(): string {
  const [preferredDir, ...legacyDirs] = getManagerStorageDirCandidates();
  return copyDirectoryIfNeeded(preferredDir, legacyDirs);
}

export function getManagerConfigDirCandidates(): string[] {
  return dedupe([
    getPlatformSupportDir(PRIMARY_MANAGER_CONFIG_DIR),
    ...LEGACY_MANAGER_CONFIG_DIRS.map((dirName) => getPlatformSupportDir(dirName)),
  ]);
}

export function getManagerConfigPath(fileName: string): string {
  const [preferredDir, ...legacyDirs] = getManagerConfigDirCandidates();
  const preferredFile = path.join(preferredDir, fileName);
  const legacyFiles = legacyDirs.map((legacyDir) => path.join(legacyDir, fileName));
  return copyFileIfNeeded(preferredFile, legacyFiles);
}

export function getManagerUserDataDirCandidates(): string[] {
  return dedupe([
    getPlatformSupportDir(PRIMARY_MANAGER_USER_DATA_DIR),
    ...LEGACY_MANAGER_USER_DATA_DIRS.map((dirName) => getPlatformSupportDir(dirName)),
  ]);
}

export function getManagerKeychainServiceNames(): string[] {
  return [MANAGER_KEYCHAIN_SERVICE_NAME, ...LEGACY_KEYCHAIN_SERVICE_NAMES];
}

export function resolveReleaseRepository(): {
  owner: string;
  name: string;
} {
  const owner = process.env.APPLYRON_GITHUB_OWNER?.trim();
  const name = process.env.APPLYRON_GITHUB_REPO?.trim();

  if (owner && name) {
    return { owner, name };
  }

  return { ...DEFAULT_RELEASE_REPOSITORY };
}

export function resolveReleaseRepositorySlug(): string {
  const repository = resolveReleaseRepository();
  return `${repository.owner}/${repository.name}`;
}

export function resolveReleaseRepositoryUrl(): string {
  const explicitUrl = normalizeNonEmptyString(process.env.APPLYRON_RELEASE_REPO_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const repository = resolveReleaseRepository();
  return `https://github.com/${repository.owner}/${repository.name}`;
}

export function resolveStaticUpdateBaseUrl({
  platform = process.platform,
  arch = process.arch,
  allowEnvOverride = true,
}: {
  platform?: string;
  arch?: string;
  allowEnvOverride?: boolean;
} = {}): string {
  const configuredBaseUrl =
    (allowEnvOverride ? normalizeNonEmptyString(process.env.APPLYRON_UPDATE_BASE_URL) : null) ??
    DEFAULT_STATIC_UPDATE_BASE_URL;

  return joinUrlPath(configuredBaseUrl, platform, arch);
}

export function resolveTrustedStaticUpdateHost({
  allowEnvOverride = true,
}: {
  allowEnvOverride?: boolean;
} = {}): string {
  const configuredBaseUrl =
    (allowEnvOverride ? normalizeNonEmptyString(process.env.APPLYRON_UPDATE_BASE_URL) : null) ??
    DEFAULT_STATIC_UPDATE_BASE_URL;

  return new URL(configuredBaseUrl).hostname.toLowerCase();
}

export function resolveAnnouncementsFeedUrl(): string {
  return (
    normalizeNonEmptyString(process.env.APPLYRON_ANNOUNCEMENTS_URL) ??
    DEFAULT_ANNOUNCEMENTS_FEED_URL
  );
}

export function resolveReleaseUpdateSource({
  platform = process.platform,
  arch = process.arch,
  allowEnvOverride = true,
}: {
  platform?: string;
  arch?: string;
  allowEnvOverride?: boolean;
} = {}): ReleaseUpdateSource {
  const explicitSource = allowEnvOverride
    ? normalizeNonEmptyString(process.env.APPLYRON_UPDATE_SOURCE)?.toLowerCase()
    : null;

  if (explicitSource === 'github') {
    return {
      type: 'github',
      repo: resolveReleaseRepositorySlug(),
    };
  }

  if (explicitSource === 'static') {
    return {
      type: 'static',
      baseUrl: resolveStaticUpdateBaseUrl({ platform, arch, allowEnvOverride }),
    };
  }

  return {
    type: 'static',
    baseUrl: resolveStaticUpdateBaseUrl({ platform, arch, allowEnvOverride }),
  };
}

export function validateReleaseUpdateSource(
  updateSource: ReleaseUpdateSource,
): ReleaseUpdateSource {
  if (updateSource.type === 'static') {
    let candidateUrl: URL;

    try {
      candidateUrl = new URL(updateSource.baseUrl);
    } catch {
      throw new Error('Automatic updates are disabled because the static update URL is invalid.');
    }

    if (candidateUrl.protocol !== 'https:') {
      throw new Error(
        'Automatic updates are disabled because the static update source must use HTTPS.',
      );
    }

    let trustedHost: string;
    try {
      trustedHost = resolveTrustedStaticUpdateHost({ allowEnvOverride: false });
    } catch {
      throw new Error(
        'Automatic updates are disabled because the trusted static update host is invalid.',
      );
    }
    if (candidateUrl.hostname.toLowerCase() !== trustedHost) {
      throw new Error(
        `Automatic updates are disabled because the static update host must match ${trustedHost}.`,
      );
    }

    return updateSource;
  }

  const trustedRepo = resolveReleaseRepositorySlug();
  if (updateSource.repo !== trustedRepo) {
    throw new Error(
      `Automatic updates are disabled because the release repository must match ${trustedRepo}.`,
    );
  }

  return updateSource;
}
