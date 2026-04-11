import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import type {
  CodexAccountRecord,
  CodexAccountSnapshot,
  CodexAuthFile,
  CodexImportRestoreResult,
  CodexRuntimeId,
  CodexRuntimeSyncResult,
  CodexWorkspaceSummary,
  ManagedIdeAdapter,
  ManagedIdeAvailabilityReason,
  ManagedIdeCodexRuntimeStatus,
  ManagedIdeCurrentStatus,
  ManagedIdeInstallationStatus,
  ManagedIdeQuotaSnapshot,
  ManagedIdeQuotaWindow,
  ManagedIdeSessionSnapshot,
} from './types';
import { normalizeCodexAgentMode, normalizeCodexServiceTier } from './codexMetadata';
import { CloudAccountRepo, isCloudStorageUnavailableError } from '../ipc/database/cloudHandler';
import { ConfigManager } from '../ipc/config/manager';
import {
  closeManagedIde,
  isManagedIdeProcessRunning,
  startManagedIde,
} from '../ipc/process/handler';
import {
  getManagedIdeDbPaths,
  getManagedIdeExecutablePath,
  getManagedIdeStoragePaths,
  isWsl,
} from '../utils/paths';
import { logger } from '../utils/logger';
import { CodexAppServerClient } from './codexAppServerClient';
import { ManagedIdeCurrentStatusSchema } from './schemas';
import { CodexAccountStore } from './codexAccountStore';
import {
  getCodexAuthFilePath,
  getCodexEmailHint,
  getCodexWorkspaceFromAuthFile,
  readCodexAuthFile,
  removeCodexAuthFile,
  writeCodexAuthFile,
} from './codexAuth';
import {
  getCodexIdentityKey,
  getCodexWorkspaceLabel,
  isCodexPersonalWorkspace,
  isCodexTeamPlan,
} from './codexIdentity';
import { getCodexChromeWorkspaceLabel } from './codexChromeWorkspaceHints';
import { ensureFreshCodexLoginUrl } from './codexLoginUrl';
import { openExternalWithPolicy } from '../utils/externalNavigation';
import {
  getActiveVsCodeWindowRuntimeId,
  getActiveVsCodeWslAuthority,
  getKnownWslAuthorities,
  resolveWslRuntimeHome,
  toAccessibleWslPath,
} from '../utils/wslRuntime';
import { getWindowsUser } from '../utils/platformPaths';

const OPENAI_EXTENSION_ID = 'openai.chatgpt';
const CACHE_KEY = 'managedIde.status.vscode-codex';
const VSCODE_RELOAD_WINDOW_URI = 'vscode://command/workbench.action.reloadWindow';
const WINDOWS_LOCAL_RUNTIME_LABEL = 'Windows Local';
const WSL_REMOTE_RUNTIME_LABEL = 'WSL Remote';

interface CodexGlobalStateSnapshot extends CodexGlobalStateHints {
  rawValue: string | null;
  updatedAt: number | null;
}

interface CodexRuntimeEnvironment {
  id: CodexRuntimeId;
  displayName: string;
  installation: ManagedIdeInstallationStatus;
  authFilePath: string | null;
  stateDbPath: string | null;
  storagePath: string | null;
  authLastUpdatedAt: number | null;
  extensionStateUpdatedAt: number | null;
  codexCliExecutionPath: string | null;
  wslDistroName?: string | null;
}

interface CodexResolvedRuntimeSelection {
  runtimes: CodexRuntimeEnvironment[];
  activeRuntimeId: CodexRuntimeId | null;
  requiresRuntimeSelection: boolean;
}

type CodexLiveApplyResult = {
  runtimeId: CodexRuntimeId;
  didRestartIde: boolean;
};

interface CodexGlobalStateHints {
  codexCloudAccess: string | null;
  defaultServiceTier: string | null;
  agentMode: string | null;
}

