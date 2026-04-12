import { app, dialog, type OpenDialogOptions } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { ConfigManager } from '../config/manager';
import { getAccountsFilePath, getBackupsDir, getAgentDir } from '../../utils/paths';
import { Account, AccountBackupData, AccountBackupDataSchema } from '../../types/account';
import { CloudAccount } from '../../types/cloudAccount';
import { CodexAccountStore } from '../../managedIde/codexAccountStore';
import { getCodexRecordIdentityKey } from '../../managedIde/codexIdentity';
import { CloudAccountRepo } from '../database/cloudHandler';
import { ActivityLogService } from '../../services/ActivityLogService';
import { ManagedIdeService } from '../../managedIde/service';
import {
  ActivityEventCategory,
  ApplyronPortableExportPayload,
  FilePickerResult,
  ImportApplyResult,
  ImportPreviewSummary,
} from '../../types/operations';
import {
  createPortableExportEnvelope,
  readPortableExportEnvelope,
} from '../../utils/portableBundle';
import { ipcContext } from '../context';
import { logger } from '../../utils/logger';

type ImportPreviewCacheEntry = {
  payload: ApplyronPortableExportPayload;
  filePath: string;
  summary: ImportPreviewSummary;
};

type CodexIdentityComparable = {
  accountId: string;
  email: string | null;
  workspace?: { id: string } | null;
};

type PortableCodexRecord = ApplyronPortableExportPayload['codex'][number];

const importPreviewCache = new Map<string, ImportPreviewCacheEntry>();
const PORTABLE_EXPORT_EXTENSION = 'applyron-export';
const CODEX_IMPORT_MULTIPLE_ACTIVE_WARNING = 'CODEX_IMPORT_MULTIPLE_ACTIVE_IMPORTED_ACCOUNTS';

function getWorkspaceAgnosticCodexEmailKey(account: {
  email: string | null;
  workspace?: { id: string } | null;
}): string | null {
  const normalizedEmail = account.email?.trim().toLowerCase();
  if (!normalizedEmail || account.workspace?.id) {
    return null;
  }

  return normalizedEmail;
}

function findMatchingCodexAccount<T extends CodexIdentityComparable>(
  existingByIdentityKey: Map<string, T>,
  existingWorkspacelessByEmail: Map<string, T>,
  record: CodexIdentityComparable,
): T | undefined {
  return (
    existingByIdentityKey.get(getCodexRecordIdentityKey(record)) ??
    (getWorkspaceAgnosticCodexEmailKey(record)
      ? existingWorkspacelessByEmail.get(getWorkspaceAgnosticCodexEmailKey(record) as string)
      : undefined)
  );
}

function getPortableCodexRecordFreshness(record: PortableCodexRecord): number {
  return (
    record.snapshot?.lastUpdatedAt ??
    record.record.snapshot?.lastUpdatedAt ??
    record.record.lastRefreshedAt ??
    record.record.updatedAt ??
    record.record.createdAt ??
    0
  );
}

function selectPortableImportActiveCodexRecord(payload: ApplyronPortableExportPayload): {
  selected: PortableCodexRecord | null;
  warnings: string[];
} {
  const activeRecords = payload.codex
    .filter((record) => record.record.isActive)
    .sort(
      (left, right) =>
        getPortableCodexRecordFreshness(right) - getPortableCodexRecordFreshness(left),
    );

  if (activeRecords.length === 0) {
    return {
      selected: null,
      warnings: [],
    };
  }

  return {
    selected: activeRecords[0] ?? null,
    warnings: activeRecords.length > 1 ? [CODEX_IMPORT_MULTIPLE_ACTIVE_WARNING] : [],
  };
}

function getDialogParentWindow() {
  return ipcContext.mainWindow;
}

function getSuggestedExportFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `applyron-export-${timestamp}.${PORTABLE_EXPORT_EXTENSION}`;
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    logger.warn(`Failed to read JSON file at ${filePath}`, error);
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function sanitizeLegacyAccount(account: Account): Account {
  const { backup_file: _ignoredBackupFile, ...rest } = account;
  void _ignoredBackupFile;
  return rest;
}

