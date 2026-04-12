import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { CloudAccountRepo } from '../../ipc/database/cloudHandler';
import { logger } from '../../utils/logger';
import { isWsl } from '../../utils/paths';
import { getWslExecutableCommand, toAccessibleWslPath } from '../../utils/wslRuntime';
import { CodexAppServerClient } from '../codexAppServerClient';
import { normalizeCodexAgentMode, normalizeCodexServiceTier } from '../codexMetadata';
import { getCodexAuthFilePath, readCodexAuthFile, writeCodexAuthFile } from '../codexAuth';
import { ManagedIdeCurrentStatusSchema } from '../schemas';
import { CACHE_KEY } from './constants';
import { readCodexGlobalStateSnapshot } from './globalStateDb';
import { getFileUpdatedAt, isWindowsWslRemoteRuntime, runWslShellCommand } from './runtimeEnvironment';
import type { CodexGlobalStateSnapshot, CodexRuntimeEnvironment } from './types';
import type {
  CodexAuthFile,
  CodexPendingRuntimeApply,
  CodexRuntimeId,
  ManagedIdeCodexRuntimeStatus,
  ManagedIdeCurrentStatus,
  ManagedIdeInstallationStatus,
  ManagedIdeQuotaSnapshot,
  ManagedIdeQuotaWindow,
  ManagedIdeSessionSnapshot,
} from '../types';

