import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getCloudAccountsDbPath, getAntigravityDbPaths } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { CloudAccount } from '../../types/cloudAccount';
import { type DeviceProfile, type DeviceProfileVersion } from '../../types/account';
import { ItemTableValueRowSchema, TableInfoRowSchema } from '../../types/db';
import { getCodexWorkspaceFromAuthFile } from '../../managedIde/codexAuth';
import { getCodexIdentityKey } from '../../managedIde/codexIdentity';
import { decrypt, decryptWithMigration, encrypt, type KeySource } from '../../utils/security';
import { ProtobufUtils } from '../../utils/protobuf';
import { GoogleAPIService } from '../../services/GoogleAPIService';
import { getAntigravityVersion, isNewVersion } from '../../utils/antigravityVersion';
import { parseRow, parseRows } from '../../utils/sqlite';
import { configureDatabase, openDrizzleConnection } from './dbConnection';
import { accounts, itemTable, settings } from './schema';
import * as drizzleSchema from './schema';

const SQLITE_BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);
const SQLITE_BUSY_TIMEOUT_MS = 3000;
const SQLITE_RETRY_DELAY_MS = 150;
const SQLITE_MAX_RETRIES = 3;
const DEVICE_PAYLOAD_SCHEMA_VERSION = 1;
const CLOUD_MIGRATION_BACKUP_SUFFIX = '.migration-backup';
let cloudStorageUnavailableWarningLogged = false;

function getPathModuleForFsPath(filePath: string): Pick<typeof path, 'dirname'> {
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.includes('\\') ? path.win32 : path.posix;
}

type DrizzleExecutor = Pick<
  BetterSQLite3Database<typeof drizzleSchema>,
  'insert' | 'update' | 'delete' | 'select'
>;

interface CloudDbOwnerConnection {
  raw: Database.Database;
  orm: BetterSQLite3Database<typeof drizzleSchema>;
}

interface CloudDbScopedConnection {
  orm: BetterSQLite3Database<typeof drizzleSchema>;
}

let cloudDbOwnerConnection: CloudDbOwnerConnection | null = null;