function readLegacyPortableAccounts(): Array<{
  account: Account;
  backup: AccountBackupData;
}> {
  const accountsIndex = readJsonFile<Record<string, Account>>(getAccountsFilePath(), {});

  return Object.values(accountsIndex).flatMap((account) => {
    const backupPath = account.backup_file || path.join(getBackupsDir(), `${account.id}.json`);
    if (!fs.existsSync(backupPath)) {
      return [];
    }

    try {
      const backup = AccountBackupDataSchema.parse(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
      return [
        {
          account: sanitizeLegacyAccount(account),
          backup: {
            ...backup,
            account: sanitizeLegacyAccount(backup.account),
          },
        },
      ];
    } catch (error) {
      logger.warn(`Skipping unreadable legacy backup for ${account.email}`, error);
      return [];
    }
  });
}

async function readCodexPortableAccounts() {
  const records = await CodexAccountStore.listAccounts();
  return Promise.all(
    records.map(async (record) => ({
      record,
      snapshot: record.snapshot,
      authFile: await CodexAccountStore.readAuthFile(record.id, {
        suppressExpectedSecurityLogs: true,
      }),
    })),
  );
}

async function collectPortableExportPayload(): Promise<ApplyronPortableExportPayload> {
  return {
    version: 'ApplyronPortableExportV1',
    exportedAt: Date.now(),
    appVersion: app.getVersion(),
    legacy: readLegacyPortableAccounts(),
    cloud: await CloudAccountRepo.getAccounts(),
    codex: await readCodexPortableAccounts(),
  };
}

function normalizeLegacyAccountRecord(
  imported: { account: Account; backup: AccountBackupData },
  existing: Account | undefined,
): {
  account: Account;
  backup: AccountBackupData;
} {
  const accountId = existing?.id ?? imported.account.id ?? randomUUID();
  const backupFile = existing?.backup_file || path.join(getBackupsDir(), `${accountId}.json`);
  const normalizedAccount: Account = {
    ...existing,
    ...imported.account,
    id: accountId,
    backup_file: backupFile,
    created_at: existing?.created_at ?? imported.account.created_at,
    last_used:
      existing?.last_used && existing.last_used > imported.account.last_used
        ? existing.last_used
        : imported.account.last_used,
  };

  return {
    account: normalizedAccount,
    backup: {
      ...imported.backup,
      account: sanitizeLegacyAccount(normalizedAccount),
    },
  };
}

function getManagerStorageBackupRoot(): string {
  return path.join(os.tmpdir(), 'applyron-manager-import-backups');
}

function createManagerStorageBackup(): string {
  const sourceDir = getAgentDir();
  const backupDir = path.join(getManagerStorageBackupRoot(), randomUUID());
  fs.mkdirSync(path.dirname(backupDir), { recursive: true });

  if (fs.existsSync(sourceDir)) {
    fs.cpSync(sourceDir, backupDir, { recursive: true, force: true });
  } else {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return backupDir;
}

function restoreManagerStorageBackup(backupDir: string): void {
  const targetDir = getAgentDir();
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(backupDir, targetDir, { recursive: true, force: true });
}

function cleanupManagerStorageBackup(backupDir: string): void {
  fs.rmSync(backupDir, { recursive: true, force: true });
}

async function buildImportPreviewSummary(
  previewId: string,
  payload: ApplyronPortableExportPayload,
  filePath: string,
): Promise<ImportPreviewSummary> {
  const existingLegacy = readJsonFile<Record<string, Account>>(getAccountsFilePath(), {});
  const existingCloud = await CloudAccountRepo.getAccounts();
  const existingCodex = await CodexAccountStore.listAccounts();
  const existingCloudByKey = new Map(
    existingCloud.map((account) => [`${account.provider}:${account.email.toLowerCase()}`, account]),
  );
  const existingCodexByIdentityKey = new Map(
    existingCodex.map((account) => [getCodexRecordIdentityKey(account), account]),
  );
  const existingCodexWorkspacelessByEmail = new Map(
    existingCodex
      .map((account) => [getWorkspaceAgnosticCodexEmailKey(account), account] as const)
      .filter((entry): entry is [string, (typeof existingCodex)[number]] => entry[0] !== null),
  );

  const legacyMatches = payload.legacy.filter(({ account }) =>
    Object.values(existingLegacy).some((existing) => existing.email === account.email),
  );
  const cloudMatches = payload.cloud.filter((account) =>
    existingCloudByKey.has(`${account.provider}:${account.email.toLowerCase()}`),
  );
  const codexMatches = payload.codex.filter(
    ({ record }) =>
      findMatchingCodexAccount(
        existingCodexByIdentityKey,
        existingCodexWorkspacelessByEmail,
        record,
      ) !== undefined,
  );

  return {
    previewId,
    filePath,
    fileName: path.basename(filePath),
    version: payload.version,
    exportedAt: payload.exportedAt,
    appVersion: payload.appVersion,
    counts: {
      legacy: payload.legacy.length,
      cloud: payload.cloud.length,
      codex: payload.codex.length,
    },
    dedupe: {
      legacyMatches: legacyMatches.length,
      cloudMatches: cloudMatches.length,
      codexMatches: codexMatches.length,
    },
    applyPlan: {
      legacyCreate: payload.legacy.length - legacyMatches.length,
      legacyUpdate: legacyMatches.length,
      cloudCreate: payload.cloud.length - cloudMatches.length,
      cloudUpdate: cloudMatches.length,
      codexCreate: payload.codex.length - codexMatches.length,
      codexUpdate: codexMatches.length,
    },
  };
}

async function applyPortableImportPayload(
  payload: ApplyronPortableExportPayload,
): Promise<ImportApplyResult> {
  const existingLegacy = readJsonFile<Record<string, Account>>(getAccountsFilePath(), {});
  const existingCloud = await CloudAccountRepo.getAccounts();
  const existingCodex = await CodexAccountStore.listAccounts();
  const existingCloudByKey = new Map(
    existingCloud.map((account) => [`${account.provider}:${account.email.toLowerCase()}`, account]),
  );
  const existingCodexByIdentityKey = new Map(
    existingCodex.map((account) => [getCodexRecordIdentityKey(account), account]),
  );
  const existingCodexWorkspacelessByEmail = new Map(
    existingCodex
      .map((account) => [getWorkspaceAgnosticCodexEmailKey(account), account] as const)
      .filter((entry): entry is [string, (typeof existingCodex)[number]] => entry[0] !== null),
  );
  const codexRestoreSelection = selectPortableImportActiveCodexRecord(payload);

  const result: ImportApplyResult = {
    imported: {
      legacyCreated: 0,
      legacyUpdated: 0,
      cloudCreated: 0,
      cloudUpdated: 0,
      codexCreated: 0,
      codexUpdated: 0,
    },
    codexRestore: {
      restoredAccountId: null,
      appliedRuntimeId: null,
      didRestartIde: false,
      status: 'skipped_no_active_codex',
      warnings: [],
    },
  };

  const nextLegacyIndex = { ...existingLegacy };
  for (const importedLegacy of payload.legacy) {
    const existing = Object.values(nextLegacyIndex).find(
      (account) => account.email === importedLegacy.account.email,
    );
    const normalized = normalizeLegacyAccountRecord(importedLegacy, existing);
    nextLegacyIndex[normalized.account.id] = normalized.account;
    writeJsonFile(
      normalized.account.backup_file || path.join(getBackupsDir(), `${normalized.account.id}.json`),
      normalized.backup,
    );

    if (existing) {
      result.imported.legacyUpdated += 1;
    } else {
      result.imported.legacyCreated += 1;
    }
  }
  writeJsonFile(getAccountsFilePath(), nextLegacyIndex);

  for (const importedCloud of payload.cloud) {
    const key = `${importedCloud.provider}:${importedCloud.email.toLowerCase()}`;
    const existing = existingCloudByKey.get(key);
    const nextCloud: CloudAccount = {
      ...importedCloud,
      id: existing?.id ?? importedCloud.id,
      created_at: existing?.created_at ?? importedCloud.created_at,
      last_used: Math.max(importedCloud.last_used, existing?.last_used ?? 0),
      is_active: Boolean(existing?.is_active),
    };
    await CloudAccountRepo.addAccount(nextCloud);

    if (existing) {
      result.imported.cloudUpdated += 1;
    } else {
      result.imported.cloudCreated += 1;
    }
  }

  let restoredCodexAccountId: string | null = null;
  for (const importedCodex of payload.codex) {
    const existing = findMatchingCodexAccount(
      existingCodexByIdentityKey,
      existingCodexWorkspacelessByEmail,
      importedCodex.record,
    );

    const authFile =
      importedCodex.authFile ??
      (existing
        ? await CodexAccountStore.readAuthFile(existing.id, {
            suppressExpectedSecurityLogs: true,
          })
        : null);
    if (!authFile) {
      throw new Error(`IMPORT_CODEX_AUTH_MISSING|${importedCodex.record.accountId}`);
    }

    const savedRecord = await CodexAccountStore.upsertAccount({
      existingId: existing?.id ?? null,
      accountId: importedCodex.record.accountId,
      email: importedCodex.record.email ?? existing?.email ?? null,
      label: importedCodex.record.label ?? existing?.label ?? null,
      authMode: importedCodex.record.authMode ?? existing?.authMode ?? null,
      hydrationState: 'needs_import_restore',
      workspace: importedCodex.record.workspace ?? existing?.workspace ?? null,
      authFile,
      snapshot:
        importedCodex.snapshot ?? importedCodex.record.snapshot ?? existing?.snapshot ?? null,
      makeActive: false,
    });

    if (codexRestoreSelection.selected === importedCodex) {
      restoredCodexAccountId = savedRecord.id;
    }

    if (existing) {
      result.imported.codexUpdated += 1;
    } else {
      result.imported.codexCreated += 1;
    }
  }

  if (restoredCodexAccountId) {
    const codexRestore =
      await ManagedIdeService.restoreImportedCodexAccount(restoredCodexAccountId);
    result.codexRestore = {
      ...codexRestore,
      warnings: [...codexRestore.warnings, ...codexRestoreSelection.warnings],
    };
  }

  return result;
}

function updateDefaultExportDirectory(nextFilePath: string): Promise<void> {
  const config = ConfigManager.getCachedConfigOrLoad();
  return ConfigManager.saveConfig({
    ...config,
    default_export_path: path.dirname(nextFilePath),
  });
}

export async function pickExportBundlePath(input?: {
  defaultDirectory?: string | null;
}): Promise<FilePickerResult> {
  const options = {
    defaultPath: path.join(
      input?.defaultDirectory ||
        ConfigManager.getCachedConfigOrLoad().default_export_path ||
        getAgentDir(),
      getSuggestedExportFileName(),
    ),
    filters: [
      {
        name: 'Applyron Export',
        extensions: [PORTABLE_EXPORT_EXTENSION],
      },
    ],
  };
  const parentWindow = getDialogParentWindow();
  const result = parentWindow
    ? await dialog.showSaveDialog(parentWindow, options)
    : await dialog.showSaveDialog(options);

  return {
    canceled: result.canceled,
    filePath: result.filePath ?? null,
  };
}

export async function pickImportBundleFile(input?: {
  defaultDirectory?: string | null;
}): Promise<FilePickerResult> {
  const options: OpenDialogOptions = {
    defaultPath:
      input?.defaultDirectory ||
      ConfigManager.getCachedConfigOrLoad().default_export_path ||
      getAgentDir(),
    properties: ['openFile'],
    filters: [
      {
        name: 'Applyron Export',
        extensions: [PORTABLE_EXPORT_EXTENSION, 'json'],
      },
    ],
  };
  const parentWindow = getDialogParentWindow();
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  return {
    canceled: result.canceled,
    filePath: result.filePaths[0] ?? null,
  };
}

export async function listActivityEvents(input?: {
  limit?: number;
  offset?: number;
  categories?: ActivityEventCategory[];
}) {
  return ActivityLogService.list(input);
}

export async function exportBundle(input: { filePath: string; password: string }) {
  if (!input.password.trim()) {
    throw new Error('EXPORT_PASSWORD_REQUIRED');
  }

  try {
    const payload = await collectPortableExportPayload();
    const envelope = createPortableExportEnvelope({
      password: input.password,
      payload,
    });

    writeJsonFile(input.filePath, envelope);
    await updateDefaultExportDirectory(input.filePath);

    ActivityLogService.record({
      category: 'operations',
      action: 'export',
      target: path.basename(input.filePath),
      outcome: 'success',
      message: 'Portable export bundle created.',
      metadata: {
        filePath: input.filePath,
        counts: {
          legacy: payload.legacy.length,
          cloud: payload.cloud.length,
          codex: payload.codex.length,
        },
      },
    });

    return {
      filePath: input.filePath,
      counts: {
        legacy: payload.legacy.length,
        cloud: payload.cloud.length,
        codex: payload.codex.length,
      },
    };
  } catch (error) {
    ActivityLogService.record({
      category: 'operations',
      action: 'export',
      target: path.basename(input.filePath),
      outcome: 'failure',
      message: error instanceof Error ? error.message : 'Portable export failed.',
    });
    throw error;
  }
}

export async function importBundlePreview(input: {
  filePath: string;
  password: string;
}): Promise<ImportPreviewSummary> {
  if (!input.password.trim()) {
    throw new Error('IMPORT_PASSWORD_REQUIRED');
  }

  let payload: ApplyronPortableExportPayload;
  try {
    const envelope = readJsonFile<unknown>(input.filePath, null);
    payload = readPortableExportEnvelope({
      password: input.password,
      envelope,
    });
  } catch (error) {
    ActivityLogService.record({
      category: 'operations',
      action: 'import-preview',
      target: path.basename(input.filePath),
      outcome: 'failure',
      message: error instanceof Error ? error.message : 'Portable import preview failed.',
    });
    throw new Error('INVALID_IMPORT_PASSWORD_OR_FILE');
  }

  const previewId = randomUUID();
  const summary = await buildImportPreviewSummary(previewId, payload, input.filePath);
  importPreviewCache.set(previewId, {
    payload,
    filePath: input.filePath,
    summary,
  });
  return summary;
}

export async function importBundleApply(input: { previewId: string }): Promise<ImportApplyResult> {
  const cached = importPreviewCache.get(input.previewId);
  if (!cached) {
    throw new Error('IMPORT_PREVIEW_EXPIRED');
  }

  const backupDir = createManagerStorageBackup();

  try {
    CloudAccountRepo.shutdown();
    const result = await applyPortableImportPayload(cached.payload);
    await CloudAccountRepo.init();
    await updateDefaultExportDirectory(cached.filePath);
    ActivityLogService.record({
      category: 'operations',
      action: 'import',
      target: path.basename(cached.filePath),
      outcome: 'success',
      message: 'Portable import bundle applied.',
      metadata: {
        ...result.imported,
        codexRestore: result.codexRestore,
      },
    });
    importPreviewCache.delete(input.previewId);
    cleanupManagerStorageBackup(backupDir);
    return result;
  } catch (error) {
    logger.error('Portable import apply failed, restoring manager storage backup', error);
    CloudAccountRepo.shutdown();
    restoreManagerStorageBackup(backupDir);
    await CloudAccountRepo.init();
    ActivityLogService.record({
      category: 'operations',
      action: 'import',
      target: path.basename(cached.filePath),
      outcome: 'failure',
      message: error instanceof Error ? error.message : 'Portable import failed.',
    });
    cleanupManagerStorageBackup(backupDir);
    throw error;
  }
}