export function buildUnavailableSession(
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

export function normalizeManagedIdeAuthMode(value: unknown): ManagedIdeSessionSnapshot['authMode'] {
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

export function normalizeQuotaSnapshot(value: unknown): ManagedIdeQuotaSnapshot | null {
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

export function createRuntimeStatusSnapshot(
  runtime: CodexRuntimeEnvironment,
  status: Omit<ManagedIdeCodexRuntimeStatus, 'id' | 'displayName'>,
): ManagedIdeCodexRuntimeStatus {
  return {
    id: runtime.id,
    displayName: runtime.displayName,
    ...status,
  };
}

export function createUnavailableRuntimeStatus(
  runtime: CodexRuntimeEnvironment,
  reason: ManagedIdeInstallationStatus['reason'],
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

export function getMergedInstallationStatus(
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

export function createCurrentStatusFromRuntimes(input: {
  runtimes: ManagedIdeCodexRuntimeStatus[];
  activeRuntimeId: CodexRuntimeId | null;
  requiresRuntimeSelection: boolean;
  hasRuntimeMismatch: boolean;
  pendingRuntimeApply: CodexPendingRuntimeApply | null;
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
    pendingRuntimeApply: input.pendingRuntimeApply,
    runtimes: input.runtimes,
  };
}

export function getRuntimeMismatch(
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

  const normalizeComparableEmail = (value: string | null | undefined): string | null => {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  };

  const hasComparableIdentity = (runtime: (typeof availableRuntimes)[number]): boolean =>
    Boolean(runtime.authFile?.tokens?.account_id) ||
    (runtime.status.session.state === 'ready' &&
      Boolean(normalizeComparableEmail(runtime.status.session.email)));

  const representsDifferentIdentity = (
    left: (typeof availableRuntimes)[number],
    right: (typeof availableRuntimes)[number],
  ): boolean => {
    const leftAccountId = left.authFile?.tokens?.account_id ?? null;
    const rightAccountId = right.authFile?.tokens?.account_id ?? null;
    if (leftAccountId && rightAccountId) {
      return (
        leftAccountId !== rightAccountId ||
        (left.authFile?.auth_mode ?? null) !== (right.authFile?.auth_mode ?? null)
      );
    }

    if (left.status.session.state !== 'ready' || right.status.session.state !== 'ready') {
      return false;
    }

    const leftEmail = normalizeComparableEmail(left.status.session.email);
    const rightEmail = normalizeComparableEmail(right.status.session.email);
    return Boolean(leftEmail && rightEmail && leftEmail !== rightEmail);
  };

  const comparableRuntimes = availableRuntimes.filter(hasComparableIdentity);
  if (comparableRuntimes.length < 2) {
    return false;
  }

  const [baselineRuntime, ...otherRuntimes] = comparableRuntimes;
  return otherRuntimes.some((runtime) => representsDifferentIdentity(baselineRuntime, runtime));
}

export function readCachedStatus(): ManagedIdeCurrentStatus | null {
  const cached = CloudAccountRepo.getSetting<unknown>(CACHE_KEY, null);
  const parsed = ManagedIdeCurrentStatusSchema.safeParse(cached);
  return parsed.success ? { ...parsed.data, fromCache: true } : null;
}

export function writeCachedStatus(status: ManagedIdeCurrentStatus): void {
  try {
    CloudAccountRepo.setSetting(CACHE_KEY, {
      ...status,
      fromCache: false,
    });
  } catch (error) {
    logger.warn('Failed to cache VS Code Codex status snapshot', error);
  }
}

export function createCodexClient(
  runtime: CodexRuntimeEnvironment,
  runtimeCodexHomePath: string,
): CodexAppServerClient {
  if (runtime.id === 'wsl-remote' && process.platform === 'win32' && runtime.wslDistroName) {
    return new CodexAppServerClient(runtime.codexCliExecutionPath as string, {
      spawnCommand: getWslExecutableCommand(),
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

export async function withTemporaryCodexHome<T>(
  runtime: CodexRuntimeEnvironment,
  prefix: string,
  action: (codexHomePaths: { hostPath: string; runtimePath: string }) => Promise<T>,
): Promise<T> {
  if (isWindowsWslRemoteRuntime(runtime) && runtime.wslDistroName && runtime.wslLinuxHomePath) {
    const runtimeBasePath = path.posix.join(
      runtime.wslLinuxHomePath,
      '.applyron-manager',
      'tmp',
    );
    const runtimePath = runWslShellCommand(
      runtime.wslDistroName,
      `mkdir -p ${JSON.stringify(runtimeBasePath)} && mktemp -d -p ${JSON.stringify(
        runtimeBasePath,
      )} ${JSON.stringify(`${prefix}XXXXXX`)}`,
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

export async function waitForAuthFile(
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

export async function buildRuntimeStatusFromAuthFile(input: {
  runtime: CodexRuntimeEnvironment;
  authFile: CodexAuthFile | null;
  hints?: CodexGlobalStateSnapshot;
  getPreferredCodexEmail: (authFile: CodexAuthFile, fallbackEmail?: string | null) => string | null;
}): Promise<ManagedIdeCodexRuntimeStatus> {
  const { runtime, authFile } = input;
  if (!runtime.installation.available || !runtime.codexCliExecutionPath) {
    return createUnavailableRuntimeStatus(runtime, runtime.installation.reason);
  }

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

  const globalStateHints =
    input.hints ??
    readCodexGlobalStateSnapshot(
      runtime.stateDbPath && fs.existsSync(runtime.stateDbPath) ? runtime.stateDbPath : null,
    );

  try {
    return await withTemporaryCodexHome(
      runtime,
      'applyron-codex-probe-',
      async (codexHome) => {
        writeCodexAuthFile(authFile, getCodexAuthFilePath(codexHome.hostPath));

        const client = createCodexClient(runtime, codexHome.runtimePath);
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
          (globalStateHints.codexCloudAccess === 'enabled_needs_setup' ? 'unknown' : null);

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
            email: input.getPreferredCodexEmail(authFile, account?.email),
            planType,
            requiresOpenaiAuth:
              snapshot.account?.requiresOpenaiAuth ??
              snapshot.authStatus?.requiresOpenaiAuth ??
              !account,
            serviceTier: normalizeCodexServiceTier(
              snapshot.config?.config?.service_tier ?? globalStateHints.defaultServiceTier,
            ),
            agentMode: normalizeCodexAgentMode(globalStateHints.agentMode),
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
          extensionStateUpdatedAt: globalStateHints.updatedAt ?? runtime.extensionStateUpdatedAt,
          lastUpdatedAt,
        });
      },
    );
  } catch (error) {
    logger.error(`Failed to collect ${runtime.displayName} Codex status from app-server`, error);
    return createUnavailableRuntimeStatus(runtime, 'app_server_unavailable');
  }
}