interface CloudSchemaMigration {
  version: number;
  name: string;
  apply: (db: Database.Database) => Promise<void> | void;
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { code?: string; message?: string };
  if (err.code && SQLITE_BUSY_CODES.has(err.code)) {
    return true;
  }
  if (typeof err.message === 'string') {
    return err.message.includes('SQLITE_BUSY') || err.message.includes('SQLITE_LOCKED');
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasNativeModuleFailureSignature(message: string): boolean {
  return (
    message.includes('better_sqlite3.node') ||
    message.includes('Cannot find module') ||
    message.includes("Cannot find package 'better-sqlite3'") ||
    message.includes("Cannot find module 'better-sqlite3'") ||
    message.includes("Cannot find module 'keytar'") ||
    message.includes('NODE_MODULE_VERSION') ||
    message.includes('compiled against a different Node.js version')
  );
}

function getAccountsTableInfo(db: Database.Database) {
  const tableInfoRaw = db.pragma('table_info(accounts)') as unknown[];
  return parseRows(TableInfoRowSchema, tableInfoRaw, 'cloud.accounts.tableInfo');
}

function getCodexAccountsTableInfo(db: Database.Database) {
  const tableInfoRaw = db.pragma('table_info(codex_accounts)') as unknown[];
  return parseRows(TableInfoRowSchema, tableInfoRaw, 'cloud.codexAccounts.tableInfo');
}

function ensureCloudSchemaMetadata(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function ensureAccountsColumn(db: Database.Database, columnName: string, alterSql: string): void {
  const tableInfo = getAccountsTableInfo(db);
  if (tableInfo.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(alterSql);
}

function ensureCodexAccountsColumn(
  db: Database.Database,
  columnName: string,
  alterSql: string,
): void {
  const tableInfo = getCodexAccountsTableInfo(db);
  if (tableInfo.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(alterSql);
}

async function migratePlaintextAccountPayloads(db: Database.Database): Promise<void> {
  const rows = db
    .prepare('SELECT id, token_json AS tokenJson, quota_json AS quotaJson FROM accounts')
    .all() as Array<{ id: string; tokenJson: string | null; quotaJson: string | null }>;

  const updateStatement = db.prepare(`
    UPDATE accounts
    SET token_json = @tokenJson, quota_json = @quotaJson
    WHERE id = @id
  `);

  for (const row of rows) {
    let changed = false;
    let nextToken = row.tokenJson;
    let nextQuota = row.quotaJson;

    if (nextToken && nextToken.startsWith('{')) {
      nextToken = await encrypt(nextToken);
      changed = true;
    }
    if (nextQuota && nextQuota.startsWith('{')) {
      nextQuota = await encrypt(nextQuota);
      changed = true;
    }

    if (!changed) {
      continue;
    }

    updateStatement.run({
      id: row.id,
      tokenJson: nextToken,
      quotaJson: nextQuota,
    });
    logger.info(`Migrated plaintext account payloads for ${row.id}`);
  }
}

type CodexIdentityMigrationRow = {
  id: string;
  accountId: string;
  workspaceId: string | null;
  workspaceTitle: string | null;
  workspaceRole: string | null;
  workspaceIsDefault: number | null;
  identityKey: string | null;
  encryptedAuthJson: string;
  isActive: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastRefreshedAt: number | null;
};

function compareCodexMigrationRowFreshness(
  left: Pick<
    CodexIdentityMigrationRow,
    'id' | 'isActive' | 'updatedAt' | 'lastRefreshedAt' | 'createdAt'
  >,
  right: Pick<
    CodexIdentityMigrationRow,
    'id' | 'isActive' | 'updatedAt' | 'lastRefreshedAt' | 'createdAt'
  >,
): number {
  if (left.isActive !== right.isActive) {
    return right.isActive - left.isActive;
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  if ((left.lastRefreshedAt ?? 0) !== (right.lastRefreshedAt ?? 0)) {
    return (right.lastRefreshedAt ?? 0) - (left.lastRefreshedAt ?? 0);
  }

  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }

  return left.id.localeCompare(right.id);
}

async function migrateCodexWorkspaceIdentities(db: Database.Database): Promise<void> {
  ensureCodexAccountsColumn(
    db,
    'workspace_id',
    'ALTER TABLE codex_accounts ADD COLUMN workspace_id TEXT',
  );
  ensureCodexAccountsColumn(
    db,
    'workspace_title',
    'ALTER TABLE codex_accounts ADD COLUMN workspace_title TEXT',
  );
  ensureCodexAccountsColumn(
    db,
    'workspace_role',
    'ALTER TABLE codex_accounts ADD COLUMN workspace_role TEXT',
  );
  ensureCodexAccountsColumn(
    db,
    'workspace_is_default',
    'ALTER TABLE codex_accounts ADD COLUMN workspace_is_default INTEGER NOT NULL DEFAULT 0',
  );
  ensureCodexAccountsColumn(
    db,
    'identity_key',
    "ALTER TABLE codex_accounts ADD COLUMN identity_key TEXT NOT NULL DEFAULT ''",
  );

  db.exec('DROP INDEX IF EXISTS idx_codex_accounts_account_id');
  db.exec('DROP INDEX IF EXISTS idx_codex_accounts_identity_key');

  const rows = db
    .prepare(
      `SELECT
        id,
        account_id AS accountId,
        workspace_id AS workspaceId,
        workspace_title AS workspaceTitle,
        workspace_role AS workspaceRole,
        workspace_is_default AS workspaceIsDefault,
        identity_key AS identityKey,
        encrypted_auth_json AS encryptedAuthJson,
        is_active AS isActive,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt,
        last_refreshed_at AS lastRefreshedAt
      FROM codex_accounts`,
    )
    .all() as CodexIdentityMigrationRow[];

  const dedupedByIdentityKey = new Map<string, CodexIdentityMigrationRow>();

  for (const row of rows) {
    let workspaceId = row.workspaceId ?? null;
    let workspaceTitle = row.workspaceTitle ?? null;
    let workspaceRole = row.workspaceRole ?? null;
    let workspaceIsDefault = row.workspaceIsDefault === 1 ? 1 : 0;

    if (!workspaceId) {
      try {
        const decryptedAuth = await decrypt(row.encryptedAuthJson, {
          suppressAuthTagMismatchLog: true,
        });
        const authFile = JSON.parse(decryptedAuth) as Parameters<
          typeof getCodexWorkspaceFromAuthFile
        >[0];
        const workspace = getCodexWorkspaceFromAuthFile(authFile);
        workspaceId = workspace?.id ?? null;
        workspaceTitle = workspace?.title ?? null;
        workspaceRole = workspace?.role ?? null;
        workspaceIsDefault = workspace?.isDefault ? 1 : 0;
      } catch (error) {
        logger.warn(`Failed to decode Codex auth during workspace migration for ${row.id}`, error);
      }
    }

    const identityKey = getCodexIdentityKey({
      accountId: row.accountId,
      workspace: workspaceId
        ? {
            id: workspaceId,
            title: workspaceTitle,
            role: workspaceRole,
            isDefault: workspaceIsDefault === 1,
          }
        : null,
    });

    const normalizedRow: CodexIdentityMigrationRow = {
      ...row,
      workspaceId,
      workspaceTitle,
      workspaceRole,
      workspaceIsDefault,
      identityKey,
    };

    db.prepare(
      `UPDATE codex_accounts
       SET workspace_id = @workspaceId,
           workspace_title = @workspaceTitle,
           workspace_role = @workspaceRole,
           workspace_is_default = @workspaceIsDefault,
           identity_key = @identityKey
       WHERE id = @id`,
    ).run({
      id: normalizedRow.id,
      workspaceId: normalizedRow.workspaceId,
      workspaceTitle: normalizedRow.workspaceTitle,
      workspaceRole: normalizedRow.workspaceRole,
      workspaceIsDefault: normalizedRow.workspaceIsDefault,
      identityKey: normalizedRow.identityKey,
    });

    const existing = dedupedByIdentityKey.get(identityKey);
    if (!existing || compareCodexMigrationRowFreshness(normalizedRow, existing) < 0) {
      dedupedByIdentityKey.set(identityKey, normalizedRow);
    }
  }

  const dedupedRows = Array.from(dedupedByIdentityKey.values());
  const preferredActiveId =
    dedupedRows.filter((row) => row.isActive === 1).sort(compareCodexMigrationRowFreshness)[0]
      ?.id ?? null;

  for (const row of dedupedRows) {
    const normalizedIsActive = preferredActiveId && row.id === preferredActiveId ? 1 : 0;
    if (row.isActive !== normalizedIsActive) {
      db.prepare('UPDATE codex_accounts SET is_active = ? WHERE id = ?').run(
        normalizedIsActive,
        row.id,
      );
    }
  }

  const dedupedIds = new Set(dedupedRows.map((row) => row.id));
  for (const row of rows) {
    if (!dedupedIds.has(row.id)) {
      db.prepare('DELETE FROM codex_accounts WHERE id = ?').run(row.id);
    }
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_codex_accounts_identity_key
    ON codex_accounts(identity_key);
  `);
}

const CLOUD_SCHEMA_MIGRATIONS: CloudSchemaMigration[] = [
  {
    version: 1,
    name: 'add_is_active_column',
    apply: (db) => {
      ensureAccountsColumn(
        db,
        'is_active',
        'ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 0',
      );
    },
  },
  {
    version: 2,
    name: 'add_device_profile_json_column',
    apply: (db) => {
      ensureAccountsColumn(
        db,
        'device_profile_json',
        'ALTER TABLE accounts ADD COLUMN device_profile_json TEXT',
      );
    },
  },
  {
    version: 3,
    name: 'add_device_history_json_column',
    apply: (db) => {
      ensureAccountsColumn(
        db,
        'device_history_json',
        'ALTER TABLE accounts ADD COLUMN device_history_json TEXT',
      );
    },
  },
  {
    version: 4,
    name: 'encrypt_plaintext_account_payloads',
    apply: (db) => migratePlaintextAccountPayloads(db),
  },
  {
    version: 5,
    name: 'codex_workspace_identity',
    apply: (db) => migrateCodexWorkspaceIdentities(db),
  },
  {
    version: 6,
    name: 'codex_hydration_state',
    apply: (db) => {
      ensureCodexAccountsColumn(
        db,
        'hydration_state',
        "ALTER TABLE codex_accounts ADD COLUMN hydration_state TEXT NOT NULL DEFAULT 'live'",
      );
    },
  },
];

function getAppliedCloudMigrationVersions(db: Database.Database): Set<number> {
  const rows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as Array<{ version: number }>;
  return new Set(
    rows
      .map((row) => row.version)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
  );
}

function createCloudMigrationBackup(dbPath: string): string {
  const backupPath = `${dbPath}${CLOUD_MIGRATION_BACKUP_SUFFIX}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function cleanupCloudMigrationBackup(backupPath: string | null): void {
  if (!backupPath || !fs.existsSync(backupPath)) {
    return;
  }
  fs.unlinkSync(backupPath);
}

function cleanupCloudMigrationSidecars(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const sidecarPath = `${dbPath}${suffix}`;
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
    }
  }
}

function restoreCloudMigrationBackup(dbPath: string, backupPath: string): void {
  cleanupCloudMigrationSidecars(dbPath);
  fs.copyFileSync(backupPath, dbPath);
}

async function applyPendingCloudMigrations(
  dbPath: string,
  options: { backupRequired: boolean },
): Promise<void> {
  let db: Database.Database | null = null;
  let backupPath: string | null = null;
  let activeMigration: CloudSchemaMigration | null = null;

  try {
    db = new Database(dbPath);
    configureDatabase(db, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
    ensureCloudSchemaMetadata(db);
    const appliedVersions = getAppliedCloudMigrationVersions(db);
    const pendingMigrations = CLOUD_SCHEMA_MIGRATIONS.filter(
      (migration) => !appliedVersions.has(migration.version),
    );

    if (pendingMigrations.length === 0) {
      return;
    }

    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    db = null;

    if (options.backupRequired) {
      backupPath = createCloudMigrationBackup(dbPath);
      logger.info(`Created cloud DB migration backup at ${backupPath}`);
    }

    db = new Database(dbPath);
    configureDatabase(db, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
    ensureCloudSchemaMetadata(db);

    for (const migration of pendingMigrations) {
      activeMigration = migration;
      await migration.apply(db);
      db.prepare(
        `
          INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, ?)
        `,
      ).run(migration.version, migration.name, new Date().toISOString());
      logger.info(`Applied cloud schema migration ${migration.version}:${migration.name}`);
    }
  } catch (error) {
    logger.error(
      `Cloud DB migration failed${activeMigration ? ` at ${activeMigration.version}:${activeMigration.name}` : ''}`,
      error,
    );

    if (db) {
      db.close();
      db = null;
    }

    if (backupPath) {
      restoreCloudMigrationBackup(dbPath, backupPath);
      logger.warn(`Restored cloud DB backup after failed migration: ${backupPath}`);
    }

    throw error;
  } finally {
    if (db) {
      db.close();
    }
    cleanupCloudMigrationBackup(backupPath);
  }
}

export function isCloudStorageUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { message?: unknown; stack?: unknown; cause?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';
  const stack = typeof maybeError.stack === 'string' ? maybeError.stack : '';

  if (hasNativeModuleFailureSignature(message) || hasNativeModuleFailureSignature(stack)) {
    return true;
  }

  return Boolean(maybeError.cause) && isCloudStorageUnavailableError(maybeError.cause);
}

function logCloudStorageUnavailable(context: string, error: unknown): void {
  if (cloudStorageUnavailableWarningLogged) {
    return;
  }

  cloudStorageUnavailableWarningLogged = true;
  logger.warn(
    `${context}. Falling back to safe defaults until native storage is available.`,
    error,
  );
}

/**
 * Ensures that the cloud database file and schema exist.
 * @param dbPath {string} The path to the database file.
 */
export function ensureCloudDatabaseInitialized(dbPath: string = getCloudAccountsDbPath()): void {
  const dir = getPathModuleForFsPath(dbPath).dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    configureDatabase(db, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });

    // Create accounts table
    // Storing complex objects (token, quota) as JSON strings for simplicity
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        token_json TEXT NOT NULL,
        quota_json TEXT,
        device_profile_json TEXT,
        device_history_json TEXT,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        is_active INTEGER DEFAULT 0
      );
    `);

    // Create index on email for faster lookups
    // Create index on email for faster lookups
    db.exec(`CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);`);

    // Create settings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS codex_accounts (
        id TEXT PRIMARY KEY,
        email TEXT,
        label TEXT,
        account_id TEXT NOT NULL,
        auth_mode TEXT,
        hydration_state TEXT NOT NULL DEFAULT 'live',
        workspace_id TEXT,
        workspace_title TEXT,
        workspace_role TEXT,
        workspace_is_default INTEGER NOT NULL DEFAULT 0,
        identity_key TEXT NOT NULL,
        encrypted_auth_json TEXT NOT NULL,
        snapshot_json TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_refreshed_at INTEGER
      );
    `);
    if (getCodexAccountsTableInfo(db).some((column) => column.name === 'identity_key')) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_codex_accounts_identity_key
        ON codex_accounts(identity_key);
      `);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_codex_accounts_sort_order
      ON codex_accounts(sort_order, created_at);
    `);
    ensureCloudSchemaMetadata(db);
  } catch (error) {
    logger.error('Failed to initialize cloud database schema', error);
    throw error;
  } finally {
    if (db) db.close();
  }
}

/**
 * Gets a connection to the cloud accounts database.
 */
function getCloudDb(): CloudDbScopedConnection {
  if (!cloudDbOwnerConnection) {
    const dbPath = getCloudAccountsDbPath();
    ensureCloudDatabaseInitialized(dbPath);
    cloudDbOwnerConnection = openDrizzleConnection(
      dbPath,
      { readonly: false, fileMustExist: false },
      { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS },
    );
  }

  return {
    orm: cloudDbOwnerConnection.orm,
  };
}

export function getCloudDbConnection(): CloudDbScopedConnection {
  return getCloudDb();
}

function closeCloudDbOwnerConnection(): void {
  if (!cloudDbOwnerConnection) {
    return;
  }

  cloudDbOwnerConnection.raw.close();
  cloudDbOwnerConnection = null;
}

function getIdeDb(
  dbPath: string,
  readOnly: boolean,
): { raw: Database.Database; orm: BetterSQLite3Database<typeof drizzleSchema> } {
  return openDrizzleConnection(
    dbPath,
    { readonly: readOnly },
    { readOnly, busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS },
  );
}

interface MigrationStats {
  totalFields: number;
  fallbackUsedFields: number;
  migratedFields: number;
  migratedBySource: Record<KeySource, number>;
  failedFields: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringCandidate(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = source[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeDeviceProfile(value: unknown): DeviceProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const machineId = readStringCandidate(value, 'machineId', 'machine_id');
  const macMachineId = readStringCandidate(value, 'macMachineId', 'mac_machine_id');
  const devDeviceId = readStringCandidate(value, 'devDeviceId', 'dev_device_id');
  const sqmId = readStringCandidate(value, 'sqmId', 'sqm_id');

  if (!machineId || !macMachineId || !devDeviceId || !sqmId) {
    return undefined;
  }

  return {
    machineId,
    macMachineId,
    devDeviceId,
    sqmId,
  };
}

function areDeviceProfilesEqual(left: DeviceProfile, right: DeviceProfile): boolean {
  return (
    left.machineId === right.machineId &&
    left.macMachineId === right.macMachineId &&
    left.devDeviceId === right.devDeviceId &&
    left.sqmId === right.sqmId
  );
}

function readVersionedProfilePayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (!('schemaVersion' in value)) {
    return value;
  }

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    throw new Error('invalid_device_profile_schema_version');
  }
  if (schemaVersion !== DEVICE_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`unsupported_device_profile_schema_version:${schemaVersion}`);
  }
  if (!('profile' in value)) {
    throw new Error('invalid_device_profile_payload');
  }
  return value.profile;
}

function readVersionedHistoryPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (!('schemaVersion' in value)) {
    return value;
  }

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    throw new Error('invalid_device_history_schema_version');
  }
  if (schemaVersion !== DEVICE_PAYLOAD_SCHEMA_VERSION) {
    throw new Error(`unsupported_device_history_schema_version:${schemaVersion}`);
  }
  if (!('history' in value)) {
    throw new Error('invalid_device_history_payload');
  }
  return value.history;
}

function serializeDeviceProfile(profile: DeviceProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  return JSON.stringify({
    schemaVersion: DEVICE_PAYLOAD_SCHEMA_VERSION,
    profile,
  });
}

function serializeDeviceHistory(history: DeviceProfileVersion[] | undefined): string | null {
  if (!history || history.length === 0) {
    return null;
  }
  return JSON.stringify({
    schemaVersion: DEVICE_PAYLOAD_SCHEMA_VERSION,
    history,
  });
}

function normalizeDeviceHistory(value: unknown): DeviceProfileVersion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: DeviceProfileVersion[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const profile = normalizeDeviceProfile(item.profile);
    if (!profile) {
      continue;
    }

    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : uuidv4();
    const createdAtCandidate = item.createdAt;
    const createdAt =
      typeof createdAtCandidate === 'number' && Number.isFinite(createdAtCandidate)
        ? Math.floor(createdAtCandidate)
        : Math.floor(Date.now() / 1000);
    const label = typeof item.label === 'string' && item.label.length > 0 ? item.label : 'legacy';
    const isCurrent = item.isCurrent === true;

    normalized.push({
      id,
      createdAt,
      label,
      profile,
      isCurrent,
    });
  }

  return normalized;
}

