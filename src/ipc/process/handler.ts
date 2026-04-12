import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import findProcess, { ProcessInfo } from 'find-process';
import { getManagedIdeExecutablePath, isWsl } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { getManagedIdeTarget } from '../../managedIde/registry';
import type { ManagedIdeTargetId } from '../../managedIde/types';

const execAsync = promisify(exec);

const HELPER_PATTERNS = [
  'helper',
  'plugin',
  'renderer',
  'gpu',
  'crashpad',
  'utility',
  'audio',
  'sandbox',
  'language_server',
];

function isHelperProcess(name: string, cmd: string): boolean {
  const nameLower = name.toLowerCase();
  const cmdLower = cmd.toLowerCase();

  if (cmdLower.includes('--type=')) {
    return true;
  }

  return HELPER_PATTERNS.some(
    (pattern) => nameLower.includes(pattern) || cmdLower.includes(pattern),
  );
}

function isPgrepNoMatchError(error: unknown, searchNames: string[]): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const hasPgrep =
    message.includes('pgrep') &&
    searchNames.some((searchName) => message.includes(searchName.toLowerCase()));
  const code = (error as { code?: number }).code;
  return hasPgrep && code === 1;
}

function isManagerProcess(name: string, cmd: string, targetId: ManagedIdeTargetId): boolean {
  const target = getManagedIdeTarget(targetId);
  return target.managerProcessHints.some((hint) => {
    const normalizedHint = hint.toLowerCase();
    return name.includes(normalizedHint) || cmd.includes(normalizedHint);
  });
}

