import type { ChildProcess } from 'child_process';
import path from 'path';

export interface WindowsSquirrelPaths {
  installDirectory: string;
  updateExecutablePath: string;
  uninstallLauncherPath: string;
}

const WINDOWS_PATH = path.win32;

export function getWindowsSquirrelPaths(execPath: string): WindowsSquirrelPaths {
  const installDirectory = WINDOWS_PATH.dirname(execPath);
  return {
    installDirectory,
    updateExecutablePath: WINDOWS_PATH.join(installDirectory, 'Update.exe'),
    uninstallLauncherPath: WINDOWS_PATH.join(installDirectory, 'Uninstall.exe'),
  };
}

export function isWindowsUninstallLauncherExecution({
  platform,
  isPackaged,
  execPath,
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
}): boolean {
  return (
    platform === 'win32' &&
    isPackaged &&
    WINDOWS_PATH.basename(execPath).toLowerCase() === 'uninstall.exe'
  );
}

export function triggerWindowsUninstallFromLauncher({
  platform,
  isPackaged,
  execPath,
  existsSync,
  spawnImpl,
  quit,
  exit,
  logger,
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  existsSync: (targetPath: string) => boolean;
  spawnImpl: (
    command: string,
    args: string[],
    options: { detached: boolean; stdio: 'ignore'; windowsHide: boolean },
  ) => Pick<ChildProcess, 'unref'>;
  quit: () => void;
  exit: (code: number) => never;
  logger: {
    error: (message: string, error?: unknown) => void;
  };
}): boolean {
  if (
    !isWindowsUninstallLauncherExecution({
      platform,
      isPackaged,
      execPath,
    })
  ) {
    return false;
  }

  const { updateExecutablePath } = getWindowsSquirrelPaths(execPath);
  if (!existsSync(updateExecutablePath)) {
    logger.error(`Uninstall launcher could not find Update.exe at ${updateExecutablePath}`);
    quit();
    exit(1);
  }

  try {
    const child = spawnImpl(updateExecutablePath, ['--uninstall'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    logger.error('Failed to start Squirrel uninstall flow', error);
    quit();
    exit(1);
  }

  quit();
  exit(0);
  return true;
}

export function ensureVisibleWindowsUninstallLauncher({
  platform,
  isPackaged,
  execPath,
  existsSync,
  statSync,
  copyFileSync,
  logger,
}: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  existsSync: (targetPath: string) => boolean;
  statSync: (targetPath: string) => { size: number };
  copyFileSync: (source: string, destination: string) => void;
  logger: {
    info: (message: string) => void;
    warn: (message: string, error?: unknown) => void;
  };
}): void {
  if (
    platform !== 'win32' ||
    !isPackaged ||
    isWindowsUninstallLauncherExecution({ platform, isPackaged, execPath })
  ) {
    return;
  }

  const { updateExecutablePath, uninstallLauncherPath } = getWindowsSquirrelPaths(execPath);
  if (!existsSync(updateExecutablePath)) {
    return;
  }

  try {
    const shouldCopy =
      !existsSync(uninstallLauncherPath) ||
      statSync(uninstallLauncherPath).size !== statSync(execPath).size;

    if (!shouldCopy) {
      return;
    }

    copyFileSync(execPath, uninstallLauncherPath);
    logger.info(`Created visible uninstall launcher at ${uninstallLauncherPath}`);
  } catch (error) {
    logger.warn('Failed to create visible uninstall launcher', error);
  }
}