function parseDeviceProfileColumn(value: string | null | undefined): DeviceProfile | undefined {
  if (!value) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('invalid_device_profile_json');
  }
  const normalized = normalizeDeviceProfile(readVersionedProfilePayload(parsed));
  if (!normalized) {
    throw new Error('invalid_device_profile_json');
  }
  return normalized;
}

function parseDeviceHistoryColumn(
  value: string | null | undefined,
): DeviceProfileVersion[] | undefined {
  if (!value) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('invalid_device_history_json');
  }
  const payload = readVersionedHistoryPayload(parsed);
  if (!Array.isArray(payload)) {
    throw new Error('invalid_device_history_json');
  }
  const normalized = normalizeDeviceHistory(payload);
  if (!normalized) {
    throw new Error('invalid_device_history_json');
  }
  if (normalized.length !== payload.length) {
    throw new Error('invalid_device_history_entry');
  }
  return normalized;
}

function createMigrationStats(): MigrationStats {
  return {
    totalFields: 0,
    fallbackUsedFields: 0,
    migratedFields: 0,
    migratedBySource: {
      safeStorage: 0,
      keytar: 0,
      file: 0,
    },
    failedFields: 0,
  };
}

async function decryptAndMigrateField(
  orm: DrizzleExecutor,
  accountId: string,
  field: 'tokenJson' | 'quotaJson',
  value: string | null,
): Promise<{ value: string | null; migrated: boolean; usedFallback?: KeySource }> {
  if (!value) {
    return { value: null, migrated: false };
  }

  const result = await decryptWithMigration(value);
  if (result.reencrypted) {
    if (field === 'tokenJson') {
      orm
        .update(accounts)
        .set({ tokenJson: result.reencrypted })
        .where(eq(accounts.id, accountId))
        .run();
    } else {
      orm
        .update(accounts)
        .set({ quotaJson: result.reencrypted })
        .where(eq(accounts.id, accountId))
        .run();
    }
    logger.info(
      `Migrated ${field} for account ${accountId} from ${result.usedFallback ?? 'unknown'} key`,
    );
  }

  return {
    value: result.value,
    migrated: Boolean(result.reencrypted),
    usedFallback: result.usedFallback,
  };
}

export class CloudAccountRepo {
  private static versionFailureLogged = false;

  static async init(): Promise<void> {
    const dbPath = getCloudAccountsDbPath();
    const backupRequired = fs.existsSync(dbPath);
    closeCloudDbOwnerConnection();
    ensureCloudDatabaseInitialized(dbPath);
    await applyPendingCloudMigrations(dbPath, { backupRequired });
    getCloudDb();
  }

  static shutdown(): void {
    closeCloudDbOwnerConnection();
  }

  static async migrateToEncrypted(): Promise<void> {
    const dbPath = getCloudAccountsDbPath();
    await applyPendingCloudMigrations(dbPath, { backupRequired: fs.existsSync(dbPath) });
  }

