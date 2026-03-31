import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getManagedIdeExecutablePath } from './paths';
import { getManagedIdeTarget } from '../managedIde/registry';
import type { ManagedIdeTargetId } from '../managedIde/types';

export interface AntigravityVersion {
  shortVersion: string;
  bundleVersion: string;
}

type ManagedIdeVersion = AntigravityVersion;

const cachedVersions = new Map<ManagedIdeTargetId, ManagedIdeVersion>();
const cachedErrors = new Map<ManagedIdeTargetId, Error>();

function cacheAndReturn(
  targetId: ManagedIdeTargetId,
  version: ManagedIdeVersion,
): ManagedIdeVersion {
  cachedVersions.set(targetId, version);
  return version;
}

function readPackageJsonVersion(execPath: string): ManagedIdeVersion | null {
  const parentDir = path.dirname(execPath);
  const packageJson = path.join(parentDir, 'resources', 'app', 'package.json');
  if (!fs.existsSync(packageJson)) {
    return null;
  }

  try {
    const content = fs.readFileSync(packageJson, 'utf-8');
    const json = JSON.parse(content) as { version?: string };
    const parsed = parseVersionString(json.version || null);
    return {
      shortVersion: parsed,
      bundleVersion: parsed,
    };
  } catch {
    return null;
  }
}

function readPlistValue(content: string, key: string): string | null {
  const pattern = new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function parseVersionString(version: string | null): string {
  if (!version) {
    throw new Error('Version information not found');
  }

  const trimmed = version.trim();
  if (!trimmed) {
    throw new Error('Version information is empty');
  }

  return trimmed;
}

export function getManagedIdeVersion(
  targetId: ManagedIdeTargetId = 'antigravity',
): ManagedIdeVersion {
  const cachedVersion = cachedVersions.get(targetId);
  if (cachedVersion) {
    return cachedVersion;
  }

  const cachedError = cachedErrors.get(targetId);
  if (cachedError) {
    throw cachedError;
  }

  try {
    const execPath = getManagedIdeExecutablePath(targetId);
    if (!execPath) {
      const target = getManagedIdeTarget(targetId);
      throw new Error(`Unable to locate ${target.processDisplayName} executable`);
    }

    if (targetId !== 'antigravity') {
      const target = getManagedIdeTarget(targetId);
      throw new Error(`Version discovery is not implemented for ${target.displayName}`);
    }

    if (process.platform === 'win32') {
      try {
        const escapedPath = execPath.replace(/'/g, "''");
        const command = `(Get-Item '${escapedPath}').VersionInfo.FileVersion`;
        const version = execSync(`powershell -NoProfile -Command "${command}"`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        const parsed = parseVersionString(version);
        return cacheAndReturn(targetId, {
          shortVersion: parsed,
          bundleVersion: parsed,
        });
      } catch (error) {
        const fallback = readPackageJsonVersion(execPath);
        if (fallback) {
          return cacheAndReturn(targetId, fallback);
        }
        throw error;
      }
    }

    if (process.platform === 'darwin') {
      const appIndex = execPath.toLowerCase().indexOf('.app');
      const appPath = appIndex >= 0 ? execPath.slice(0, appIndex + 4) : execPath;
      const plistPath = path.join(appPath, 'Contents', 'Info.plist');
      if (!fs.existsSync(plistPath)) {
        throw new Error(`Info.plist not found: ${plistPath}`);
      }

      let content = fs.readFileSync(plistPath, 'utf-8');
      if (content.startsWith('bplist')) {
        try {
          content = execSync(`plutil -convert xml1 -o - "${plistPath}"`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch {
          throw new Error('Failed to parse Info.plist');
        }
      }

      const shortVersion = parseVersionString(
        readPlistValue(content, 'CFBundleShortVersionString'),
      );
      const bundleVersion = parseVersionString(
        readPlistValue(content, 'CFBundleVersion') || shortVersion,
      );

      return cacheAndReturn(targetId, {
        shortVersion,
        bundleVersion,
      });
    }

    if (process.platform === 'linux') {
      try {
        const output = execSync(`"${execPath}" --version`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const parsed = parseVersionString(output);
        return cacheAndReturn(targetId, {
          shortVersion: parsed,
          bundleVersion: parsed,
        });
      } catch {
        const fallback = readPackageJsonVersion(execPath);
        if (fallback) {
          return cacheAndReturn(targetId, fallback);
        }
      }
    }

    throw new Error('Unable to determine Antigravity version');
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error('Unable to determine Antigravity version');
    cachedErrors.set(targetId, normalized);
    throw normalized;
  }
}

export function getAntigravityVersion(): AntigravityVersion {
  return getManagedIdeVersion('antigravity');
}

export function compareVersion(v1: string, v2: string): number {
  const parts1 = v1
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => !Number.isNaN(value));
  const parts2 = v2
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => !Number.isNaN(value));
  const length = Math.max(parts1.length, parts2.length);

  for (let index = 0; index < length; index += 1) {
    const left = parts1[index] ?? 0;
    const right = parts2[index] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }

  return 0;
}

export function isNewVersion(version: AntigravityVersion): boolean {
  return compareVersion(version.shortVersion, '1.16.5') >= 0;
}