function isVsCodeMainProcess(name: string, cmd: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  const normalizedCmd = cmd.trim().toLowerCase();

  if (process.platform === 'win32') {
    if (normalizedName !== 'code.exe' && normalizedName !== 'code') {
      return false;
    }

    if (
      normalizedCmd.includes('update.exe') ||
      normalizedCmd.includes('updater') ||
      normalizedCmd.includes('setup')
    ) {
      return false;
    }

    if (!normalizedCmd) {
      return true;
    }

    return /(?:^|["\s\\/])code(?:\.exe)?(?:"|\s|$)/.test(normalizedCmd);
  }

  if (process.platform === 'darwin') {
    return normalizedCmd.includes('visual studio code.app') || normalizedName === 'code';
  }

  return normalizedName === 'code' || normalizedCmd.includes('/code');
}

function hasVisibleVsCodeWindowOnWindows(): boolean | null {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const output = execSync(
      'powershell.exe -NoProfile -Command "$windows = Get-Process -Name Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; if ($windows) { $windows | Select-Object -ExpandProperty Id }"',
      {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    return output.trim().length > 0;
  } catch (error) {
    logger.warn(
      'Failed to detect visible VS Code windows on Windows; falling back to process scan',
      error,
    );
    return null;
  }
}

function matchesMainProcess(proc: ProcessInfo, targetId: ManagedIdeTargetId): boolean {
  const target = getManagedIdeTarget(targetId);
  const name = proc.name?.toLowerCase() || '';
  const cmd = proc.cmd?.toLowerCase() || '';

  if (isManagerProcess(name, cmd, targetId) || isHelperProcess(name, cmd)) {
    return false;
  }

  if (targetId === 'antigravity') {
    if (process.platform === 'darwin') {
      return cmd.includes('antigravity.app') || name === 'antigravity';
    }

    if (process.platform === 'win32') {
      return name === 'antigravity.exe' || name === 'antigravity';
    }

    return (
      (name.includes('antigravity') || cmd.includes('/antigravity')) && !name.includes('tools')
    );
  }

  if (targetId === 'vscode-codex') {
    return isVsCodeMainProcess(name, cmd);
  }

  return target.processSearchNames.some((searchName) => {
    const normalized = searchName.toLowerCase();
    return name.includes(normalized) || cmd.includes(normalized);
  });
}

function logDetectedProcess(proc: ProcessInfo, targetId: ManagedIdeTargetId): void {
  const target = getManagedIdeTarget(targetId);
  const name = proc.name?.toLowerCase() || '';
  const cmd = proc.cmd?.toLowerCase() || '';

  if (process.platform === 'win32') {
    logger.debug(`Found ${target.processDisplayName} process: PID=${proc.pid}, name=${name}`);
    return;
  }

  logger.debug(
    `Found ${target.processDisplayName} process: PID=${proc.pid}, name=${name}, cmd=${cmd.substring(0, 100)}`,
  );
}

function listTargetProcesses(
  targetId: ManagedIdeTargetId,
): Array<{ pid: number; name: string; cmd: string }> {
  const target = getManagedIdeTarget(targetId);
  const platform = process.platform;

  try {
    let output = '';
    if (platform === 'win32') {
      const nameFilter = target.processSearchNames[0] || target.processDisplayName;
      const psCommand = (cmdlet: string) =>
        `powershell -NoProfile -Command "${cmdlet} Win32_Process -Filter \\"Name like '${nameFilter}%'\\" | Select-Object ProcessId, Name, CommandLine | ConvertTo-Csv -NoTypeInformation"`;

      try {
        output = execSync(psCommand('Get-CimInstance'), {
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 10,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        output = execSync(psCommand('Get-WmiObject'), {
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 10,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      }
    } else {
      output = execSync('ps -A -o pid,comm,args', {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10,
      });
    }

    const processList: Array<{ pid: number; name: string; cmd: string }> = [];

    if (platform === 'win32') {
      const lines = output.trim().split(/\r?\n/);
      for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line) {
          continue;
        }

        const match = line.match(/^"(\d+)","(.*?)","(.*?)"$/);
        if (!match) {
          continue;
        }

        const pid = Number.parseInt(match[1], 10);
        if (Number.isNaN(pid)) {
          continue;
        }

        const name = match[2];
        const cmd = match[3] || name;
        processList.push({ pid, name, cmd });
      }

      return processList;
    }

    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) {
        continue;
      }

      const pid = Number.parseInt(parts[0], 10);
      if (Number.isNaN(pid)) {
        continue;
      }

      const rest = parts.slice(1).join(' ');
      const normalizedRest = rest.toLowerCase();
      if (
        target.processSearchNames.some((searchName) =>
          normalizedRest.includes(searchName.toLowerCase()),
        )
      ) {
        processList.push({ pid, name: parts[1], cmd: rest });
      }
    }

    return processList;
  } catch (error) {
    logger.error(`Failed to list ${target.processDisplayName} processes`, error);
    return [];
  }
}

export async function isManagedIdeProcessRunning(
  targetId: ManagedIdeTargetId = 'antigravity',
): Promise<boolean> {
  const target = getManagedIdeTarget(targetId);
  const searchNames = target.processSearchNames;

  try {
    if (targetId === 'vscode-codex' && process.platform === 'win32') {
      const hasVisibleWindow = hasVisibleVsCodeWindowOnWindows();
      if (typeof hasVisibleWindow === 'boolean') {
        if (hasVisibleWindow) {
          logger.debug('Found visible VS Code main window');
        }
        return hasVisibleWindow;
      }
    }

    const currentPid = process.pid;
    const processMap = new Map<number, ProcessInfo>();
    let sawNoMatch = false;

    for (const searchName of searchNames) {
      try {
        const matches = await findProcess('name', searchName, true);
        for (const proc of matches) {
          if (typeof proc.pid === 'number') {
            processMap.set(proc.pid, proc);
          }
        }
      } catch (error) {
        if (isPgrepNoMatchError(error, searchNames)) {
          sawNoMatch = true;
          continue;
        }
        throw error;
      }
    }

    const processes = Array.from(processMap.values());
    if (processes.length === 0 && sawNoMatch) {
      logger.debug(`No ${target.processDisplayName} process found (pgrep returned 1)`);
    }

    logger.debug(`Found ${processes.length} processes matching '${searchNames.join('/')}'`);

    for (const proc of processes) {
      if (proc.pid === currentPid) {
        continue;
      }

      if (matchesMainProcess(proc, targetId)) {
        logDetectedProcess(proc, targetId);
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error('Error checking process status with find-process:', error);
    return false;
  }
}

export async function isProcessRunning(
  targetId: ManagedIdeTargetId = 'antigravity',
): Promise<boolean> {
  return isManagedIdeProcessRunning(targetId);
}

interface CloseManagedIdeOptions {
  includeProcessTree?: boolean;
}

export async function closeManagedIde(
  targetId: ManagedIdeTargetId = 'antigravity',
  options?: CloseManagedIdeOptions,
): Promise<void> {
  const target = getManagedIdeTarget(targetId);
  if (!target.capabilities.processControl) {
    throw new Error(`${target.displayName} process control is not available yet.`);
  }

  logger.info(`Closing ${target.processDisplayName}...`);
  const platform = process.platform;
  const includeProcessTree = options?.includeProcessTree ?? true;
  const windowsTaskKillTreeFlag = includeProcessTree ? ' /T' : '';

  try {
    if (platform === 'darwin' && target.macAppName) {
      try {
        logger.info('Attempting graceful exit via AppleScript...');
        execSync(`osascript -e 'tell application "${target.macAppName}" to quit'`, {
          stdio: 'ignore',
          timeout: 3000,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch {
        logger.warn('AppleScript exit failed, proceeding to next stage');
      }
    } else if (platform === 'win32' && target.windowsExecutableName) {
      try {
        logger.info(
          `Attempting graceful exit via taskkill${includeProcessTree ? ' with process tree' : ''}...`,
        );
        execSync(`taskkill /IM "${target.windowsExecutableName}"${windowsTaskKillTreeFlag}`, {
          stdio: 'ignore',
          timeout: 2000,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        // Ignore graceful failure and continue with the aggressive path.
      }
    }

    const currentPid = process.pid;
    const targetProcessList = listTargetProcesses(targetId).filter((proc) => {
      if (proc.pid === currentPid) {
        return false;
      }

      return !isManagerProcess(proc.name.toLowerCase(), proc.cmd.toLowerCase(), targetId);
    });

    if (targetProcessList.length === 0) {
      logger.info(`No ${target.processDisplayName} processes found running.`);
      return;
    }

    logger.info(
      `Found ${targetProcessList.length} remaining ${target.processDisplayName} processes. Killing...`,
    );

    for (const proc of targetProcessList) {
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch {
        // Ignore already terminated processes.
      }
    }
  } catch (error) {
    logger.error(`Error closing ${target.processDisplayName}`, error);
    try {
      if (platform === 'win32' && target.windowsExecutableName) {
        execSync(`taskkill /F /IM "${target.windowsExecutableName}"${windowsTaskKillTreeFlag}`, {
          stdio: 'ignore',
        });
      } else {
        execSync(`pkill -9 -f ${target.processSearchNames[0]}`, { stdio: 'ignore' });
      }
    } catch {
      // Ignore fallback failures.
    }
  }
}

export async function closeAntigravity(): Promise<void> {
  await closeManagedIde('antigravity');
}

async function waitForManagedIdeProcessExit(
  targetId: ManagedIdeTargetId,
  timeoutMs: number,
  pollInterval = 100,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!(await isManagedIdeProcessRunning(targetId))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  const target = getManagedIdeTarget(targetId);
  throw new Error(`${target.processDisplayName} process did not exit within ${timeoutMs}ms`);
}

export async function _waitForProcessExit(timeoutMs: number, pollInterval = 100): Promise<void> {
  await waitForManagedIdeProcessExit('antigravity', timeoutMs, pollInterval);
}

async function openUri(uri: string): Promise<boolean> {
  const platform = process.platform;
  const wsl = isWsl();

  try {
    if (platform === 'darwin') {
      await execAsync(`open "${uri}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${uri}"`);
    } else if (wsl) {
      await execAsync(`/mnt/c/Windows/System32/cmd.exe /c start "" "${uri}"`);
    } else {
      await execAsync(`xdg-open "${uri}"`);
    }
    return true;
  } catch (error) {
    logger.error('Failed to open URI', error);
    return false;
  }
}

export async function startManagedIde(
  targetId: ManagedIdeTargetId = 'antigravity',
  useUri = true,
): Promise<void> {
  const target = getManagedIdeTarget(targetId);
  if (!target.capabilities.processControl) {
    throw new Error(`${target.displayName} process control is not available yet.`);
  }

  logger.info(`Starting ${target.processDisplayName}...`);

  if (await isManagedIdeProcessRunning(targetId)) {
    logger.info(`${target.processDisplayName} is already running`);
    return;
  }

  const uri = target.uriScheme ? `${target.uriScheme}://oauth-success` : null;
  if (useUri && uri) {
    logger.info('Using URI protocol to start...');
    if (await openUri(uri)) {
      logger.info(`${target.processDisplayName} URI launch command sent`);
      return;
    }
    logger.warn('URI launch failed, trying executable path...');
  }

  logger.info('Using executable path to start...');
  const execPath = getManagedIdeExecutablePath(targetId);

  try {
    if (process.platform === 'darwin' && target.macAppName) {
      await execAsync(`open -a "${target.macAppName}"`);
    } else if (process.platform === 'win32') {
      await execAsync(`start "" "${execPath}"`);
    } else if (isWsl()) {
      const winPath = execPath
        .replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`)
        .replace(/\//g, '\\');

      await execAsync(`/mnt/c/Windows/System32/cmd.exe /c start "" "${winPath}"`);
    } else {
      const child = exec(`"${execPath}"`);
      child.unref();
    }

    logger.info(`${target.processDisplayName} launch command sent`);
  } catch (error) {
    logger.error(`Failed to start ${target.processDisplayName} via executable`, error);
    throw error;
  }
}

export async function startAntigravity(useUri = true): Promise<void> {
  await startManagedIde('antigravity', useUri);
}