  static async addAccount(account: CloudAccount): Promise<void> {
    const { orm } = getCloudDb();
    const tokenEncrypted = await encrypt(JSON.stringify(account.token));
    const quotaEncrypted = account.quota ? await encrypt(JSON.stringify(account.quota)) : null;
    const values = {
      id: account.id,
      provider: account.provider,
      email: account.email,
      name: account.name ?? null,
      avatarUrl: account.avatar_url ?? null,
      tokenJson: tokenEncrypted,
      quotaJson: quotaEncrypted,
      deviceProfileJson: serializeDeviceProfile(account.device_profile),
      deviceHistoryJson: serializeDeviceHistory(account.device_history),
      createdAt: account.created_at,
      lastUsed: account.last_used,
      status: account.status || 'active',
      isActive: account.is_active ? 1 : 0,
    };

    orm.transaction((tx) => {
      // If this account is being set to active, deactivate all others first
      if (account.is_active) {
        logger.info(
          `[DEBUG] addAccount: Deactivating all other accounts because ${account.email} is active`,
        );
        const info = tx.update(accounts).set({ isActive: 0 }).run();
        logger.info(`[DEBUG] addAccount: Deactivation changed ${info.changes} rows`);
      }
      tx.insert(accounts)
        .values(values)
        .onConflictDoUpdate({
          target: accounts.id,
          set: values,
        })
        .run();
    });
    logger.info(`Added/Updated cloud account: ${account.email}`);
  }

  static async getAccounts(): Promise<CloudAccount[]> {
    let connection: ReturnType<typeof getCloudDb>;
    try {
      connection = getCloudDb();
    } catch (error) {
      if (isCloudStorageUnavailableError(error)) {
        logCloudStorageUnavailable('Cloud account storage is unavailable', error);
        return [];
      }
      throw error;
    }
    const { orm } = connection;
    const migrationStats = createMigrationStats();

    try {
      const rows = orm.select().from(accounts).orderBy(desc(accounts.lastUsed)).all();

      // DEBUG LOGS
      const activeRows = rows.filter((r) => r.isActive);
      logger.info(
        `[DEBUG] getAccounts: Found ${rows.length} accounts, ${activeRows.length} active.`,
      );
      activeRows.forEach((r) => logger.info(`[DEBUG] Active Account: ${r.email} (${r.id})`));

      const cloudAccounts: CloudAccount[] = [];
      for (const normalizedRow of rows) {
        try {
          const tokenResult = await decryptAndMigrateField(
            orm,
            normalizedRow.id,
            'tokenJson',
            normalizedRow.tokenJson,
          );
          const quotaResult = await decryptAndMigrateField(
            orm,
            normalizedRow.id,
            'quotaJson',
            normalizedRow.quotaJson,
          );

          if (!tokenResult.value) {
            throw new Error(`Missing token data for account ${normalizedRow.id}`);
          }

          if (tokenResult.value) {
            migrationStats.totalFields += 1;
          }
          if (tokenResult.usedFallback) {
            migrationStats.fallbackUsedFields += 1;
          }
          if (tokenResult.migrated) {
            migrationStats.migratedFields += 1;
            if (tokenResult.usedFallback) {
              migrationStats.migratedBySource[tokenResult.usedFallback] += 1;
            }
          }

          if (quotaResult.value) {
            migrationStats.totalFields += 1;
          }
          if (quotaResult.usedFallback) {
            migrationStats.fallbackUsedFields += 1;
          }
          if (quotaResult.migrated) {
            migrationStats.migratedFields += 1;
            if (quotaResult.usedFallback) {
              migrationStats.migratedBySource[quotaResult.usedFallback] += 1;
            }
          }

          cloudAccounts.push({
            id: normalizedRow.id,
            provider: normalizedRow.provider as CloudAccount['provider'],
            email: normalizedRow.email,
            name: normalizedRow.name ?? undefined,
            avatar_url: normalizedRow.avatarUrl ?? undefined,
            token: JSON.parse(tokenResult.value),
            quota: quotaResult.value ? JSON.parse(quotaResult.value) : undefined,
            device_profile: parseDeviceProfileColumn(normalizedRow.deviceProfileJson),
            device_history: parseDeviceHistoryColumn(normalizedRow.deviceHistoryJson),
            created_at: normalizedRow.createdAt,
            last_used: normalizedRow.lastUsed,
            status: (normalizedRow.status as CloudAccount['status']) ?? undefined,
            is_active: Boolean(normalizedRow.isActive),
          });
        } catch (error) {
          migrationStats.failedFields += 1;
          logger.warn(
            `Skipping unreadable cloud account row ${normalizedRow.id} during list load`,
            error,
          );
        }
      }

      return cloudAccounts;
    } finally {
      if (
        migrationStats.migratedFields > 0 ||
        migrationStats.fallbackUsedFields > 0 ||
        migrationStats.failedFields > 0
      ) {
        const summary = {
          totalFields: migrationStats.totalFields,
          fallbackUsedFields: migrationStats.fallbackUsedFields,
          migratedFields: migrationStats.migratedFields,
          migratedBySource: migrationStats.migratedBySource,
          failedFields: migrationStats.failedFields,
        };
        if (migrationStats.failedFields > 0) {
          logger.warn('CloudAccountRepo migration summary (with failures)', summary);
        } else {
          logger.info('CloudAccountRepo migration summary', summary);
        }
      }
    }
  }

  static async getAccount(id: string): Promise<CloudAccount | undefined> {
    const { orm } = getCloudDb();
    const rows = orm.select().from(accounts).where(eq(accounts.id, id)).all();
    const normalizedRow = rows[0];
    if (!normalizedRow) {
      return undefined;
    }

    const tokenResult = await decryptAndMigrateField(
      orm,
      normalizedRow.id,
      'tokenJson',
      normalizedRow.tokenJson,
    );
    const quotaResult = await decryptAndMigrateField(
      orm,
      normalizedRow.id,
      'quotaJson',
      normalizedRow.quotaJson,
    );

    if (!tokenResult.value) {
      throw new Error(`Missing token data for account ${normalizedRow.id}`);
    }

    return {
      id: normalizedRow.id,
      provider: normalizedRow.provider as CloudAccount['provider'],
      email: normalizedRow.email,
      name: normalizedRow.name ?? undefined,
      avatar_url: normalizedRow.avatarUrl ?? undefined,
      token: JSON.parse(tokenResult.value),
      quota: quotaResult.value ? JSON.parse(quotaResult.value) : undefined,
      device_profile: parseDeviceProfileColumn(normalizedRow.deviceProfileJson),
      device_history: parseDeviceHistoryColumn(normalizedRow.deviceHistoryJson),
      created_at: normalizedRow.createdAt,
      last_used: normalizedRow.lastUsed,
      status: (normalizedRow.status as CloudAccount['status']) ?? undefined,
      is_active: Boolean(normalizedRow.isActive),
    };
  }

  static async removeAccount(id: string): Promise<void> {
    const { orm } = getCloudDb();
    orm.delete(accounts).where(eq(accounts.id, id)).run();
    logger.info(`Removed cloud account: ${id}`);
  }

