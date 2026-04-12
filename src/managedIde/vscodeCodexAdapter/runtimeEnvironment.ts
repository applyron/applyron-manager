import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  getManagedIdeDbPaths,
  getManagedIdeExecutablePath,
  getManagedIdeStoragePaths,
  isWsl,
} from '../../utils/paths';
import {
  getActiveVsCodeWindowRuntimeId,
  getActiveVsCodeWslAuthority,
  getKnownWslAuthorities,
  getWslExecutableCommand,
  resolveWslRuntimeHome,
} from '../../utils/wslRuntime';
import { getWindowsUser } from '../../utils/platformPaths';
import { logger } from '../../utils/logger';
import { OPENAI_EXTENSION_ID, WINDOWS_LOCAL_RUNTIME_LABEL, WSL_REMOTE_RUNTIME_LABEL } from './constants';
import type { CodexResolvedRuntimeSelection, CodexRuntimeEnvironment } from './types';
import type { CodexRuntimeId, ManagedIdeAvailabilityReason, ManagedIdeInstallationStatus } from '../types';

function compareVersionParts(left: string, right: string): number {
  const leftParts = left.split(/[.-]/g).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(/[.-]/g).map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function findExistingPath(candidates: string[]): string | null {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function getFileUpdatedAt(filePath: string | null): number | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getWindowsCodexHomePath(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.codex');
  }

  return path.posix.join('/mnt/c/Users', getWindowsUser(), '.codex');
}

function getWindowsCodexAuthFilePath(): string {
  return path.join(getWindowsCodexHomePath(), 'auth.json');
}

function getWindowsVsCodeExtensionsRoot(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), '.vscode', 'extensions');
  }

  return path.posix.join('/mnt/c/Users', getWindowsUser(), '.vscode', 'extensions');
}