function getStringCandidate(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getRecordCandidate(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

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

function buildUnavailableSession(
  state: ManagedIdeSessionSnapshot['state'],
  options?: Partial<ManagedIdeSessionSnapshot>,
): ManagedIdeSessionSnapshot {
  return {
    state,
    accountType: null,
    authMode: null,
    email: null,
    planType: null,
    requiresOpenaiAuth: state !== 'ready',
    serviceTier: null,
    agentMode: null,
    lastUpdatedAt: Date.now(),
    ...options,
  };
}

function normalizeManagedIdeAuthMode(value: unknown): ManagedIdeSessionSnapshot['authMode'] {
  if (value === 'chatgpt' || value === 'apikey' || value === 'chatgptAuthTokens') {
    return value;
  }

  if (value === 'apiKey') {
    return 'apikey';
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'chatgpt') {
      return 'chatgpt';
    }
    if (normalized === 'apikey' || normalized === 'api_key' || normalized === 'api-key') {
      return 'apikey';
    }
    if (
      normalized === 'chatgptauthtokens' ||
      normalized === 'chatgpt_auth_tokens' ||
      normalized === 'chatgpt-auth-tokens'
    ) {
      return 'chatgptAuthTokens';
    }
  }

  return null;
}

function normalizeEpochMillis(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function normalizeQuotaWindow(value: unknown): ManagedIdeQuotaWindow | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const window = value as {
    usedPercent?: number;
    resetsAt?: number | null;
    windowDurationMins?: number | null;
  };

  if (typeof window.usedPercent !== 'number') {
    return null;
  }

  return {
    usedPercent: window.usedPercent,
    resetsAt: normalizeEpochMillis(window.resetsAt),
    windowDurationMins:
      typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
  };
}

function normalizeQuotaSnapshot(value: unknown): ManagedIdeQuotaSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as {
    limitId?: string | null;
    limitName?: string | null;
    planType?: string | null;
    primary?: unknown;
    secondary?: unknown;
    credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null;
  };

  return {
    limitId: snapshot.limitId ?? null,
    limitName: snapshot.limitName ?? null,
    planType: snapshot.planType ?? null,
    primary: normalizeQuotaWindow(snapshot.primary),
    secondary: normalizeQuotaWindow(snapshot.secondary),
    credits: snapshot.credits
      ? {
          hasCredits: snapshot.credits.hasCredits,
          unlimited: snapshot.credits.unlimited,
          balance: snapshot.credits.balance ?? null,
        }
      : null,
  };
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

function getFileUpdatedAt(filePath: string | null): number | null {
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

function readCodexGlobalStateSnapshot(dbPath: string | null): CodexGlobalStateSnapshot {
  if (!dbPath) {
    return {
      rawValue: null,
      codexCloudAccess: null,
      defaultServiceTier: null,
      agentMode: null,
      updatedAt: null,
    };
  }

  try {
    const database = new Database(dbPath, { readonly: true });
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = 'openai.chatgpt'")
      .get() as { value?: string } | undefined;
    database.close();

    if (!row?.value) {
      return {
        rawValue: null,
        codexCloudAccess: null,
        defaultServiceTier: null,
        agentMode: null,
        updatedAt: getFileUpdatedAt(dbPath),
      };
    }

    const parsed = JSON.parse(row.value) as {
      [key: string]: unknown;
      ['persisted-atom-state']?: Record<string, unknown>;
    };

    const atomState = getRecordCandidate(parsed['persisted-atom-state']);
    const rootState = parsed as Record<string, unknown>;

    return {
      rawValue: row.value,
      codexCloudAccess:
        getStringCandidate(atomState, ['codexCloudAccess', 'codex-cloud-access']) ??
        getStringCandidate(rootState, ['codexCloudAccess', 'codex-cloud-access']),
      defaultServiceTier:
        getStringCandidate(atomState, ['default-service-tier', 'service-tier', 'serviceTier']) ??
        getStringCandidate(rootState, ['default-service-tier', 'service-tier', 'serviceTier']),
      agentMode:
        getStringCandidate(atomState, ['agent-mode', 'agentMode']) ??
        getStringCandidate(rootState, ['agent-mode', 'agentMode']),
      updatedAt: getFileUpdatedAt(dbPath),
    };
  } catch (error) {
    logger.warn('Failed to read VS Code Codex global state hints', error);
    return {
      rawValue: null,
      codexCloudAccess: null,
      defaultServiceTier: null,
      agentMode: null,
      updatedAt: getFileUpdatedAt(dbPath),
    };
  }
}

function writeCodexGlobalStateSnapshot(dbPath: string | null, rawValue: string): boolean {
  if (!dbPath) {
    return false;
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const database = new Database(dbPath);
    database
      .prepare(
        `CREATE TABLE IF NOT EXISTS ItemTable (
          key TEXT PRIMARY KEY,
          value BLOB
        )`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO ItemTable(key, value)
         VALUES('openai.chatgpt', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(rawValue);
    database.close();
    return true;
  } catch (error) {
    logger.warn('Failed to write VS Code Codex global state hints', error);
    return false;
  }
}

function getInstallationStatusFromEnvironment(input: {
  runtimeId: CodexRuntimeId;
  displayName: string;
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

function createRuntimeStatusSnapshot(
  runtime: CodexRuntimeEnvironment,
  status: Omit<ManagedIdeCodexRuntimeStatus, 'id' | 'displayName'>,
): ManagedIdeCodexRuntimeStatus {
  return {
    id: runtime.id,
    displayName: runtime.displayName,
    ...status,
  };
}

function createUnavailableRuntimeStatus(
  runtime: CodexRuntimeEnvironment,
  reason: ManagedIdeAvailabilityReason,
): ManagedIdeCodexRuntimeStatus {
  const lastUpdatedAt = Date.now();
  return createRuntimeStatusSnapshot(runtime, {
    installation: runtime.installation,
    session: buildUnavailableSession(reason === 'not_signed_in' ? 'requires_login' : 'unavailable'),
    quota: null,
    quotaByLimitId: null,
    authFilePath: runtime.authFilePath,
    stateDbPath: runtime.stateDbPath,
    storagePath: runtime.storagePath,
    authLastUpdatedAt: runtime.authLastUpdatedAt,
    extensionStateUpdatedAt: runtime.extensionStateUpdatedAt,
    lastUpdatedAt,
  });
}

function getPreferredTopLevelStatus(
  runtimes: ManagedIdeCodexRuntimeStatus[],
  activeRuntimeId: CodexRuntimeId | null,
): ManagedIdeCodexRuntimeStatus | null {
  const activeRuntime =
    (activeRuntimeId
      ? (runtimes.find((runtime) => runtime.id === activeRuntimeId) ?? null)
      : null) ??
    runtimes.find((runtime) => runtime.installation.available) ??
    runtimes[0] ??
    null;

  return activeRuntime;
}

function getMergedInstallationStatus(
  runtimes: ManagedIdeCodexRuntimeStatus[],
  activeRuntimeId: CodexRuntimeId | null,
): ManagedIdeInstallationStatus {
  const preferredRuntime = getPreferredTopLevelStatus(runtimes, activeRuntimeId);
  if (preferredRuntime) {
    return preferredRuntime.installation;
  }

  return {
    targetId: 'vscode-codex',
    platformSupported: process.platform === 'win32' || isWsl(),
    available: false,
    reason: 'unsupported_platform',
    idePath: null,
    ideVersion: null,
    extensionPath: null,
    extensionVersion: null,
    codexCliPath: null,
    extensionId: null,
  };
}

function createCurrentStatusFromRuntimes(input: {
  runtimes: ManagedIdeCodexRuntimeStatus[];
  activeRuntimeId: CodexRuntimeId | null;
  requiresRuntimeSelection: boolean;
  hasRuntimeMismatch: boolean;
  isProcessRunning: boolean;
  fromCache: boolean;
}): ManagedIdeCurrentStatus {
  const topLevelRuntime = getPreferredTopLevelStatus(input.runtimes, input.activeRuntimeId);
  const lastUpdatedAt = topLevelRuntime?.lastUpdatedAt ?? Date.now();

  return {
    targetId: 'vscode-codex',
    installation: getMergedInstallationStatus(input.runtimes, input.activeRuntimeId),
    session: topLevelRuntime?.session ?? buildUnavailableSession('unavailable'),
    quota: topLevelRuntime?.quota ?? null,
    quotaByLimitId: topLevelRuntime?.quotaByLimitId ?? null,
    isProcessRunning: input.isProcessRunning,
    lastUpdatedAt,
    fromCache: input.fromCache,
    activeRuntimeId: input.activeRuntimeId,
    requiresRuntimeSelection: input.requiresRuntimeSelection,
    hasRuntimeMismatch: input.hasRuntimeMismatch,
    runtimes: input.runtimes,
  };
}

function getRuntimeMismatch(
  runtimes: Array<{
    runtime: CodexRuntimeEnvironment;
    authFile: CodexAuthFile | null;
    hints: CodexGlobalStateSnapshot;
    status: ManagedIdeCodexRuntimeStatus;
  }>,
): boolean {
  const availableRuntimes = runtimes.filter((runtime) => runtime.runtime.installation.available);
  if (availableRuntimes.length < 2) {
    return false;
  }

  const [left, right] = availableRuntimes;
  return (
    (left.authFile?.tokens?.account_id ?? null) !== (right.authFile?.tokens?.account_id ?? null) ||
    (left.authFile?.auth_mode ?? null) !== (right.authFile?.auth_mode ?? null) ||
    left.status.session.email !== right.status.session.email ||
    left.status.session.state !== right.status.session.state ||
    left.hints.codexCloudAccess !== right.hints.codexCloudAccess ||
    left.hints.defaultServiceTier !== right.hints.defaultServiceTier ||
    left.hints.agentMode !== right.hints.agentMode
  );
}

function getWslRemoteAuthorityHint(): string | null {
  return getActiveVsCodeWslAuthority() ?? getKnownWslAuthorities()[0] ?? null;
}

function createWindowsLocalRuntimeEnvironment(): CodexRuntimeEnvironment {
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
      displayName: WINDOWS_LOCAL_RUNTIME_LABEL,
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
  };
}

function createWslRemoteRuntimeEnvironment(): CodexRuntimeEnvironment | null {
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
      displayName: WSL_REMOTE_RUNTIME_LABEL,
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
  };
}

function resolveCodexRuntimeSelection(
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

  if (availableRuntimeIds.length === 1) {
    return {
      runtimes,
      activeRuntimeId: availableRuntimeIds[0] ?? null,
      requiresRuntimeSelection: false,
    };
  }

  const override = ConfigManager.loadConfig().codex_runtime_override;
  if (override && availableRuntimeIds.includes(override)) {
    return {
      runtimes,
      activeRuntimeId: override,
      requiresRuntimeSelection: false,
    };
  }

  return {
    runtimes,
    activeRuntimeId: null,
    requiresRuntimeSelection: true,
  };
}

function readCachedStatus(): ManagedIdeCurrentStatus | null {
  const cached = CloudAccountRepo.getSetting<unknown>(CACHE_KEY, null);
  const parsed = ManagedIdeCurrentStatusSchema.safeParse(cached);
  return parsed.success ? { ...parsed.data, fromCache: true } : null;
}

function shouldRecoverFromCodexStoreError(error: unknown): boolean {
  if (isCloudStorageUnavailableError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('codex_accounts') ||
    error.message.includes('better-sqlite3') ||
    error.message.includes('keytar')
  );
}

function toCodexAccountStoreError(
  error: unknown,
  code:
    | 'CODEX_ACCOUNT_STORE_UNAVAILABLE'
    | 'CODEX_ACCOUNT_SAVE_FAILED'
    | 'CODEX_ACCOUNT_POOL_UNAVAILABLE',
): Error {
  if (
    error instanceof Error &&
    (error.message.startsWith('CODEX_') ||
      error.message.startsWith('ERR_') ||
      error.message === 'ACTIVE_CODEX_ACCOUNT_DELETE_BLOCKED')
  ) {
    return error;
  }

  return new Error(code);
}

function shouldSkipBackgroundAccountRefresh(account: CodexAccountRecord): boolean {
  return account.snapshot?.session.state === 'requires_login';
}

function shouldQuarantineAccountForRelogin(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('ERR_DATA_MIGRATION_FAILED') ||
      error.message === 'CODEX_AUTH_FILE_NOT_FOUND')
  );
}

function createReloginRequiredSnapshot(account: CodexAccountRecord): CodexAccountSnapshot {
  const lastUpdatedAt = Date.now();
  const previousSession = account.snapshot?.session;

  return {
    session: {
      state: 'requires_login',
      accountType: previousSession?.accountType ?? null,
      authMode: normalizeManagedIdeAuthMode(account.authMode) ?? previousSession?.authMode ?? null,
      email: account.email ?? previousSession?.email ?? null,
      planType: previousSession?.planType ?? null,
      requiresOpenaiAuth: true,
      serviceTier: previousSession?.serviceTier ?? null,
      agentMode: previousSession?.agentMode ?? null,
      lastUpdatedAt,
    },
    quota: null,
    quotaByLimitId: null,
    lastUpdatedAt,
  };
}

function writeCachedStatus(status: ManagedIdeCurrentStatus): void {
  try {
    CloudAccountRepo.setSetting(CACHE_KEY, {
      ...status,
      fromCache: false,
    });
  } catch (error) {
    logger.warn('Failed to cache VS Code Codex status snapshot', error);
  }
}

function getPreferredCodexEmail(
  authFile: CodexAuthFile,
  fallbackEmail?: string | null,
): string | null {
  return getCodexEmailHint(authFile) ?? fallbackEmail ?? null;
}

function getCodexDuplicateIdentityDetail(
  authFile: CodexAuthFile,
  fallbackEmail?: string | null,
  planType?: string | null,
  workspace?: CodexWorkspaceSummary | null,
): string {
  const email = getPreferredCodexEmail(authFile, fallbackEmail);
  const workspaceLabel = getCodexWorkspaceLabel(
    workspace ?? getResolvedCodexWorkspace(authFile, planType, fallbackEmail),
  );

  if (email && workspaceLabel) {
    return `${email} (${workspaceLabel})`;
  }

  return email ?? workspaceLabel ?? authFile.tokens?.account_id ?? 'unknown';
}

function getResolvedCodexWorkspace(
  authFile: CodexAuthFile,
  planType?: string | null,
  fallbackEmail?: string | null,
): CodexWorkspaceSummary | null {
  const derivedWorkspace = getCodexWorkspaceFromAuthFile(authFile, { planType });
  if (!isCodexTeamPlan(planType)) {
    return derivedWorkspace;
  }

  const workspaceHint = getCodexChromeWorkspaceLabel(
    authFile.tokens?.account_id,
    getPreferredCodexEmail(authFile, fallbackEmail),
  );
  if (!workspaceHint || isCodexPersonalWorkspace({ id: workspaceHint, title: workspaceHint })) {
    return derivedWorkspace;
  }

  if (!derivedWorkspace) {
    return {
      id: authFile.tokens?.account_id ?? workspaceHint,
      title: workspaceHint,
      role: null,
      isDefault: false,
    };
  }

  if (derivedWorkspace.title === workspaceHint) {
    return derivedWorkspace;
  }

  return {
    ...derivedWorkspace,
    title: workspaceHint,
  };
}

function getWorkspaceSummaryFromSelection(input: {
  id: string;
  label: string;
  derivedWorkspace?: CodexWorkspaceSummary | null;
}): CodexWorkspaceSummary {
  return {
    id: input.id,
    title: input.label,
    role: input.derivedWorkspace?.role ?? null,
    isDefault:
      input.derivedWorkspace?.isDefault ??
      isCodexPersonalWorkspace({
        id: input.id,
        title: input.label,
      }),
  };
}

function getPreferredPersistedWorkspace(input: {
  derivedWorkspace: CodexWorkspaceSummary | null;
  existingWorkspace?: CodexWorkspaceSummary | null;
  selectedWorkspace?: { id: string; label: string } | null;
}): CodexWorkspaceSummary | null {
  if (input.selectedWorkspace) {
    return getWorkspaceSummaryFromSelection({
      id: input.selectedWorkspace.id,
      label: input.selectedWorkspace.label,
      derivedWorkspace: input.derivedWorkspace,
    });
  }

  if (
    input.existingWorkspace &&
    !isCodexPersonalWorkspace(input.existingWorkspace) &&
    (!input.derivedWorkspace ||
      isCodexPersonalWorkspace(input.derivedWorkspace) ||
      !input.derivedWorkspace.title)
  ) {
    return input.existingWorkspace;
  }

  return input.derivedWorkspace ?? input.existingWorkspace ?? null;
}

function hasCodexWorkspaceChanged(
  currentWorkspace: CodexWorkspaceSummary | null,
  nextWorkspace: CodexWorkspaceSummary | null,
): boolean {
  if (!currentWorkspace && !nextWorkspace) {
    return false;
  }

  if (!currentWorkspace || !nextWorkspace) {
    return true;
  }

  return (
    currentWorkspace.id !== nextWorkspace.id ||
    currentWorkspace.title !== nextWorkspace.title ||
    currentWorkspace.role !== nextWorkspace.role ||
    currentWorkspace.isDefault !== nextWorkspace.isDefault
  );
}

function toStoredSnapshot(status: ManagedIdeCurrentStatus): CodexAccountSnapshot {
  return {
    session: status.session,
    quota: status.quota,
    quotaByLimitId: status.quotaByLimitId,
    lastUpdatedAt: status.lastUpdatedAt,
  };
}

function createStoredSnapshotFromAuthFile(
  authFile: CodexAuthFile,
  status?: ManagedIdeCurrentStatus | null,
): CodexAccountSnapshot {
  if (status?.session.state === 'ready') {
    return toStoredSnapshot(status);
  }

  const lastUpdatedAt = Date.now();

  return {
    session: {
      state: 'ready',
      accountType: 'chatgpt',
      authMode: normalizeManagedIdeAuthMode(authFile.auth_mode) ?? 'chatgpt',
      email: getPreferredCodexEmail(authFile, status?.session.email),
      planType: status?.session.planType ?? null,
      requiresOpenaiAuth: true,
      serviceTier: status?.session.serviceTier ?? null,
      agentMode: status?.session.agentMode ?? null,
      lastUpdatedAt,
    },
    quota: status?.quota ?? null,
    quotaByLimitId: status?.quotaByLimitId ?? null,
    lastUpdatedAt,
  };
}

function normalizeExecOutput(output: Buffer | string): string {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  return text.split('\0').join('').trim();
}

function runWslShellCommand(distroName: string, command: string): string {
  const output = execSync(
    `wsl.exe -d ${JSON.stringify(distroName)} sh -lc ${JSON.stringify(command)}`,
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return normalizeExecOutput(output);
}

async function withTemporaryCodexHome<T>(
  runtime: CodexRuntimeEnvironment,
  prefix: string,
  action: (codexHomePaths: { hostPath: string; runtimePath: string }) => Promise<T>,
): Promise<T> {
  if (runtime.id === 'wsl-remote' && process.platform === 'win32' && runtime.wslDistroName) {
    const runtimePath = runWslShellCommand(
      runtime.wslDistroName,
      `mktemp -d -p /tmp ${prefix}XXXXXX`,
    );
    const hostPath = toAccessibleWslPath(runtime.wslDistroName, runtimePath);
    try {
      return await action({ hostPath, runtimePath });
    } finally {
      try {
        runWslShellCommand(runtime.wslDistroName, `rm -rf ${JSON.stringify(runtimePath)}`);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }

  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await action({ hostPath: codexHome, runtimePath: codexHome });
  } finally {
    await fsp.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function waitForAuthFile(
  codexHomePath: string,
  timeoutMs = 5000,
): Promise<CodexAuthFile | null> {
  const authPath = getCodexAuthFilePath(codexHomePath);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const authFile = readCodexAuthFile(authPath);
    if (authFile) {
      return authFile;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

async function reloadRunningVsCodeWindow(): Promise<boolean> {
  try {
    await openExternalWithPolicy({ intent: 'vscode_command', url: VSCODE_RELOAD_WINDOW_URI });
    return true;
  } catch (error) {
    logger.warn('Failed to trigger VS Code window reload; falling back to restart', error);
    return false;
  }
}

export class VscodeCodexAdapter implements ManagedIdeAdapter {
  readonly targetId = 'vscode-codex' as const;

  private resolveRuntimeSelection(): CodexResolvedRuntimeSelection {
    const runtimes = [createWindowsLocalRuntimeEnvironment()];
    const wslRuntime = createWslRemoteRuntimeEnvironment();
    if (wslRuntime) {
      runtimes.push(wslRuntime);
    }

    return resolveCodexRuntimeSelection(runtimes);
  }

  private getRuntimeById(
    selection: CodexResolvedRuntimeSelection,
    runtimeId: CodexRuntimeId | null,
  ): CodexRuntimeEnvironment | null {
    if (!runtimeId) {
      return null;
    }

    return selection.runtimes.find((runtime) => runtime.id === runtimeId) ?? null;
  }

  private async resolveProcessRunningState(
    options?: { refresh?: boolean },
    cachedProcessState?: boolean,
  ): Promise<boolean> {
    if (options?.refresh === true) {
      return isManagedIdeProcessRunning('vscode-codex');
    }

    return cachedProcessState ?? false;
  }

  async getInstallationStatus(): Promise<ManagedIdeInstallationStatus> {
    const selection = this.resolveRuntimeSelection();
    return getMergedInstallationStatus(
      selection.runtimes.map((runtime) =>
        createUnavailableRuntimeStatus(runtime, runtime.installation.reason),
      ),
      selection.activeRuntimeId,
    );
  }

  private createCodexClient(
    runtime: CodexRuntimeEnvironment,
    runtimeCodexHomePath: string,
  ): CodexAppServerClient {
    if (runtime.id === 'wsl-remote' && process.platform === 'win32' && runtime.wslDistroName) {
      return new CodexAppServerClient(runtime.codexCliExecutionPath as string, {
        spawnCommand: 'wsl.exe',
        spawnArgs: [
          '-d',
          runtime.wslDistroName,
          '--exec',
          'env',
          `CODEX_HOME=${runtimeCodexHomePath}`,
          runtime.codexCliExecutionPath as string,
          'app-server',
        ],
      });
    }

    return new CodexAppServerClient(runtime.codexCliExecutionPath as string, {
      env: {
        CODEX_HOME: runtimeCodexHomePath,
      },
    });
  }

  private async syncCurrentSessionIntoPool(
    status: ManagedIdeCurrentStatus,
    authFile: CodexAuthFile,
  ): Promise<void> {
    if (status.session.state !== 'ready' || !authFile.tokens?.account_id) {
      return;
    }

    try {
      await CodexAccountStore.upsertAccount({
        email: getPreferredCodexEmail(authFile, status.session.email),
        accountId: authFile.tokens.account_id,
        authMode: status.session.authMode ?? authFile.auth_mode,
        hydrationState: 'live',
        workspace: getPreferredPersistedWorkspace({
          derivedWorkspace: getResolvedCodexWorkspace(
            authFile,
            status.session.planType,
            status.session.email,
          ),
        }),
        authFile,
        snapshot: toStoredSnapshot(status),
        makeActive: true,
      });
    } catch (error) {
      if (shouldRecoverFromCodexStoreError(error)) {
        logger.warn(
          'Codex account storage is unavailable during live session sync; continuing with live status only',
          error,
        );
        return;
      }

      throw error;
    }
  }

  private getActiveRuntimeOrThrow(
    selection = this.resolveRuntimeSelection(),
  ): CodexRuntimeEnvironment {
    if (selection.requiresRuntimeSelection || !selection.activeRuntimeId) {
      throw new Error('CODEX_RUNTIME_SELECTION_REQUIRED');
    }

    const runtime = this.getRuntimeById(selection, selection.activeRuntimeId);
    if (
      !runtime ||
      !runtime.installation.available ||
      !runtime.codexCliExecutionPath ||
      !runtime.authFilePath
    ) {
      throw new Error('CODEX_IDE_UNAVAILABLE');
    }

    return runtime;
  }

  private getImportRestoreTarget(selection = this.resolveRuntimeSelection()): {
    runtime: CodexRuntimeEnvironment | null;
    status: CodexImportRestoreResult['status'] | null;
  } {
    if (selection.requiresRuntimeSelection || !selection.activeRuntimeId) {
      return {
        runtime: null,
        status: 'stored_only_runtime_selection_required',
      };
    }

    const runtime = this.getRuntimeById(selection, selection.activeRuntimeId);
    if (!runtime || !runtime.installation.available || !runtime.authFilePath) {
      return {
        runtime: null,
        status: 'stored_only_runtime_unavailable',
      };
    }

    return {
      runtime,
      status: null,
    };
  }

  private restoreRuntimeAuthFile(
    runtime: CodexRuntimeEnvironment,
    previousAuthFile: CodexAuthFile | null,
  ): void {
    if (!runtime.authFilePath) {
      return;
    }

    if (previousAuthFile) {
      writeCodexAuthFile(previousAuthFile, runtime.authFilePath);
      return;
    }

    removeCodexAuthFile(runtime.authFilePath);
  }

  private async applyAccountToRuntime(input: {
    id: string;
    authFile: CodexAuthFile;
    runtime: CodexRuntimeEnvironment;
    forceFullRestart: boolean;
  }): Promise<CodexLiveApplyResult> {
    const previousAuthFile = input.runtime.authFilePath
      ? readCodexAuthFile(input.runtime.authFilePath)
      : null;

    writeCodexAuthFile(input.authFile, input.runtime.authFilePath as string);

    try {
      const wasRunning = await isManagedIdeProcessRunning('vscode-codex');
      let didRestartIde = false;

      if (wasRunning) {
        if (input.forceFullRestart) {
          await closeManagedIde('vscode-codex', { includeProcessTree: false });
          await startManagedIde('vscode-codex', false);
          didRestartIde = true;
        } else {
          const didReloadWindow = await reloadRunningVsCodeWindow();
          if (!didReloadWindow) {
            await closeManagedIde('vscode-codex', { includeProcessTree: false });
            await startManagedIde('vscode-codex', false);
            didRestartIde = true;
          }
        }
      }

      await CodexAccountStore.setActive(input.id);

      return {
        runtimeId: input.runtime.id,
        didRestartIde,
      };
    } catch (error) {
      try {
        this.restoreRuntimeAuthFile(input.runtime, previousAuthFile);
      } catch (restoreError) {
        logger.warn(
          'Failed to restore the previous Codex auth file after activation failure',
          restoreError,
        );
      }
      throw error;
    }
  }

  private async markAccountHydrationLive(id: string): Promise<void> {
    try {
      await CodexAccountStore.setHydrationState(id, 'live');
    } catch (error) {
      logger.warn(`Failed to mark Codex account ${id} as live after runtime apply`, error);
    }
  }

  private async ensureCurrentDefaultSessionStored(
    authFile: CodexAuthFile | null,
    options?: {
      preferredStatus?: ManagedIdeCurrentStatus | null;
      makeActive?: boolean;
    },
  ): Promise<void> {
    if (!authFile?.tokens?.account_id) {
      return;
    }

    const preferredStatus = options?.preferredStatus ?? null;
    const snapshot = createStoredSnapshotFromAuthFile(authFile, preferredStatus);

    try {
      await CodexAccountStore.upsertAccount({
        email: getPreferredCodexEmail(authFile, preferredStatus?.session.email),
        accountId: authFile.tokens.account_id,
        authMode: preferredStatus?.session.authMode ?? authFile.auth_mode,
        hydrationState: 'live',
        workspace: getPreferredPersistedWorkspace({
          derivedWorkspace: getResolvedCodexWorkspace(
            authFile,
            preferredStatus?.session.planType,
            preferredStatus?.session.email,
          ),
        }),
        authFile,
        snapshot,
        makeActive: options?.makeActive ?? true,
      });
    } catch (error) {
      if (shouldRecoverFromCodexStoreError(error)) {
        logger.warn(
          'Codex account storage is unavailable while ensuring the current default session is present in the pool',
          error,
        );
        return;
      }

      throw error;
    }
  }

  private async buildRuntimeStatusFromAuthFile(
    runtime: CodexRuntimeEnvironment,
    authFile: CodexAuthFile | null,
  ): Promise<ManagedIdeCodexRuntimeStatus> {
    if (!runtime.installation.available || !runtime.codexCliExecutionPath) {
      return createUnavailableRuntimeStatus(runtime, runtime.installation.reason);
    }

    const hints = readCodexGlobalStateSnapshot(
      runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
    );
    const lastUpdatedAt = Date.now();

    if (!authFile?.tokens?.account_id) {
      return createRuntimeStatusSnapshot(runtime, {
        installation: runtime.installation,
        session: buildUnavailableSession('requires_login'),
        quota: null,
        quotaByLimitId: null,
        authFilePath: runtime.authFilePath,
        stateDbPath: runtime.stateDbPath,
        storagePath: runtime.storagePath,
        authLastUpdatedAt: runtime.authLastUpdatedAt,
        extensionStateUpdatedAt: runtime.extensionStateUpdatedAt,
        lastUpdatedAt,
      });
    }

    try {
      const status = await withTemporaryCodexHome(
        runtime,
        'applyron-codex-probe-',
        async (codexHome) => {
          writeCodexAuthFile(authFile, getCodexAuthFilePath(codexHome.hostPath));

          const client = this.createCodexClient(runtime, codexHome.runtimePath);
          const snapshot = await client.collectSnapshot();
          const rateLimits =
            normalizeQuotaSnapshot(snapshot.rateLimits?.rateLimits) ||
            normalizeQuotaSnapshot(snapshot.latestRateLimitsNotification?.rateLimits);

          const rateLimitsByLimitId = snapshot.rateLimits?.rateLimitsByLimitId
            ? Object.fromEntries(
                Object.entries(snapshot.rateLimits.rateLimitsByLimitId)
                  .map(([limitId, limitSnapshot]) => [
                    limitId,
                    normalizeQuotaSnapshot(limitSnapshot),
                  ])
                  .filter((entry): entry is [string, ManagedIdeQuotaSnapshot] => entry[1] !== null),
              )
            : null;

          const account = snapshot.account?.account ?? null;
          const sessionState: ManagedIdeSessionSnapshot['state'] = account
            ? 'ready'
            : 'requires_login';
          const planType =
            account?.planType ??
            rateLimits?.planType ??
            snapshot.planTypeHint ??
            (hints.codexCloudAccess === 'enabled_needs_setup' ? 'unknown' : null);

          return createRuntimeStatusSnapshot(runtime, {
            installation: runtime.installation,
            session: {
              state: sessionState,
              accountType: account?.type ?? null,
              authMode:
                normalizeManagedIdeAuthMode(snapshot.authMode) ??
                normalizeManagedIdeAuthMode(snapshot.authStatus?.authMethod) ??
                (account?.type === 'chatgpt'
                  ? 'chatgpt'
                  : account?.type === 'apiKey'
                    ? 'apikey'
                    : normalizeManagedIdeAuthMode(authFile.auth_mode)),
              email: getPreferredCodexEmail(authFile, account?.email),
              planType,
              requiresOpenaiAuth:
                snapshot.account?.requiresOpenaiAuth ??
                snapshot.authStatus?.requiresOpenaiAuth ??
                !account,
              serviceTier: normalizeCodexServiceTier(
                snapshot.config?.config?.service_tier ?? hints.defaultServiceTier,
              ),
              agentMode: normalizeCodexAgentMode(hints.agentMode),
              lastUpdatedAt,
            },
            quota: rateLimits,
            quotaByLimitId:
              rateLimitsByLimitId && Object.keys(rateLimitsByLimitId).length > 0
                ? rateLimitsByLimitId
                : null,
            authFilePath: runtime.authFilePath,
            stateDbPath: runtime.stateDbPath,
            storagePath: runtime.storagePath,
            authLastUpdatedAt: runtime.authLastUpdatedAt,
            extensionStateUpdatedAt: hints.updatedAt ?? runtime.extensionStateUpdatedAt,
            lastUpdatedAt,
          });
        },
      );

      return status;
    } catch (error) {
      logger.error(`Failed to collect ${runtime.displayName} Codex status from app-server`, error);
      return createUnavailableRuntimeStatus(runtime, 'app_server_unavailable');
    }
  }

  async getCurrentStatus(options?: { refresh?: boolean }): Promise<ManagedIdeCurrentStatus> {
    const selection = this.resolveRuntimeSelection();
    const cached = readCachedStatus();
    const isProcessRunning = await this.resolveProcessRunningState(
      options,
      cached?.isProcessRunning,
    );

    const shouldProbeLive =
      options?.refresh === true ||
      !cached ||
      cached.session.state !== 'ready' ||
      cached.activeRuntimeId !== selection.activeRuntimeId ||
      cached.requiresRuntimeSelection !== selection.requiresRuntimeSelection ||
      cached.runtimes.length !== selection.runtimes.length;

    if (!shouldProbeLive && cached) {
      return {
        ...cached,
        isProcessRunning,
        fromCache: true,
      };
    }

    const runtimeResults = await Promise.all(
      selection.runtimes.map(async (runtime) => {
        const authFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
        const hints = readCodexGlobalStateSnapshot(
          runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
        );
        const status = await this.buildRuntimeStatusFromAuthFile(runtime, authFile);
        return { runtime, authFile, hints, status };
      }),
    );

    const status = createCurrentStatusFromRuntimes({
      runtimes: runtimeResults.map((result) => result.status),
      activeRuntimeId: selection.activeRuntimeId,
      requiresRuntimeSelection: selection.requiresRuntimeSelection,
      hasRuntimeMismatch: getRuntimeMismatch(runtimeResults),
      isProcessRunning,
      fromCache: false,
    });

    if (status.session.state === 'ready') {
      writeCachedStatus(status);
      const activeRuntimeResult = runtimeResults.find(
        (result) => result.runtime.id === status.activeRuntimeId,
      );
      if (activeRuntimeResult?.authFile?.tokens?.account_id) {
        await this.syncCurrentSessionIntoPool(status, activeRuntimeResult.authFile);
      }
      return status;
    }

    if (cached) {
      const activeRuntimeResult = runtimeResults.find(
        (result) => result.runtime.id === cached.activeRuntimeId,
      );
      if (cached.session.state === 'ready' && activeRuntimeResult?.authFile?.tokens?.account_id) {
        await this.ensureCurrentDefaultSessionStored(activeRuntimeResult.authFile, {
          preferredStatus: cached,
          makeActive: true,
        });
      }

      return {
        ...cached,
        installation: status.installation,
        isProcessRunning,
        activeRuntimeId: status.activeRuntimeId,
        requiresRuntimeSelection: status.requiresRuntimeSelection,
        hasRuntimeMismatch: status.hasRuntimeMismatch,
        runtimes: status.runtimes,
        fromCache: true,
      };
    }

    return status;
  }

  async listAccounts(): Promise<CodexAccountRecord[]> {
    try {
      const accounts = await CodexAccountStore.listAccounts();
      return await Promise.all(
        accounts.map(async (account) => {
          const planType = account.snapshot?.session.planType ?? null;
          if (
            !isCodexTeamPlan(planType) ||
            (account.workspace &&
              !isCodexPersonalWorkspace(account.workspace) &&
              account.workspace.title)
          ) {
            return account;
          }

          try {
            const authFile = await CodexAccountStore.readAuthFile(account.id, {
              suppressExpectedSecurityLogs: true,
            });
            if (!authFile?.tokens?.account_id) {
              return account;
            }

            const workspace = getPreferredPersistedWorkspace({
              derivedWorkspace: getResolvedCodexWorkspace(authFile, planType, account.email),
              existingWorkspace: account.workspace,
            });
            if (!hasCodexWorkspaceChanged(account.workspace, workspace)) {
              return account;
            }

            try {
              return await CodexAccountStore.upsertAccount({
                existingId: account.id,
                email: getPreferredCodexEmail(authFile, account.email),
                label: account.label,
                accountId: authFile.tokens.account_id,
                authMode: account.authMode ?? authFile.auth_mode,
                workspace,
                authFile,
                snapshot: account.snapshot,
                makeActive: account.isActive,
              });
            } catch (error) {
              logger.warn('Failed to persist reconciled Codex workspace metadata', error);
              return {
                ...account,
                email: getPreferredCodexEmail(authFile, account.email),
                authMode: account.authMode ?? authFile.auth_mode,
                workspace,
              };
            }
          } catch (error) {
            logger.warn('Failed to reconcile stored Codex workspace metadata', error);
            return account;
          }
        }),
      );
    } catch (error) {
      if (shouldRecoverFromCodexStoreError(error)) {
        logger.warn(
          'Codex account storage is unavailable while listing accounts; returning an empty pool',
          error,
        );
        return [];
      }
      throw error;
    }
  }

  async importCurrentSession(): Promise<CodexAccountRecord> {
    const runtime = this.getActiveRuntimeOrThrow();

    const authFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_CURRENT_SESSION_NOT_AVAILABLE');
    }

    const status = await this.getCurrentStatus({ refresh: true });
    try {
      return await CodexAccountStore.upsertAccount({
        email: getPreferredCodexEmail(authFile, status.session.email),
        accountId: authFile.tokens.account_id,
        authMode: status.session.authMode ?? authFile.auth_mode,
        hydrationState: 'live',
        workspace: getPreferredPersistedWorkspace({
          derivedWorkspace: getResolvedCodexWorkspace(
            authFile,
            status.session.planType,
            status.session.email,
          ),
        }),
        authFile,
        snapshot: toStoredSnapshot(status),
        makeActive: true,
      });
    } catch (error) {
      if (shouldRecoverFromCodexStoreError(error)) {
        throw new Error('CODEX_ACCOUNT_STORE_UNAVAILABLE');
      }

      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_SAVE_FAILED');
    }
  }

  async addAccount(): Promise<CodexAccountRecord[]> {
    const runtime = this.getActiveRuntimeOrThrow();

    const currentAuthFile = runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null;
    try {
      const currentStatus = await this.getCurrentStatus({ refresh: true });
      if (currentStatus.session.state !== 'ready') {
        await this.ensureCurrentDefaultSessionStored(currentAuthFile, {
          preferredStatus: currentStatus,
          makeActive: true,
        });
      }
    } catch (error) {
      logger.warn(
        'Failed to sync the current VS Code Codex session before adding a new account',
        error,
      );
      await this.ensureCurrentDefaultSessionStored(currentAuthFile, {
        preferredStatus: readCachedStatus(),
        makeActive: true,
      }).catch((fallbackError) => {
        logger.warn(
          'Failed to persist the current default Codex session from fallback data before adding a new account',
          fallbackError,
        );
      });
    }

    return withTemporaryCodexHome(runtime, 'applyron-codex-login-', async (codexHome) => {
      const client = this.createCodexClient(runtime, codexHome.runtimePath);

      try {
        await client.loginWithChatGpt({
          openUrl: async (url) => {
            await openExternalWithPolicy({
              intent: 'codex_login',
              url: ensureFreshCodexLoginUrl(url, {
                forceAccountSelection: false,
              }),
            });
          },
          timeoutMs: 180_000,
        });
      } finally {
        await client.dispose();
      }

      const authFile = await waitForAuthFile(codexHome.hostPath);
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const status = createCurrentStatusFromRuntimes({
        runtimes: [await this.buildRuntimeStatusFromAuthFile(runtime, authFile)],
        activeRuntimeId: runtime.id,
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        isProcessRunning: false,
        fromCache: false,
      });
      const workspace = getPreferredPersistedWorkspace({
        derivedWorkspace: getResolvedCodexWorkspace(
          authFile,
          status.session.planType,
          status.session.email,
        ),
      });
      const existingAccount = await CodexAccountStore.getByIdentityKey(
        getCodexIdentityKey({
          accountId: authFile.tokens.account_id,
          workspace,
        }),
      );
      if (existingAccount) {
        throw new Error(
          `CODEX_ACCOUNT_ALREADY_EXISTS|${getCodexDuplicateIdentityDetail(
            authFile,
            status.session.email,
            status.session.planType,
            workspace,
          )}`,
        );
      }

      try {
        const account = await CodexAccountStore.upsertAccount({
          email: getPreferredCodexEmail(authFile, status.session.email),
          accountId: authFile.tokens.account_id,
          authMode: status.session.authMode ?? authFile.auth_mode,
          workspace,
          authFile,
          snapshot: toStoredSnapshot(status),
          makeActive: false,
        });
        return [account];
      } catch (error) {
        if (shouldRecoverFromCodexStoreError(error)) {
          throw new Error('CODEX_ACCOUNT_STORE_UNAVAILABLE');
        }

        throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_SAVE_FAILED');
      }
    });
  }

  async refreshAccount(
    id: string,
    options?: { suppressExpectedSecurityLogs?: boolean },
  ): Promise<CodexAccountRecord> {
    const runtime = this.getActiveRuntimeOrThrow();

    try {
      const account = await CodexAccountStore.getAccount(id);
      if (!account) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      const authFile = await CodexAccountStore.readAuthFile(id, {
        suppressExpectedSecurityLogs: options?.suppressExpectedSecurityLogs,
      });
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const status = createCurrentStatusFromRuntimes({
        runtimes: [await this.buildRuntimeStatusFromAuthFile(runtime, authFile)],
        activeRuntimeId: runtime.id,
        requiresRuntimeSelection: false,
        hasRuntimeMismatch: false,
        isProcessRunning: false,
        fromCache: false,
      });
      await CodexAccountStore.upsertAccount({
        existingId: account.id,
        email: getPreferredCodexEmail(authFile, status.session.email),
        label: account.label,
        accountId: authFile.tokens.account_id,
        authMode: status.session.authMode ?? authFile.auth_mode,
        workspace: getPreferredPersistedWorkspace({
          derivedWorkspace: getResolvedCodexWorkspace(
            authFile,
            status.session.planType,
            status.session.email,
          ),
          existingWorkspace: account.workspace,
        }),
        authFile,
        snapshot: toStoredSnapshot(status),
        makeActive: account.isActive,
      });

      const refreshed = await CodexAccountStore.getAccount(account.id);
      if (!refreshed) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      return refreshed;
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async refreshAllAccounts(): Promise<CodexAccountRecord[]> {
    let accounts: CodexAccountRecord[];
    try {
      accounts = await CodexAccountStore.listAccounts();
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }

    for (const account of accounts) {
      if (shouldSkipBackgroundAccountRefresh(account)) {
        logger.debug(
          `Skipping background refresh for Codex account ${account.id} because it already requires re-login`,
        );
        continue;
      }

      try {
        await this.refreshAccount(account.id, {
          suppressExpectedSecurityLogs: true,
        });
      } catch (error) {
        if (shouldQuarantineAccountForRelogin(error)) {
          try {
            await CodexAccountStore.updateSnapshot(
              account.id,
              createReloginRequiredSnapshot(account),
            );
            logger.warn(
              `Codex account ${account.id} requires re-login; background refresh is suspended until the account is refreshed manually or re-imported`,
              error,
            );
          } catch (snapshotError) {
            logger.warn(
              `Failed to mark Codex account ${account.id} as requiring re-login after refresh failure`,
              snapshotError,
            );
          }
          continue;
        }

        logger.warn(`Failed to refresh Codex account ${account.id}`, error);
      }
    }
    try {
      return await CodexAccountStore.listAccounts();
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async activateAccount(id: string): Promise<CodexAccountRecord> {
    try {
      const account = await CodexAccountStore.getAccount(id);
      if (!account) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      const authFile = await CodexAccountStore.readAuthFile(id);
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const runtime = this.getActiveRuntimeOrThrow();
      const hydrationState = await CodexAccountStore.getHydrationState(id);
      const requiresImportRestore = hydrationState === 'needs_import_restore';

      await this.applyAccountToRuntime({
        id,
        authFile,
        runtime,
        forceFullRestart: requiresImportRestore,
      });
      await this.markAccountHydrationLive(id);

      try {
        const refreshedStatus = await this.getCurrentStatus({ refresh: true });
        await CodexAccountStore.upsertAccount({
          existingId: account.id,
          email: getPreferredCodexEmail(authFile, refreshedStatus.session.email),
          label: account.label,
          accountId: authFile.tokens.account_id,
          authMode: refreshedStatus.session.authMode ?? authFile.auth_mode,
          hydrationState: 'live',
          workspace: getPreferredPersistedWorkspace({
            derivedWorkspace: getResolvedCodexWorkspace(
              authFile,
              refreshedStatus.session.planType,
              refreshedStatus.session.email,
            ),
            existingWorkspace: account.workspace,
          }),
          authFile,
          snapshot: toStoredSnapshot(refreshedStatus),
          makeActive: true,
        });
      } catch (error) {
        logger.warn('Failed to refresh active Codex account after activation', error);
      }

      const refreshed = await CodexAccountStore.getAccount(id);
      if (!refreshed) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }
      return refreshed;
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async restoreImportedAccount(id: string | null): Promise<CodexImportRestoreResult> {
    if (!id) {
      return {
        restoredAccountId: null,
        appliedRuntimeId: null,
        didRestartIde: false,
        status: 'skipped_no_active_codex',
        warnings: [],
      };
    }

    try {
      if (!(await CodexAccountStore.getAccount(id))) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      const authFile = await CodexAccountStore.readAuthFile(id);
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const target = this.getImportRestoreTarget();
      if (!target.runtime || target.status) {
        await CodexAccountStore.setActive(id);
        return {
          restoredAccountId: id,
          appliedRuntimeId: null,
          didRestartIde: false,
          status: target.status ?? 'stored_only_runtime_unavailable',
          warnings: [],
        };
      }

      const applyResult = await this.applyAccountToRuntime({
        id,
        authFile,
        runtime: target.runtime,
        forceFullRestart: true,
      });
      await this.markAccountHydrationLive(id);

      return {
        restoredAccountId: id,
        appliedRuntimeId: applyResult.runtimeId,
        didRestartIde: applyResult.didRestartIde,
        status: 'applied',
        warnings: [],
      };
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async deleteAccount(id: string): Promise<void> {
    try {
      await CodexAccountStore.removeAccount(id);
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async syncRuntimeState(): Promise<CodexRuntimeSyncResult> {
    const selection = this.resolveRuntimeSelection();
    if (selection.requiresRuntimeSelection || selection.runtimes.length < 2) {
      throw new Error('CODEX_RUNTIME_SELECTION_REQUIRED');
    }

    const runtimePairs = selection.runtimes
      .filter((runtime) => runtime.installation.available)
      .map((runtime) => ({
        runtime,
        authFile: runtime.authFilePath ? readCodexAuthFile(runtime.authFilePath) : null,
        hints: readCodexGlobalStateSnapshot(
          runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
        ),
      }));

    if (runtimePairs.length < 2) {
      throw new Error('CODEX_RUNTIME_SYNC_UNAVAILABLE');
    }

    const getRefreshTimestamp = (authFile: CodexAuthFile | null): number | null => {
      const value = authFile?.last_refresh ? Date.parse(authFile.last_refresh) : Number.NaN;
      return Number.isFinite(value) ? value : null;
    };

    const [firstRuntime, secondRuntime] = runtimePairs;
    const firstAuthRefresh = getRefreshTimestamp(firstRuntime.authFile);
    const secondAuthRefresh = getRefreshTimestamp(secondRuntime.authFile);

    let source = firstRuntime;
    let target = secondRuntime;

    if (
      typeof firstAuthRefresh === 'number' &&
      typeof secondAuthRefresh === 'number' &&
      secondAuthRefresh > firstAuthRefresh
    ) {
      source = secondRuntime;
      target = firstRuntime;
    } else if (
      firstAuthRefresh === secondAuthRefresh ||
      firstAuthRefresh === null ||
      secondAuthRefresh === null
    ) {
      const firstStateUpdatedAt = firstRuntime.hints.updatedAt ?? 0;
      const secondStateUpdatedAt = secondRuntime.hints.updatedAt ?? 0;
      if (secondStateUpdatedAt > firstStateUpdatedAt) {
        source = secondRuntime;
        target = firstRuntime;
      } else if (
        secondStateUpdatedAt === firstStateUpdatedAt &&
        selection.activeRuntimeId === secondRuntime.runtime.id
      ) {
        source = secondRuntime;
        target = firstRuntime;
      }
    }

    const warnings: string[] = [];
    let syncedAuthFile = false;
    let syncedExtensionState = false;

    if (source.authFile && target.runtime.authFilePath) {
      try {
        writeCodexAuthFile(source.authFile, target.runtime.authFilePath);
        syncedAuthFile = true;
      } catch (error) {
        logger.warn('Failed to sync Codex auth file across runtimes', error);
        warnings.push('CODEX_RUNTIME_SYNC_AUTH_FAILED');
      }
    } else {
      warnings.push('CODEX_RUNTIME_SYNC_AUTH_SKIPPED');
    }

    if (source.hints.rawValue && target.runtime.stateDbPath) {
      syncedExtensionState = writeCodexGlobalStateSnapshot(
        target.runtime.stateDbPath,
        source.hints.rawValue,
      );
      if (!syncedExtensionState) {
        warnings.push('CODEX_RUNTIME_SYNC_STATE_FAILED');
      }
    } else {
      warnings.push('CODEX_RUNTIME_SYNC_STATE_SKIPPED');
    }

    return {
      sourceRuntimeId: source.runtime.id,
      targetRuntimeId: target.runtime.id,
      syncedAuthFile,
      syncedExtensionState,
      warnings,
    };
  }

  async openIde(): Promise<void> {
    await startManagedIde('vscode-codex', false);
  }

  async openLoginGuidance(): Promise<void> {
    await this.openIde();
  }
}
