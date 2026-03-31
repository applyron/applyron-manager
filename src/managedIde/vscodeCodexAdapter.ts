import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type {
  CodexAccountRecord,
  CodexAccountSnapshot,
  CodexAuthFile,
  ManagedIdeAdapter,
  ManagedIdeAvailabilityReason,
  ManagedIdeCurrentStatus,
  ManagedIdeInstallationStatus,
  ManagedIdeQuotaSnapshot,
  ManagedIdeQuotaWindow,
  ManagedIdeSessionSnapshot,
} from './types';
import { normalizeCodexAgentMode, normalizeCodexServiceTier } from './codexMetadata';
import { CloudAccountRepo, isCloudStorageUnavailableError } from '../ipc/database/cloudHandler';
import {
  closeManagedIde,
  isManagedIdeProcessRunning,
  startManagedIde,
} from '../ipc/process/handler';
import { getManagedIdeDbPaths, getManagedIdeExecutablePath } from '../utils/paths';
import { logger } from '../utils/logger';
import { CodexAppServerClient } from './codexAppServerClient';
import { ManagedIdeCurrentStatusSchema } from './schemas';
import { CodexAccountStore } from './codexAccountStore';
import {
  getCodexAuthFilePath,
  getCodexEmailHint,
  readCodexAuthFile,
  writeCodexAuthFile,
} from './codexAuth';
import { ensureFreshCodexLoginUrl } from './codexLoginUrl';
import { openExternalWithPolicy } from '../utils/externalNavigation';

const OPENAI_EXTENSION_ID = 'openai.chatgpt';
const CACHE_KEY = 'managedIde.status.vscode-codex';
const VSCODE_RELOAD_WINDOW_URI = 'vscode://command/workbench.action.reloadWindow';

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

function getStableVsCodeExtensionsRoot(): string {
  return path.join(os.homedir(), '.vscode', 'extensions');
}

