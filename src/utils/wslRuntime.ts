import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CodexRuntimeId } from '../managedIde/types';
import { getWindowsUser, isWsl } from './platformPaths';

interface VsCodeWindowStateStorage {
  windowsState?: {
    lastActiveWindow?: {
      folder?: string;
    } | null;
  } | null;
  backupWorkspaces?: {
    folders?: Array<{
      folderUri?: string;
      remoteAuthority?: string;
    }>;
  } | null;
}

export interface WslRuntimeHome {
  authority: string;
  distroName: string;
  linuxHomePath: string;
  accessibleHomePath: string;
}

function normalizeCommandOutput(output: Buffer | string): string {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  return text.split('\0').join('').trim();
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function getWindowsVsCodeStoragePath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.win32.join(os.homedir(), 'AppData', 'Roaming');
    return path.win32.join(appData, 'Code', 'User', 'globalStorage', 'storage.json');
  }

  const winUser = getWindowsUser();
  return path.posix.join(
    '/mnt/c/Users',
    winUser,
    'AppData',
    'Roaming',
    'Code',
    'User',
    'globalStorage',
    'storage.json',
  );
}

export function readWindowsVsCodeStorage(): VsCodeWindowStateStorage | null {
  return readJsonFile<VsCodeWindowStateStorage>(getWindowsVsCodeStoragePath());
}

export function normalizeWslAuthority(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith('wsl+')) {
    return null;
  }

  return trimmed.slice(4).toLowerCase();
}

export function getActiveVsCodeWindowRuntimeId(): CodexRuntimeId | null {
  const storage = readWindowsVsCodeStorage();
  const folder = storage?.windowsState?.lastActiveWindow?.folder?.trim();
  if (!folder) {
    return null;
  }

  if (folder.startsWith('vscode-remote://wsl%2B')) {
    return 'wsl-remote';
  }

  if (folder.startsWith('file:///')) {
    return 'windows-local';
  }

  return null;
}

export function getActiveVsCodeWslAuthority(): string | null {
  const storage = readWindowsVsCodeStorage();
  const folder = storage?.windowsState?.lastActiveWindow?.folder?.trim();
  if (!folder?.startsWith('vscode-remote://wsl%2B')) {
    return null;
  }

  const decoded = decodeURIComponent(folder.replace('vscode-remote://', ''));
  return normalizeWslAuthority(decoded.split('/')[0] ?? null);
}

export function getKnownWslAuthorities(): string[] {
  const storage = readWindowsVsCodeStorage();
  const authorities = new Set<string>();

  for (const folder of storage?.backupWorkspaces?.folders ?? []) {
    const folderUriAuthority = folder.folderUri?.startsWith('vscode-remote://wsl%2B')
      ? (decodeURIComponent(folder.folderUri.replace('vscode-remote://', '')).split('/')[0] ?? null)
      : null;
    const normalized =
      normalizeWslAuthority(folder.remoteAuthority) ?? normalizeWslAuthority(folderUriAuthority);
    if (normalized) {
      authorities.add(normalized);
    }
  }

  return [...authorities];
}

function getWindowsWslDistros(): string[] {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const output = execSync('wsl.exe -l -q', {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return normalizeCommandOutput(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveDistroName(authorityHint: string | null): string | null {
  if (isWsl()) {
    return process.env.WSL_DISTRO_NAME?.trim() || authorityHint || null;
  }

  if (process.platform !== 'win32') {
    return null;
  }

  const candidates = getWindowsWslDistros();
  if (candidates.length === 0) {
    return null;
  }

  if (authorityHint) {
    const exactMatch =
      candidates.find((candidate) => candidate.toLowerCase() === authorityHint.toLowerCase()) ??
      null;
    if (exactMatch) {
      return exactMatch;
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function getWindowsAccessibleWslPath(distroName: string, linuxPath: string): string {
  const normalizedLinuxPath = linuxPath.replace(/^\/+/, '').replace(/\//g, '\\');
  return `\\\\wsl$\\${distroName}\\${normalizedLinuxPath}`;
}

function readWindowsWslHomePath(distroName: string): string | null {
  try {
    const output = execSync(
      `wsl.exe -d ${JSON.stringify(distroName)} sh -lc 'printf "%s" "$HOME"'`,
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const normalized = normalizeCommandOutput(output);
    return normalized || null;
  } catch {
    return null;
  }
}

export function resolveWslRuntimeHome(authorityHint?: string | null): WslRuntimeHome | null {
  const normalizedAuthority = normalizeWslAuthority(authorityHint) ?? authorityHint?.trim() ?? null;
  const distroName = resolveDistroName(normalizedAuthority);
  if (!distroName) {
    return null;
  }

  if (isWsl()) {
    return {
      authority: normalizedAuthority ?? distroName.toLowerCase(),
      distroName,
      linuxHomePath: os.homedir(),
      accessibleHomePath: os.homedir(),
    };
  }

  if (process.platform !== 'win32') {
    return null;
  }

  const linuxHomePath = readWindowsWslHomePath(distroName);
  if (!linuxHomePath) {
    return null;
  }

  return {
    authority: normalizedAuthority ?? distroName.toLowerCase(),
    distroName,
    linuxHomePath,
    accessibleHomePath: getWindowsAccessibleWslPath(distroName, linuxHomePath),
  };
}

export function toAccessibleWslPath(distroName: string, linuxPath: string): string {
  return process.platform === 'win32'
    ? getWindowsAccessibleWslPath(distroName, linuxPath)
    : linuxPath;
}
