import fs from 'fs';
import os from 'os';
import path from 'path';
import { getManagerStorageDir } from '../config/managerBrand';
import { getManagedIdeTarget, DEFAULT_MANAGED_IDE_TARGET_ID } from '../managedIde/registry';
import type { ManagedIdeTargetId } from '../managedIde/types';
import { getWindowsUser, isWsl } from './platformPaths';

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getPlatformSupportDir(dirName: string, hiddenFallbackDirName: string): string {
  const home = os.homedir();

  if (isWsl()) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/AppData/Roaming/${dirName}`;
  }

  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', dirName);
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), dirName);
    case 'linux':
      return path.join(home, '.config', dirName);
    default:
      return path.join(home, hiddenFallbackDirName);
  }
}

function getManagerStorageFilePath(preferredFileName: string, legacyFileName: string): string {
  const managerStorageDir = getManagerStorageDir();
  const preferredPath = path.join(managerStorageDir, preferredFileName);
  const legacyPath = path.join(managerStorageDir, legacyFileName);

  if (!fs.existsSync(preferredPath) && fs.existsSync(legacyPath)) {
    try {
      fs.copyFileSync(legacyPath, preferredPath);
    } catch {
      // Ignore legacy migration failures and let callers write a fresh file later.
    }
  }

  return preferredPath;
}

export { isWsl } from './platformPaths';

export function getManagedIdeAppDataDirCandidates(
  targetId: ManagedIdeTargetId = DEFAULT_MANAGED_IDE_TARGET_ID,
): string[] {
  const target = getManagedIdeTarget(targetId);
  const dirNames = [target.appDataDirName, ...(target.legacyAppDataDirNames || [])];

  return dedupe(
    dirNames.map((dirName) => getPlatformSupportDir(dirName, target.hiddenFallbackDirName)),
  );
}

export function getManagedIdeAppDataDir(
  targetId: ManagedIdeTargetId = DEFAULT_MANAGED_IDE_TARGET_ID,
): string {
  const candidates = getManagedIdeAppDataDirCandidates(targetId);
  return candidates.length > 0 ? candidates[0] : '';
}

export function getAppDataDir(): string {
  return getManagedIdeAppDataDir('antigravity');
}

export function getAgentDir(): string {
  return getManagerStorageDir();
}

export function getAccountsFilePath(): string {
  return getManagerStorageFilePath('applyron_accounts.json', 'antigravity_accounts.json');
}

export function getBackupsDir(): string {
  return path.join(getManagerStorageDir(), 'backups');
}

export function getCloudAccountsDbPath(): string {
  return path.join(getManagerStorageDir(), 'cloud_accounts.db');
}

function getManagedIdeFileCandidates(targetId: ManagedIdeTargetId, fileName: string): string[] {
  const appDataCandidates = getManagedIdeAppDataDirCandidates(targetId);
  return dedupe(
    appDataCandidates.flatMap((appDataDir) => [
      path.join(appDataDir, 'User', 'globalStorage', fileName),
      path.join(appDataDir, 'User', fileName),
      path.join(appDataDir, fileName),
    ]),
  );
}

export function getManagedIdeDbPaths(
  targetId: ManagedIdeTargetId = DEFAULT_MANAGED_IDE_TARGET_ID,
): string[] {
  return getManagedIdeFileCandidates(targetId, 'state.vscdb');
}

export function getManagedIdeStoragePaths(
  targetId: ManagedIdeTargetId = DEFAULT_MANAGED_IDE_TARGET_ID,
): string[] {
  return getManagedIdeFileCandidates(targetId, 'storage.json');
}

export function getAntigravityDbPaths(): string[] {
  return getManagedIdeDbPaths('antigravity');
}

export function getAntigravityStoragePaths(): string[] {
  return getManagedIdeStoragePaths('antigravity');
}

export function getAntigravityStoragePath(): string {
  const paths = getAntigravityStoragePaths();
  return paths.length > 0 ? paths[0] : '';
}

export function getAntigravityDbPath(): string {
  const paths = getAntigravityDbPaths();
  return paths.length > 0 ? paths[0] : '';
}

function getLinuxExecutableCandidates(targetId: ManagedIdeTargetId): string[] {
  const target = getManagedIdeTarget(targetId);
  const binaryNames = target.linuxBinaryNames || [];

  return dedupe(
    binaryNames.flatMap((binaryName) => [
      `/usr/share/${binaryName}/${binaryName}`,
      `/usr/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/opt/${target.shortName}/${binaryName}`,
      `/opt/${binaryName}/${binaryName}`,
      path.join(os.homedir(), '.local', 'share', binaryName, binaryName),
      ...(process.env.PATH?.split(':').map((dir) => path.join(dir, binaryName)) || []),
    ]),
  );
}

export function getManagedIdeExecutablePath(
  targetId: ManagedIdeTargetId = DEFAULT_MANAGED_IDE_TARGET_ID,
): string {
  const target = getManagedIdeTarget(targetId);

  if (
    isWsl() &&
    target.windowsExecutableName &&
    target.windowsInstallDirNames &&
    target.windowsInstallDirNames.length > 0
  ) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/AppData/Local/Programs/${target.windowsInstallDirNames[0]}/${target.windowsExecutableName}`;
  }

  if (process.platform === 'darwin' && target.macAppName && target.macExecutableName) {
    return `/Applications/${target.macAppName}.app/Contents/MacOS/${target.macExecutableName}`;
  }

  if (
    process.platform === 'win32' &&
    target.windowsExecutableName &&
    target.windowsInstallDirNames &&
    target.windowsInstallDirNames.length > 0
  ) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const possiblePaths = target.windowsInstallDirNames.flatMap((dirName) => [
      path.join(localAppData, 'Programs', dirName, target.windowsExecutableName as string),
      path.join(programFiles, dirName, target.windowsExecutableName as string),
      path.join(programFilesX86, dirName, target.windowsExecutableName as string),
    ]);

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    return '';
  }

  if (process.platform === 'linux') {
    const possiblePaths = getLinuxExecutableCandidates(targetId);
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }

    return possiblePaths[0] || '';
  }

  return '';
}

export function getAntigravityExecutablePath(): string {
  return getManagedIdeExecutablePath('antigravity');
}