function findOpenAiExtension(): {
  extensionPath: string | null;
  extensionVersion: string | null;
} {
  const extensionsRoot = getStableVsCodeExtensionsRoot();
  if (!fs.existsSync(extensionsRoot)) {
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

function getCodexCliPath(extensionPath: string | null): string | null {
  if (!extensionPath) {
    return null;
  }

  const codexCliPath = path.join(extensionPath, 'bin', 'windows-x86_64', 'codex.exe');
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

function readCodexGlobalStateHints(): CodexGlobalStateHints {
  const dbPath = findExistingPath(getManagedIdeDbPaths('vscode-codex'));
  if (!dbPath) {
    return {
      codexCloudAccess: null,
      defaultServiceTier: null,
      agentMode: null,
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
        codexCloudAccess: null,
        defaultServiceTier: null,
        agentMode: null,
      };
    }

    const parsed = JSON.parse(row.value) as {
      [key: string]: unknown;
      ['persisted-atom-state']?: Record<string, unknown>;
    };

    const atomState = getRecordCandidate(parsed['persisted-atom-state']);
    const rootState = parsed as Record<string, unknown>;

    return {
      codexCloudAccess:
        getStringCandidate(atomState, ['codexCloudAccess', 'codex-cloud-access']) ??
        getStringCandidate(rootState, ['codexCloudAccess', 'codex-cloud-access']),
      defaultServiceTier:
        getStringCandidate(atomState, ['default-service-tier', 'service-tier', 'serviceTier']) ??
        getStringCandidate(rootState, ['default-service-tier', 'service-tier', 'serviceTier']),
      agentMode:
        getStringCandidate(atomState, ['agent-mode', 'agentMode']) ??
        getStringCandidate(rootState, ['agent-mode', 'agentMode']),
    };
  } catch (error) {
    logger.warn('Failed to read VS Code Codex global state hints', error);
    return {
      codexCloudAccess: null,
      defaultServiceTier: null,
      agentMode: null,
    };
  }
}

function getInstallationStatusFromEnvironment(): ManagedIdeInstallationStatus {
  const idePath = getManagedIdeExecutablePath('vscode-codex') || null;
  const ideVersion = readVsCodeVersion(idePath);
  const { extensionPath, extensionVersion } = findOpenAiExtension();
  const codexCliPath = getCodexCliPath(extensionPath);

  let reason: ManagedIdeAvailabilityReason = 'ready';
  let available = true;

  if (process.platform !== 'win32') {
    reason = 'unsupported_platform';
    available = false;
  } else if (!idePath) {
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
    platformSupported: process.platform === 'win32',
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

function createUnavailableStatus(
  installation: ManagedIdeInstallationStatus,
  reason: ManagedIdeAvailabilityReason,
): ManagedIdeCurrentStatus {
  const lastUpdatedAt = Date.now();
  return {
    targetId: 'vscode-codex',
    installation,
    session: buildUnavailableSession(reason === 'not_signed_in' ? 'requires_login' : 'unavailable'),
    quota: null,
    quotaByLimitId: null,
    isProcessRunning: false,
    lastUpdatedAt,
    fromCache: false,
  };
}

function getPreferredCodexEmail(
  authFile: CodexAuthFile,
  fallbackEmail?: string | null,
): string | null {
  return getCodexEmailHint(authFile) ?? fallbackEmail ?? null;
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

async function withTemporaryCodexHome<T>(
  prefix: string,
  action: (codexHome: string) => Promise<T>,
): Promise<T> {
  const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await action(codexHome);
  } finally {
    await fsp.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function waitForAuthFile(codexHome: string, timeoutMs = 5000): Promise<CodexAuthFile | null> {
  const authPath = getCodexAuthFilePath(codexHome);
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
    return getInstallationStatusFromEnvironment();
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

  private async buildStatusFromAuthFile(
    installation: ManagedIdeInstallationStatus,
    authFile: CodexAuthFile | null,
    options?: { fromDefaultHome?: boolean },
  ): Promise<ManagedIdeCurrentStatus> {
    if (!installation.available || !installation.codexCliPath) {
      return createUnavailableStatus(installation, installation.reason);
    }

    const hints = readCodexGlobalStateHints();
    const lastUpdatedAt = Date.now();

    if (!authFile?.tokens?.account_id) {
      return {
        targetId: 'vscode-codex',
        installation,
        session: buildUnavailableSession('requires_login'),
        quota: null,
        quotaByLimitId: null,
        isProcessRunning: options?.fromDefaultHome
          ? await isManagedIdeProcessRunning('vscode-codex')
          : false,
        lastUpdatedAt,
        fromCache: false,
      };
    }

    try {
      const status = await withTemporaryCodexHome('applyron-codex-probe-', async (codexHome) => {
        writeCodexAuthFile(authFile, getCodexAuthFilePath(codexHome));

        const client = new CodexAppServerClient(installation.codexCliPath as string, {
          env: {
            CODEX_HOME: codexHome,
          },
        });
        const snapshot = await client.collectSnapshot();
        const rateLimits =
          normalizeQuotaSnapshot(snapshot.rateLimits?.rateLimits) ||
          normalizeQuotaSnapshot(snapshot.latestRateLimitsNotification?.rateLimits);

        const rateLimitsByLimitId = snapshot.rateLimits?.rateLimitsByLimitId
          ? Object.fromEntries(
              Object.entries(snapshot.rateLimits.rateLimitsByLimitId)
                .map(([limitId, limitSnapshot]) => [limitId, normalizeQuotaSnapshot(limitSnapshot)])
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

        return {
          targetId: 'vscode-codex',
          installation,
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
          isProcessRunning: options?.fromDefaultHome
            ? await isManagedIdeProcessRunning('vscode-codex')
            : false,
          lastUpdatedAt,
          fromCache: false,
        } satisfies ManagedIdeCurrentStatus;
      });

      return status;
    } catch (error) {
      logger.error('Failed to collect VS Code Codex status from app-server', error);
      return createUnavailableStatus(installation, 'app_server_unavailable');
    }
  }

  async getCurrentStatus(options?: { refresh?: boolean }): Promise<ManagedIdeCurrentStatus> {
    const installation = await this.getInstallationStatus();
    const cached = readCachedStatus();

    if (!installation.available) {
      return cached
        ? {
            ...cached,
            installation,
            isProcessRunning: await this.resolveProcessRunningState(
              options,
              cached.isProcessRunning,
            ),
            fromCache: true,
          }
        : createUnavailableStatus(installation, installation.reason);
    }

    const shouldProbeLive =
      options?.refresh === true || !cached || cached.session.state !== 'ready';

    if (!shouldProbeLive && cached) {
      return {
        ...cached,
        installation,
        isProcessRunning: await this.resolveProcessRunningState(options, cached.isProcessRunning),
        fromCache: true,
      };
    }

    const authFile = readCodexAuthFile();
    const status = await this.buildStatusFromAuthFile(installation, authFile, {
      fromDefaultHome: true,
    });

    if (status.session.state === 'ready') {
      writeCachedStatus(status);
      if (authFile?.tokens?.account_id) {
        await this.syncCurrentSessionIntoPool(status, authFile);
      }
      return status;
    }

    if (cached) {
      if (cached.session.state === 'ready' && authFile?.tokens?.account_id) {
        await this.ensureCurrentDefaultSessionStored(authFile, {
          preferredStatus: cached,
          makeActive: true,
        });
      }

      return {
        ...cached,
        installation,
        isProcessRunning: await this.resolveProcessRunningState(options, cached.isProcessRunning),
        fromCache: true,
      };
    }

    return status;
  }

  async listAccounts(): Promise<CodexAccountRecord[]> {
    try {
      return await CodexAccountStore.listAccounts();
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
    const installation = await this.getInstallationStatus();
    if (!installation.available) {
      throw new Error('CODEX_IDE_UNAVAILABLE');
    }

    const authFile = readCodexAuthFile();
    if (!authFile?.tokens?.account_id) {
      throw new Error('CODEX_CURRENT_SESSION_NOT_AVAILABLE');
    }

    const status = await this.getCurrentStatus({ refresh: true });
    try {
      return await CodexAccountStore.upsertAccount({
        email: getPreferredCodexEmail(authFile, status.session.email),
        accountId: authFile.tokens.account_id,
        authMode: status.session.authMode ?? authFile.auth_mode,
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

  async addAccount(): Promise<CodexAccountRecord> {
    const installation = await this.getInstallationStatus();
    if (!installation.available || !installation.codexCliPath) {
      throw new Error('CODEX_IDE_UNAVAILABLE');
    }

    const currentAuthFile = readCodexAuthFile();
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

    return withTemporaryCodexHome('applyron-codex-login-', async (codexHome) => {
      const client = new CodexAppServerClient(installation.codexCliPath as string, {
        env: {
          CODEX_HOME: codexHome,
        },
      });

      try {
        await client.loginWithChatGpt({
          openUrl: async (url) => {
            await openExternalWithPolicy({
              intent: 'codex_login',
              url: ensureFreshCodexLoginUrl(url),
            });
          },
        });
      } finally {
        await client.dispose();
      }

      const authFile = await waitForAuthFile(codexHome);
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const status = await this.buildStatusFromAuthFile(installation, authFile);
      const existingAccount = await CodexAccountStore.getByAccountId(authFile.tokens.account_id);
      if (existingAccount) {
        throw new Error(
          `CODEX_ACCOUNT_ALREADY_EXISTS|${getPreferredCodexEmail(authFile, status.session.email) ?? authFile.tokens.account_id}`,
        );
      }

      try {
        return await CodexAccountStore.upsertAccount({
          email: getPreferredCodexEmail(authFile, status.session.email),
          accountId: authFile.tokens.account_id,
          authMode: status.session.authMode ?? authFile.auth_mode,
          authFile,
          snapshot: toStoredSnapshot(status),
          makeActive: false,
        });
      } catch (error) {
        if (shouldRecoverFromCodexStoreError(error)) {
          throw new Error('CODEX_ACCOUNT_STORE_UNAVAILABLE');
        }

        throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_SAVE_FAILED');
      }
    });
  }

  async refreshAccount(
    accountId: string,
    options?: { suppressExpectedSecurityLogs?: boolean },
  ): Promise<CodexAccountRecord> {
    const installation = await this.getInstallationStatus();
    if (!installation.available) {
      throw new Error('CODEX_IDE_UNAVAILABLE');
    }

    try {
      const account = await CodexAccountStore.getAccount(accountId);
      if (!account) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      const authFile = await CodexAccountStore.readAuthFile(accountId, {
        suppressExpectedSecurityLogs: options?.suppressExpectedSecurityLogs,
      });
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const status = await this.buildStatusFromAuthFile(installation, authFile);
      await CodexAccountStore.updateSnapshot(accountId, toStoredSnapshot(status));
      await CodexAccountStore.updateMetadata(accountId, {
        email: getPreferredCodexEmail(authFile, status.session.email),
        authMode: status.session.authMode ?? authFile.auth_mode,
      });

      const refreshed = await CodexAccountStore.getAccount(accountId);
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

  async activateAccount(accountId: string): Promise<CodexAccountRecord> {
    try {
      const account = await CodexAccountStore.getAccount(accountId);
      if (!account) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }

      const authFile = await CodexAccountStore.readAuthFile(accountId);
      if (!authFile?.tokens?.account_id) {
        throw new Error('CODEX_AUTH_FILE_NOT_FOUND');
      }

      const wasRunning = await isManagedIdeProcessRunning('vscode-codex');
      writeCodexAuthFile(authFile);
      await CodexAccountStore.setActive(accountId);

      if (wasRunning) {
        const didReloadWindow = await reloadRunningVsCodeWindow();
        if (!didReloadWindow) {
          await closeManagedIde('vscode-codex', { includeProcessTree: false });
          await startManagedIde('vscode-codex', false);
        }
      }

      try {
        const refreshedStatus = await this.getCurrentStatus({ refresh: true });
        await CodexAccountStore.updateSnapshot(accountId, toStoredSnapshot(refreshedStatus));
        await CodexAccountStore.updateMetadata(accountId, {
          email: getPreferredCodexEmail(authFile, refreshedStatus.session.email),
          authMode: refreshedStatus.session.authMode ?? authFile.auth_mode,
        });
      } catch (error) {
        logger.warn('Failed to refresh active Codex account after activation', error);
      }

      const refreshed = await CodexAccountStore.getAccount(accountId);
      if (!refreshed) {
        throw new Error('CODEX_ACCOUNT_NOT_FOUND');
      }
      return refreshed;
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async deleteAccount(accountId: string): Promise<void> {
    try {
      await CodexAccountStore.removeAccount(accountId);
    } catch (error) {
      throw toCodexAccountStoreError(error, 'CODEX_ACCOUNT_POOL_UNAVAILABLE');
    }
  }

  async openIde(): Promise<void> {
    await startManagedIde('vscode-codex', false);
  }

  async openLoginGuidance(): Promise<void> {
    await this.openIde();
  }
}