function findOpenAiExtension(extensionsRoot: string | null): {
  extensionPath: string | null;
  extensionVersion: string | null;
} {
  if (!extensionsRoot || !fs.existsSync(extensionsRoot)) {
    return { extensionPath: null, extensionVersion: null };
  }

  const candidates = fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${OPENAI_EXTENSION_ID}-`))
    .map((entry) => {
      const extensionPath = path.join(extensionsRoot, entry.name);
      const pkg = readJsonFile<{ version?: string }>(path.join(extensionPath, 'package.json'));
      return {
        extensionPath,
        version: pkg?.version ?? entry.name.slice(`${OPENAI_EXTENSION_ID}-`.length),
      };
    })
    .sort((left, right) => compareVersionParts(right.version, left.version));

  const latest = candidates[0];
  return latest
    ? { extensionPath: latest.extensionPath, extensionVersion: latest.version }
    : { extensionPath: null, extensionVersion: null };
}

function getCodexCliPath(extensionPath: string | null, runtimeId: CodexRuntimeId): string | null {
  if (!extensionPath) {
    return null;
  }

  const codexCliPath =
    runtimeId === 'wsl-remote'
      ? path.join(extensionPath, 'bin', 'linux-x86_64', 'codex')
      : path.join(extensionPath, 'bin', 'windows-x86_64', 'codex.exe');
  return fs.existsSync(codexCliPath) ? codexCliPath : null;
}

function readVsCodeVersion(idePath: string | null): string | null {
  if (!idePath) {
    return null;
  }

  const installRoot = path.dirname(idePath);
  const packageJsonPath = path.join(installRoot, 'resources', 'app', 'package.json');
  const packageJson = readJsonFile<{ version?: string }>(packageJsonPath);
  return packageJson?.version ?? null;
}

function getInstallationStatusFromEnvironment(input: {
  runtimeId: CodexRuntimeId;
  idePath: string | null;
  extensionPath: string | null;
  extensionVersion: string | null;
  codexCliPath: string | null;
}): ManagedIdeInstallationStatus {
  const idePath = input.idePath;
  const ideVersion = readVsCodeVersion(idePath);
  const extensionPath = input.extensionPath;
  const extensionVersion = input.extensionVersion;
  const codexCliPath = input.codexCliPath;

  let reason: ManagedIdeAvailabilityReason = 'ready';
  let available = true;
  const ideExists = Boolean(idePath && fs.existsSync(idePath));

  if (input.runtimeId === 'windows-local' && process.platform !== 'win32' && !isWsl()) {
    reason = 'unsupported_platform';
    available = false;
  } else if (input.runtimeId === 'wsl-remote' && process.platform !== 'win32' && !isWsl()) {
    reason = 'unsupported_platform';
    available = false;
  } else if (!ideExists) {
    reason = 'ide_not_found';
    available = false;
  } else if (!extensionPath) {
    reason = 'extension_not_found';
    available = false;
  } else if (!codexCliPath) {
    reason = 'codex_cli_not_found';
    available = false;
  }

  return {
    targetId: 'vscode-codex',
    platformSupported: process.platform === 'win32' || isWsl(),
    available,
    reason,
    idePath,
    ideVersion,
    extensionPath,
    extensionVersion,
    codexCliPath,
    extensionId: extensionPath ? OPENAI_EXTENSION_ID : null,
  };
}

function getWslRemoteAuthorityHint(): string | null {
  return getActiveVsCodeWslAuthority() ?? getKnownWslAuthorities()[0] ?? null;
}

export function createWindowsLocalRuntimeEnvironment(): CodexRuntimeEnvironment {
  const idePath = getManagedIdeExecutablePath('vscode-codex') || null;
  const { extensionPath, extensionVersion } = findOpenAiExtension(getWindowsVsCodeExtensionsRoot());
  const codexCliPath = getCodexCliPath(extensionPath, 'windows-local');
  const stateDbPath = findExistingPath(getManagedIdeDbPaths('vscode-codex'));
  const storagePath = findExistingPath(getManagedIdeStoragePaths('vscode-codex'));
  const authFilePath = getWindowsCodexAuthFilePath();

  return {
    id: 'windows-local',
    displayName: WINDOWS_LOCAL_RUNTIME_LABEL,
    installation: getInstallationStatusFromEnvironment({
      runtimeId: 'windows-local',
      idePath,
      extensionPath,
      extensionVersion,
      codexCliPath,
    }),
    authFilePath,
    stateDbPath,
    storagePath,
    authLastUpdatedAt: getFileUpdatedAt(authFilePath),
    extensionStateUpdatedAt: getFileUpdatedAt(stateDbPath),
    codexCliExecutionPath: codexCliPath,
    wslDistroName: null,
    wslLinuxHomePath: null,
  };
}

export function createWslRemoteRuntimeEnvironment(): CodexRuntimeEnvironment | null {
  const authorityHint = getWslRemoteAuthorityHint();
  const wslHome = resolveWslRuntimeHome(authorityHint);
  if (!wslHome) {
    return null;
  }

  const idePath = getManagedIdeExecutablePath('vscode-codex') || null;
  const extensionsRoot = path.join(wslHome.accessibleHomePath, '.vscode-server', 'extensions');
  const { extensionPath, extensionVersion } = findOpenAiExtension(extensionsRoot);
  const codexCliPath = getCodexCliPath(extensionPath, 'wsl-remote');
  const stateDbPath = path.join(
    wslHome.accessibleHomePath,
    '.vscode-server',
    'data',
    'User',
    'globalStorage',
    'state.vscdb',
  );
  const storagePath = path.join(
    wslHome.accessibleHomePath,
    '.vscode-server',
    'data',
    'User',
    'globalStorage',
    'storage.json',
  );
  const authFilePath = path.join(wslHome.accessibleHomePath, '.codex', 'auth.json');
  const codexCliExecutionPath =
    process.platform === 'win32' && extensionPath
      ? path.posix.join(
          wslHome.linuxHomePath,
          '.vscode-server',
          'extensions',
          path.basename(extensionPath ?? ''),
          'bin',
          'linux-x86_64',
          'codex',
        )
      : codexCliPath;

  return {
    id: 'wsl-remote',
    displayName: WSL_REMOTE_RUNTIME_LABEL,
    installation: getInstallationStatusFromEnvironment({
      runtimeId: 'wsl-remote',
      idePath,
      extensionPath,
      extensionVersion,
      codexCliPath,
    }),
    authFilePath,
    stateDbPath,
    storagePath,
    authLastUpdatedAt: getFileUpdatedAt(authFilePath),
    extensionStateUpdatedAt: getFileUpdatedAt(stateDbPath),
    codexCliExecutionPath,
    wslDistroName: wslHome.distroName,
    wslLinuxHomePath: wslHome.linuxHomePath,
  };
}

export function resolveCodexRuntimeSelection(
  runtimes: CodexRuntimeEnvironment[],
): CodexResolvedRuntimeSelection {
  const availableRuntimeIds = runtimes
    .filter((runtime) => runtime.installation.available)
    .map((runtime) => runtime.id);
  const detectedRuntimeId = getActiveVsCodeWindowRuntimeId();

  if (availableRuntimeIds.length === 0) {
    return {
      runtimes,
      activeRuntimeId: null,
      requiresRuntimeSelection: false,
    };
  }

  if (detectedRuntimeId && availableRuntimeIds.includes(detectedRuntimeId)) {
    return {
      runtimes,
      activeRuntimeId: detectedRuntimeId,
      requiresRuntimeSelection: false,
    };
  }

  return {
    runtimes,
    activeRuntimeId:
      (availableRuntimeIds.includes('windows-local') ? 'windows-local' : null) ??
      availableRuntimeIds[0] ??
      null,
    requiresRuntimeSelection: false,
  };
}

export function getPrimaryCodexRuntime(
  selection: CodexResolvedRuntimeSelection,
): CodexRuntimeEnvironment | null {
  const windowsRuntime = getRuntimeById(selection, 'windows-local');
  if (windowsRuntime?.installation.available) {
    return windowsRuntime;
  }

  const activeRuntime = getRuntimeById(selection, selection.activeRuntimeId);
  if (activeRuntime?.installation.available) {
    return activeRuntime;
  }

  return selection.runtimes.find((runtime) => runtime.installation.available) ?? null;
}

export function getCompanionCodexRuntimes(
  selection: CodexResolvedRuntimeSelection,
  primaryRuntime: CodexRuntimeEnvironment | null,
): CodexRuntimeEnvironment[] {
  if (!primaryRuntime) {
    return [];
  }

  return selection.runtimes.filter(
    (runtime) => runtime.installation.available && runtime.id !== primaryRuntime.id,
  );
}

export function getRuntimeById(
  selection: CodexResolvedRuntimeSelection,
  runtimeId: CodexRuntimeId | null,
): CodexRuntimeEnvironment | null {
  if (!runtimeId) {
    return null;
  }

  return selection.runtimes.find((runtime) => runtime.id === runtimeId) ?? null;
}

export function createRuntimeSelection(): CodexResolvedRuntimeSelection {
  const runtimes = [createWindowsLocalRuntimeEnvironment()];
  const wslRuntime = createWslRemoteRuntimeEnvironment();
  if (wslRuntime) {
    runtimes.push(wslRuntime);
  }

  return resolveCodexRuntimeSelection(runtimes);
}

export function isWindowsWslRemoteRuntime(runtime: CodexRuntimeEnvironment): boolean {
  return (
    runtime.id === 'wsl-remote' &&
    process.platform === 'win32' &&
    Boolean(runtime.wslDistroName && runtime.wslLinuxHomePath)
  );
}

function normalizeExecOutput(output: Buffer | string): string {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  return text.split('\0').join('').trim();
}

export function runWslShellCommand(distroName: string, command: string): string {
  const output = execFileSync(
    getWslExecutableCommand(),
    ['-d', distroName, 'sh', '-lc', command],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return normalizeExecOutput(output);
}

export function resetWslRemoteVsCodeProcesses(runtime: CodexRuntimeEnvironment): void {
  if (!isWindowsWslRemoteRuntime(runtime) || !runtime.wslDistroName) {
    return;
  }

  try {
    runWslShellCommand(
      runtime.wslDistroName,
      [
        "pkill -f 'openai.chatgpt-.*/bin/linux-x86_64/codex app-server' >/dev/null 2>&1 || true",
        "pkill -f '\\.vscode-server/.*/out/bootstrap-fork --type=extensionHost' >/dev/null 2>&1 || true",
      ].join('; '),
    );
  } catch (error) {
    logger.warn(`Failed to reset WSL remote VS Code processes for ${runtime.wslDistroName}`, error);
  }
}