  static async updateToken(id: string, token: any): Promise<void> {
    const { orm } = getCloudDb();
    const encrypted = await encrypt(JSON.stringify(token));
    orm.update(accounts).set({ tokenJson: encrypted }).where(eq(accounts.id, id)).run();
  }

  static async updateQuota(id: string, quota: any): Promise<void> {
    const { orm } = getCloudDb();
    const encrypted = await encrypt(JSON.stringify(quota));
    orm.update(accounts).set({ quotaJson: encrypted }).where(eq(accounts.id, id)).run();
  }

  static updateLastUsed(id: string): void {
    const { orm } = getCloudDb();
    orm
      .update(accounts)
      .set({ lastUsed: Math.floor(Date.now() / 1000) })
      .where(eq(accounts.id, id))
      .run();
  }

  static setDeviceBinding(id: string, profile: DeviceProfile, label: string): void {
    const { orm } = getCloudDb();
    const rows = orm
      .select({
        deviceProfileJson: accounts.deviceProfileJson,
        deviceHistoryJson: accounts.deviceHistoryJson,
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .all();
    const row = rows[0];
    if (!row) {
      throw new Error(`Account not found: ${id}`);
    }

    const boundProfile = parseDeviceProfileColumn(row.deviceProfileJson);
    if (boundProfile && areDeviceProfilesEqual(boundProfile, profile)) {
      logger.info(
        `Skipping duplicate device profile binding for account ${id} (bound profile match)`,
      );
      return;
    }

    const historyRaw = parseDeviceHistoryColumn(row.deviceHistoryJson) || [];
    const currentVersion = historyRaw.find((version) => version.isCurrent);
    const latestVersion = historyRaw.length > 0 ? historyRaw[historyRaw.length - 1] : undefined;
    if (currentVersion && areDeviceProfilesEqual(currentVersion.profile, profile)) {
      logger.info(
        `Skipping duplicate device profile binding for account ${id} (history current match)`,
      );
      return;
    }
    if (
      !currentVersion &&
      latestVersion &&
      areDeviceProfilesEqual(latestVersion.profile, profile)
    ) {
      logger.info(
        `Skipping duplicate device profile binding for account ${id} (history latest match)`,
      );
      return;
    }

    const history = historyRaw.map((version) => ({
      ...version,
      isCurrent: false,
    }));

    history.push({
      id: uuidv4(),
      createdAt: Math.floor(Date.now() / 1000),
      label,
      profile,
      isCurrent: true,
    });

    orm
      .update(accounts)
      .set({
        deviceProfileJson: serializeDeviceProfile(profile),
        deviceHistoryJson: serializeDeviceHistory(history),
      })
      .where(eq(accounts.id, id))
      .run();
  }

  static getDeviceBinding(id: string): {
    profile?: DeviceProfile;
    history: DeviceProfileVersion[];
  } {
    const { orm } = getCloudDb();
    const rows = orm
      .select({
        deviceProfileJson: accounts.deviceProfileJson,
        deviceHistoryJson: accounts.deviceHistoryJson,
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .all();
    const row = rows[0];
    if (!row) {
      throw new Error(`Account not found: ${id}`);
    }

    return {
      profile: parseDeviceProfileColumn(row.deviceProfileJson),
      history: parseDeviceHistoryColumn(row.deviceHistoryJson) || [],
    };
  }

  static restoreDeviceVersion(
    id: string,
    versionId: string,
    baseline: DeviceProfile | null,
  ): DeviceProfile {
    const { orm } = getCloudDb();
    const rows = orm
      .select({
        deviceProfileJson: accounts.deviceProfileJson,
        deviceHistoryJson: accounts.deviceHistoryJson,
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .all();
    const row = rows[0];
    if (!row) {
      throw new Error(`Account not found: ${id}`);
    }

    const currentProfile = parseDeviceProfileColumn(row.deviceProfileJson);
    const history = parseDeviceHistoryColumn(row.deviceHistoryJson) || [];

    let targetProfile: DeviceProfile;
    if (versionId === 'baseline') {
      if (!baseline) {
        throw new Error('Global original profile not found');
      }
      targetProfile = baseline;
    } else if (versionId === 'current') {
      if (!currentProfile) {
        throw new Error('No currently bound profile');
      }
      targetProfile = currentProfile;
    } else {
      const targetVersion = history.find((version) => version.id === versionId);
      if (!targetVersion) {
        throw new Error('Device profile version not found');
      }
      targetProfile = targetVersion.profile;
    }

    const nextHistory = history.map((version) => ({
      ...version,
      isCurrent: version.id === versionId,
    }));

    orm
      .update(accounts)
      .set({
        deviceProfileJson: serializeDeviceProfile(targetProfile),
        deviceHistoryJson: serializeDeviceHistory(nextHistory),
      })
      .where(eq(accounts.id, id))
      .run();

    return targetProfile;
  }

  static deleteDeviceVersion(id: string, versionId: string): void {
    if (versionId === 'baseline') {
      throw new Error('Original profile cannot be deleted');
    }

    const { orm } = getCloudDb();
    const rows = orm
      .select({ deviceHistoryJson: accounts.deviceHistoryJson })
      .from(accounts)
      .where(eq(accounts.id, id))
      .all();
    const row = rows[0];
    if (!row) {
      throw new Error(`Account not found: ${id}`);
    }

    const history = parseDeviceHistoryColumn(row.deviceHistoryJson) || [];
    if (history.some((version) => version.id === versionId && version.isCurrent)) {
      throw new Error('Currently bound profile cannot be deleted');
    }

    const nextHistory = history.filter((version) => version.id !== versionId);
    if (nextHistory.length === history.length) {
      throw new Error('Historical device profile not found');
    }

    orm
      .update(accounts)
      .set({ deviceHistoryJson: serializeDeviceHistory(nextHistory) })
      .where(eq(accounts.id, id))
      .run();
  }

  static setActive(id: string): void {
    const { orm } = getCloudDb();
    orm.transaction((tx) => {
      tx.update(accounts).set({ isActive: 0 }).run();
      tx.update(accounts).set({ isActive: 1 }).where(eq(accounts.id, id)).run();
    });
    logger.info(`Set account ${id} as active`);
  }

  private static upsertItemValue(db: DrizzleExecutor, key: string, value: string): void {
    db.insert(itemTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: itemTable.key,
        set: { value },
      })
      .run();
  }

  private static writeAuthStatusAndCleanup(db: DrizzleExecutor, account: CloudAccount): void {
    const authStatus = {
      name: account.name || account.email,
      email: account.email,
      apiKey: account.token.access_token,
    };

    this.upsertItemValue(db, 'antigravityAuthStatus', JSON.stringify(authStatus));
    this.upsertItemValue(db, 'antigravityOnboarding', 'true');
    db.delete(itemTable).where(eq(itemTable.key, 'google.antigravity')).run();
  }

  private static getItemValue(db: DrizzleExecutor, key: string, context: string): string | null {
    const rows = db
      .select({ value: itemTable.value })
      .from(itemTable)
      .where(eq(itemTable.key, key))
      .all();
    const row = parseRow(ItemTableValueRowSchema, rows[0], context);
    return row?.value ?? null;
  }

  private static injectNewFormat(
    orm: BetterSQLite3Database<typeof drizzleSchema>,
    account: CloudAccount,
  ): void {
    const oauthToken = ProtobufUtils.createUnifiedOAuthToken(
      account.token.access_token,
      account.token.refresh_token,
      account.token.expiry_timestamp,
    );

    orm.transaction((tx) => {
      this.upsertItemValue(tx, 'antigravityUnifiedStateSync.oauthToken', oauthToken);
      this.writeAuthStatusAndCleanup(tx, account);
    });
  }

  private static injectOldFormat(
    orm: BetterSQLite3Database<typeof drizzleSchema>,
    account: CloudAccount,
  ): void {
    const value = this.getItemValue(
      orm,
      'jetskiStateSync.agentManagerInitState',
      'ide.itemTable.jetskiStateSync.agentManagerInitState',
    );

    orm.transaction((tx) => {
      if (!value) {
        logger.warn(
          'jetskiStateSync.agentManagerInitState not found. ' +
            'Injecting minimal auth state only. User may need to complete onboarding in the IDE first.',
        );

        this.writeAuthStatusAndCleanup(tx, account);

        logger.info(
          `Injected minimal auth state for ${account.email} (no protobuf state available)`,
        );
        return;
      }

      const buffer = Buffer.from(value, 'base64');
      const data = new Uint8Array(buffer);
      const cleanData = ProtobufUtils.removeField(data, 6);
      const newField = ProtobufUtils.createOAuthTokenInfo(
        account.token.access_token,
        account.token.refresh_token,
        account.token.expiry_timestamp,
      );

      const finalData = new Uint8Array(cleanData.length + newField.length);
      finalData.set(cleanData, 0);
      finalData.set(newField, cleanData.length);

      const finalB64 = Buffer.from(finalData).toString('base64');

      tx.update(itemTable)
        .set({ value: finalB64 })
        .where(eq(itemTable.key, 'jetskiStateSync.agentManagerInitState'))
        .run();

      this.writeAuthStatusAndCleanup(tx, account);
    });
  }

  private static detectFormatCapability(db: DrizzleExecutor): 'new' | 'old' | null {
    const unifiedValue = this.getItemValue(
      db,
      'antigravityUnifiedStateSync.oauthToken',
      'ide.itemTable.antigravityUnifiedStateSync.oauthToken',
    );
    if (unifiedValue) {
      return 'new';
    }

    const oldValue = this.getItemValue(
      db,
      'jetskiStateSync.agentManagerInitState',
      'ide.itemTable.jetskiStateSync.agentManagerInitState',
    );
    if (oldValue) {
      return 'old';
    }

    return null;
  }

  private static resolveInjectionStrategy(db: DrizzleExecutor): {
    name: 'new' | 'old' | 'dual';
    reason: string;
  } {
    try {
      const version = getAntigravityVersion();
      return {
        name: isNewVersion(version) ? 'new' : 'old',
        reason: `version:${version.shortVersion}`,
      };
    } catch (error) {
      if (!this.versionFailureLogged) {
        logger.warn('Version detection failed, falling back to capability detection', error);
        this.versionFailureLogged = true;
      }
    }

    const capability = this.detectFormatCapability(db);
    if (capability) {
      return { name: capability, reason: 'capability' };
    }

    return { name: 'dual', reason: 'fallback' };
  }

  private static getStrategy(name: 'new' | 'old'): {
    name: 'new' | 'old';
    inject: (db: BetterSQLite3Database<typeof drizzleSchema>, account: CloudAccount) => void;
  } {
    if (name === 'new') {
      return { name, inject: (db, account) => this.injectNewFormat(db, account) };
    }
    return { name, inject: (db, account) => this.injectOldFormat(db, account) };
  }

  private static async injectWithRetry(
    dbPath: string,
    account: CloudAccount,
  ): Promise<{ strategy: string; attempts: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SQLITE_MAX_RETRIES; attempt += 1) {
      const { raw, orm } = getIdeDb(dbPath, false);
      try {
        const { name, reason } = this.resolveInjectionStrategy(orm);
        if (name === 'dual') {
          let newInjected = false;
          let oldInjected = false;

          try {
            this.injectNewFormat(orm, account);
            newInjected = true;
          } catch (newError) {
            logger.warn('Failed to inject new format', newError);
          }

          try {
            this.injectOldFormat(orm, account);
            oldInjected = true;
          } catch (oldError) {
            logger.warn('Failed to inject old format', oldError);
          }

          if (!newInjected && !oldInjected) {
            throw new Error('Token injection failed for both formats');
          }

          return { strategy: `dual:${reason}`, attempts: attempt };
        }

        const strategy = this.getStrategy(name);
        strategy.inject(orm, account);
        return { strategy: `${strategy.name}:${reason}`, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (isSqliteBusyError(error) && attempt < SQLITE_MAX_RETRIES) {
          logger.warn(`SQLite busy, retrying injection (attempt ${attempt})`, error);
          await sleep(SQLITE_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      } finally {
        raw.close();
      }
    }

    throw lastError;
  }

  static async injectCloudToken(account: CloudAccount): Promise<void> {
    const dbPaths = getAntigravityDbPaths();
    const dbPath = dbPaths.find((p) => fs.existsSync(p)) ?? null;

    if (!dbPath) {
      throw new Error(`Antigravity database not found. Checked paths: ${dbPaths.join(', ')}`);
    }

    const result = await this.injectWithRetry(dbPath, account);
    logger.info(
      `Successfully injected cloud token and identity for ${account.email} into Antigravity database at ${dbPath} (strategy=${result.strategy}, attempts=${result.attempts}).`,
    );
  }

  static getSetting<T>(key: string, defaultValue: T): T {
    let connection: ReturnType<typeof getCloudDb>;
    try {
      connection = getCloudDb();
    } catch (error) {
      if (isCloudStorageUnavailableError(error)) {
        logCloudStorageUnavailable(
          `Cloud settings storage is unavailable while reading "${key}"`,
          error,
        );
        return defaultValue;
      }
      throw error;
    }
    const { orm } = connection;
    try {
      const rows = orm
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .all();
      const row = rows[0];
      if (!row) {
        return defaultValue;
      }
      return JSON.parse(row.value) as T;
    } catch (e) {
      logger.error(`Failed to get setting ${key}`, e);
      return defaultValue;
    }
  }

  static setSetting(key: string, value: any): void {
    let connection: ReturnType<typeof getCloudDb>;
    try {
      connection = getCloudDb();
    } catch (error) {
      if (isCloudStorageUnavailableError(error)) {
        logCloudStorageUnavailable(
          `Cloud settings storage is unavailable while writing "${key}"`,
          error,
        );
        return;
      }
      throw error;
    }

    const { orm } = connection;
    try {
      const stringValue = JSON.stringify(value);
      orm
        .insert(settings)
        .values({ key, value: stringValue })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: stringValue },
        })
        .run();
    } catch (error) {
      if (isCloudStorageUnavailableError(error)) {
        logCloudStorageUnavailable(
          `Cloud settings storage is unavailable while writing "${key}"`,
          error,
        );
        return;
      }
      logger.error(`Failed to set setting ${key}`, error);
    }
  }

  private static readTokenInfoFromDb(db: DrizzleExecutor): {
    accessToken: string;
    refreshToken: string;
  } {
    const unifiedValue = this.getItemValue(
      db,
      'antigravityUnifiedStateSync.oauthToken',
      'ide.itemTable.antigravityUnifiedStateSync.oauthToken',
    );

    let tokenInfo: { accessToken: string; refreshToken: string } | null = null;
    if (unifiedValue) {
      try {
        const unifiedBuffer = Buffer.from(unifiedValue, 'base64');
        const unifiedData = new Uint8Array(unifiedBuffer);
        tokenInfo = ProtobufUtils.extractOAuthTokenInfoFromUnifiedState(unifiedData);
      } catch (error) {
        logger.warn('SyncLocal: Failed to parse unified OAuth token', error);
      }
    }

    if (!tokenInfo) {
      const value = this.getItemValue(
        db,
        'jetskiStateSync.agentManagerInitState',
        'ide.itemTable.jetskiStateSync.agentManagerInitState',
      );

      if (!value) {
        const errorMsg =
          'No cloud account found in the IDE. Please log in to a Google account in Antigravity first.';
        logger.warn(`SyncLocal: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const buffer = Buffer.from(value, 'base64');
      const data = new Uint8Array(buffer);
      tokenInfo = ProtobufUtils.extractOAuthTokenInfo(data);
    }

    if (!tokenInfo) {
      const errorMsg =
        'No OAuth token found in IDE state. Please log in to a Google account in Antigravity first.';
      logger.warn(`SyncLocal: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    return tokenInfo;
  }

  private static async readTokenInfoWithRetry(dbPath: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SQLITE_MAX_RETRIES; attempt += 1) {
      const { raw, orm } = getIdeDb(dbPath, true);
      try {
        return this.readTokenInfoFromDb(orm);
      } catch (error) {
        lastError = error;
        if (isSqliteBusyError(error) && attempt < SQLITE_MAX_RETRIES) {
          logger.warn(`SQLite busy, retrying IDE read (attempt ${attempt})`, error);
          await sleep(SQLITE_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      } finally {
        raw.close();
      }
    }
    throw lastError;
  }

  static async syncFromIDE(): Promise<CloudAccount | null> {
    // Try all possible database paths
    const dbPaths = getAntigravityDbPaths();
    logger.info(`SyncLocal: Checking database paths: ${JSON.stringify(dbPaths)}`);

    const dbPath =
      dbPaths.find((p) => {
        logger.info(`SyncLocal: Checking path: ${p}, exists: ${fs.existsSync(p)}`);
        return fs.existsSync(p);
      }) ?? null;

    if (!dbPath) {
      const errorMsg = `Antigravity database not found. Please ensure Antigravity is installed. Checked paths: ${dbPaths.join(', ')}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    logger.info(`SyncLocal: Using Antigravity database at: ${dbPath}`);
    try {
      const tokenInfo = await this.readTokenInfoWithRetry(dbPath);

      // 3. Fetch User Info
      // We need to fetch user info to know who this token belongs to
      let userInfo;
      try {
        userInfo = await GoogleAPIService.getUserInfo(tokenInfo.accessToken);
      } catch (apiError: any) {
        const errorMsg = `Failed to validate token with the Google API. The token may be expired. Please log in again in Antigravity. Error: ${apiError.message}`;
        logger.error(`SyncLocal: ${errorMsg}`, apiError);
        throw new Error(errorMsg);
      }

      // 4. Check Duplicate & Construct Account
      // We use existing addAccount logic which does UPSERT (REPLACE)
      // Construct CloudAccount object
      const now = Math.floor(Date.now() / 1000);
      const account: CloudAccount = {
        id: uuidv4(), // Generate new ID if new, but check existing email
        provider: 'google',
        email: userInfo.email,
        name: userInfo.name,
        avatar_url: userInfo.picture,
        token: {
          access_token: tokenInfo.accessToken,
          refresh_token: tokenInfo.refreshToken,
          expires_in: 3600, // Unknown, assume 1 hour validity or let it refresh
          expiry_timestamp: now + 3600,
          token_type: 'Bearer',
          email: userInfo.email,
        },
        created_at: now,
        last_used: now,
        status: 'active',
        is_active: true, // It is the active one in IDE
      };

      // Check if email already exists to preserve ID
      const accounts = await this.getAccounts();
      const existing = accounts.find((a) => a.email === account.email);
      if (existing) {
        account.id = existing.id; // Keep existing ID
        account.created_at = existing.created_at;
      }

      await this.addAccount(account);
      return account;
    } catch (error) {
      logger.error('SyncLocal: Failed to sync account from IDE', error);
      throw error;
    }
  }
}
