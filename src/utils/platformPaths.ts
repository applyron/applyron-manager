import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

let cachedWindowsUser: string | null = null;

export function isWsl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    return version.includes('microsoft') && version.includes('wsl');
  } catch {
    return false;
  }
}

export function getWindowsUser(): string {
  if (cachedWindowsUser) {
    return cachedWindowsUser;
  }

  try {
    const stdout = execSync('/mnt/c/Windows/System32/cmd.exe /c "echo %USERNAME%"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = stdout.trim().split(/\r?\n/);
    const user = lines[lines.length - 1]?.trim();
    if (user) {
      cachedWindowsUser = user;
      return user;
    }
  } catch {
    // Ignore and continue with local fallbacks.
  }

  const linuxUser = os.userInfo().username;
  if (fs.existsSync(`/mnt/c/Users/${linuxUser}`)) {
    cachedWindowsUser = linuxUser;
    return linuxUser;
  }

  try {
    const users = fs
      .readdirSync('/mnt/c/Users')
      .filter(
        (entry) =>
          !['Public', 'Default', 'Default User', 'All Users', 'desktop.ini'].includes(entry) &&
          fs.statSync(path.join('/mnt/c/Users', entry)).isDirectory(),
      );

    if (users.length > 0) {
      cachedWindowsUser = users[0];
      return users[0];
    }
  } catch {
    // Ignore and fall back to a generic placeholder.
  }

  return 'User';
}
