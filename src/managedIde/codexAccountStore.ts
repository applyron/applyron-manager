import fs from 'fs';
import path from 'path';
import { asc, eq, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { openDrizzleConnection } from '../ipc/database/dbConnection';
import {
  ensureCloudDatabaseInitialized,
  isCloudStorageUnavailableError,
} from '../ipc/database/cloudHandler';
import { codexAccounts } from '../ipc/database/schema';
import { decrypt, encrypt } from '../utils/security';
import { getCloudAccountsDbPath } from '../utils/paths';
import { getCodexIdentityKey } from './codexIdentity';
import { CodexAccountRecordSchema } from './schemas';
import type {
  CodexAccountRecord,
  CodexAccountSnapshot,
  CodexAuthFile,
  CodexWorkspaceSummary,
} from './types';

interface PersistedCodexAccountRow {
  id: string;
  email: string | null;
  label: string | null;
  accountId: string;
  authMode: string | null;
  workspaceId: string | null;
  workspaceTitle: string | null;
  workspaceRole: string | null;
  workspaceIsDefault: number;
  identityKey: string;
  encryptedAuthJson: string;
  snapshotJson: string | null;
  isActive: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastRefreshedAt: number | null;
}

type CodexAccountRow = typeof codexAccounts.$inferSelect | PersistedCodexAccountRow;

const codexAccountsFallbackPath = path.join(
  path.dirname(getCloudAccountsDbPath()),
  'codex_accounts.json',
);

function getDb() {
  const dbPath = getCloudAccountsDbPath();
  ensureCloudDatabaseInitialized(dbPath);
  return openDrizzleConnection(dbPath, { readonly: false, fileMustExist: false });
}

function ensureFallbackDirectoryExists() {
  const directory = path.dirname(codexAccountsFallbackPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function sortRows<T extends Pick<PersistedCodexAccountRow, 'sortOrder' | 'createdAt'>>(
  rows: T[],
): T[] {
  return [...rows].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.createdAt - right.createdAt;
  });
}

function compareRowFreshness<
  T extends Pick<
    PersistedCodexAccountRow,
    'id' | 'isActive' | 'updatedAt' | 'lastRefreshedAt' | 'createdAt'
  >,
>(left: T, right: T): number {
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

function mapWorkspaceFromRow(
  row: Pick<
    PersistedCodexAccountRow,
    'workspaceId' | 'workspaceTitle' | 'workspaceRole' | 'workspaceIsDefault'
  >,
): CodexWorkspaceSummary | null {
  const workspaceId = row.workspaceId?.trim();
  if (!workspaceId) {
    return null;
  }

  return {
    id: workspaceId,
    title: row.workspaceTitle ?? null,
    role: row.workspaceRole ?? null,
    isDefault: row.workspaceIsDefault === 1,
  };
}

function getRowIdentityKey(
  row: Pick<
    PersistedCodexAccountRow,
    'accountId' | 'workspaceId' | 'workspaceTitle' | 'workspaceRole' | 'workspaceIsDefault'
  > &
    Partial<Pick<PersistedCodexAccountRow, 'identityKey'>>,
): string {
  const normalizedIdentityKey = row.identityKey?.trim();
  if (normalizedIdentityKey) {
    return normalizedIdentityKey;
  }

  return getCodexIdentityKey({
    accountId: row.accountId,
    workspace: mapWorkspaceFromRow({
      workspaceId: row.workspaceId ?? null,
      workspaceTitle: row.workspaceTitle ?? null,
      workspaceRole: row.workspaceRole ?? null,
      workspaceIsDefault: row.workspaceIsDefault ?? 0,
    }),
  });
}

function normalizeStoredRows(rows: PersistedCodexAccountRow[]): PersistedCodexAccountRow[] {
  const preferredByIdentityKey = new Map<string, PersistedCodexAccountRow>();

  for (const row of rows) {
    const normalizedRow: PersistedCodexAccountRow = {
      ...row,
      workspaceId: row.workspaceId ?? null,
      workspaceTitle: row.workspaceTitle ?? null,
      workspaceRole: row.workspaceRole ?? null,
      workspaceIsDefault: row.workspaceIsDefault ?? 0,
      identityKey: getRowIdentityKey(row),
    };
    const existing = preferredByIdentityKey.get(normalizedRow.identityKey);
    if (!existing || compareRowFreshness(row, existing) < 0) {
      preferredByIdentityKey.set(normalizedRow.identityKey, normalizedRow);
    }
  }

  const deduped = Array.from(preferredByIdentityKey.values());
  const activeRows = [...deduped].filter((row) => row.isActive === 1).sort(compareRowFreshness);
  const activeId = activeRows[0]?.id ?? null;

  return sortRows(
    deduped.map((row) => ({
      ...row,
      isActive: activeId && row.id === activeId ? 1 : 0,
    })),
  );
}

function getExistingRowByIdentityKey(
  rows: PersistedCodexAccountRow[],
  identityKey: string,
): PersistedCodexAccountRow | null {
  return normalizeStoredRows(rows).find((row) => row.identityKey === identityKey) ?? null;
}

function readFallbackRows(): PersistedCodexAccountRow[] {
  ensureFallbackDirectoryExists();

  if (!fs.existsSync(codexAccountsFallbackPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(codexAccountsFallbackPath, 'utf8')) as unknown;
    const rows = Array.isArray(parsed) ? (parsed as PersistedCodexAccountRow[]) : [];
    const normalizedRows = normalizeStoredRows(rows);

    if (JSON.stringify(rows) !== JSON.stringify(normalizedRows)) {
      writeFallbackRows(normalizedRows);
    }

    return normalizedRows;
  } catch {
    return [];
  }
}

function writeFallbackRows(rows: PersistedCodexAccountRow[]) {
  ensureFallbackDirectoryExists();
  fs.writeFileSync(
    codexAccountsFallbackPath,
    JSON.stringify(normalizeStoredRows(rows), null, 2),
    'utf8',
  );
}

function getNextSortOrderFromRows(rows: PersistedCodexAccountRow[]): number {
  if (rows.length === 0) {
    return 0;
  }

  return Math.max(...rows.map((row) => row.sortOrder)) + 1;
}

function shouldUseFallbackCodexStore(error: unknown): boolean {
  if (isCloudStorageUnavailableError(error)) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('better-sqlite3') ||
    error.message.includes('keytar') ||
    error.message.includes('NODE_MODULE_VERSION') ||
    error.message.includes('compiled against a different Node.js version')
  );
}

async function runWithFallback<T>(
  databaseAction: () => Promise<T> | T,
  fallbackAction: () => Promise<T> | T,
): Promise<T> {
  try {
    return await databaseAction();
  } catch (error) {
    if (!shouldUseFallbackCodexStore(error)) {
      throw error;
    }

    return await fallbackAction();
  }
}

function parseSnapshot(value: string | null): CodexAccountSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const result = CodexAccountRecordSchema.shape.snapshot.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function mapRowToRecord(row: CodexAccountRow): CodexAccountRecord {
  return {
    id: row.id,
    email: row.email ?? null,
    label: row.label ?? null,
    accountId: row.accountId,
    authMode: row.authMode ?? null,
    workspace: mapWorkspaceFromRow({
      workspaceId: row.workspaceId ?? null,
      workspaceTitle: row.workspaceTitle ?? null,
      workspaceRole: row.workspaceRole ?? null,
      workspaceIsDefault: row.workspaceIsDefault ?? 0,
    }),
    isActive: Boolean(row.isActive),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRefreshedAt: row.lastRefreshedAt ?? null,
    snapshot: parseSnapshot(row.snapshotJson),
  };
}

async function getNextSortOrder(): Promise<number> {
  const { raw, orm } = getDb();
  try {
    const rows = normalizeStoredRows(
      orm.select().from(codexAccounts).orderBy(asc(codexAccounts.sortOrder)).all(),
    );
    if (rows.length === 0) {
      return 0;
    }
    return Math.max(...rows.map((row) => row.sortOrder)) + 1;
  } finally {
    raw.close();
  }
}

export interface UpsertCodexAccountInput {
  existingId?: string | null;
  email: string | null;
  label?: string | null;
  accountId: string;
  authMode: string | null;
  workspace: CodexWorkspaceSummary | null;
  authFile: CodexAuthFile;
  snapshot: CodexAccountSnapshot | null;
  makeActive?: boolean;
}

export class CodexAccountStore {
  static async listAccounts(): Promise<CodexAccountRecord[]> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          const rows = normalizeStoredRows(
            orm
              .select()
              .from(codexAccounts)
              .orderBy(asc(codexAccounts.sortOrder), asc(codexAccounts.createdAt))
              .all(),
          );

          return rows.map(mapRowToRecord);
        } finally {
          raw.close();
        }
      },
      async () => sortRows(readFallbackRows()).map(mapRowToRecord),
    );
  }

  static async getAccount(id: string): Promise<CodexAccountRecord | null> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          const row = orm.select().from(codexAccounts).where(eq(codexAccounts.id, id)).get();
          return row ? mapRowToRecord(row) : null;
        } finally {
          raw.close();
        }
      },
      async () => {
        const row = readFallbackRows().find((item) => item.id === id);
        return row ? mapRowToRecord(row) : null;
      },
    );
  }

  static async getByAccountId(accountId: string): Promise<CodexAccountRecord | null> {
    return this.getByIdentityKey(getCodexIdentityKey({ accountId, workspace: null }));
  }

  static async getByIdentityKey(identityKey: string): Promise<CodexAccountRecord | null> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          const rows = orm
            .select()
            .from(codexAccounts)
            .where(eq(codexAccounts.identityKey, identityKey))
            .all();
          const row = getExistingRowByIdentityKey(rows, identityKey);
          return row ? mapRowToRecord(row) : null;
        } finally {
          raw.close();
        }
      },
      async () => {
        const row = getExistingRowByIdentityKey(readFallbackRows(), identityKey);
        return row ? mapRowToRecord(row) : null;
      },
    );
  }

  static async getActiveAccount(): Promise<CodexAccountRecord | null> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          const row =
            normalizeStoredRows(orm.select().from(codexAccounts).all()).find(
              (candidate) => candidate.isActive === 1,
            ) ?? null;
          return row ? mapRowToRecord(row) : null;
        } finally {
          raw.close();
        }
      },
      async () => {
        const row = readFallbackRows().find((item) => item.isActive === 1);
        return row ? mapRowToRecord(row) : null;
      },
    );
  }

  static async readAuthFile(
    id: string,
    options?: { suppressExpectedSecurityLogs?: boolean },
  ): Promise<CodexAuthFile | null> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          const row = orm
            .select({ encryptedAuthJson: codexAccounts.encryptedAuthJson })
            .from(codexAccounts)
            .where(eq(codexAccounts.id, id))
            .get();

          if (!row?.encryptedAuthJson) {
            return null;
          }

          const decrypted = await decrypt(row.encryptedAuthJson, {
            suppressAuthTagMismatchLog: options?.suppressExpectedSecurityLogs,
          });
          return JSON.parse(decrypted) as CodexAuthFile;
        } finally {
          raw.close();
        }
      },
      async () => {
        const row = readFallbackRows().find((item) => item.id === id);
        if (!row?.encryptedAuthJson) {
          return null;
        }

        const decrypted = await decrypt(row.encryptedAuthJson, {
          suppressAuthTagMismatchLog: options?.suppressExpectedSecurityLogs,
        });
        return JSON.parse(decrypted) as CodexAuthFile;
      },
    );
  }

  static async upsertAccount(input: UpsertCodexAccountInput): Promise<CodexAccountRecord> {
    const identityKey = getCodexIdentityKey({
      accountId: input.accountId,
      workspace: input.workspace,
    });
    const existingByIdentity = await this.getByIdentityKey(identityKey);
    const existingById =
      input.existingId && (!existingByIdentity || existingByIdentity.id !== input.existingId)
        ? await this.getAccount(input.existingId)
        : null;
    const existing =
      existingByIdentity ??
      (existingById && existingById.accountId === input.accountId ? existingById : null);
    const encryptedAuthJson = await encrypt(JSON.stringify(input.authFile));
    const now = Date.now();
    const id = existing?.id ?? uuidv4();

    return runWithFallback(
      async () => {
        const sortOrder = existing?.sortOrder ?? (await getNextSortOrder());
        const { raw, orm } = getDb();

        try {
          orm.transaction((tx) => {
            if (input.makeActive) {
              tx.update(codexAccounts).set({ isActive: 0, updatedAt: now }).run();
            }

            const payload = {
              id,
              email: input.email,
              label: input.label ?? existing?.label ?? null,
              accountId: input.accountId,
              authMode: input.authMode,
              workspaceId: input.workspace?.id ?? null,
              workspaceTitle: input.workspace?.title ?? null,
              workspaceRole: input.workspace?.role ?? null,
              workspaceIsDefault: input.workspace?.isDefault ? 1 : 0,
              identityKey,
              encryptedAuthJson,
              snapshotJson: input.snapshot ? JSON.stringify(input.snapshot) : null,
              isActive: input.makeActive ? 1 : existing?.isActive ? 1 : 0,
              sortOrder,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
              lastRefreshedAt: input.snapshot?.lastUpdatedAt ?? existing?.lastRefreshedAt ?? null,
            };

            const existingRows = tx
              .select()
              .from(codexAccounts)
              .where(or(eq(codexAccounts.identityKey, identityKey), eq(codexAccounts.id, id)))
              .all();
            const existingRow =
              existingRows.find((row) => row.id === id) ??
              getExistingRowByIdentityKey(existingRows, identityKey);

            for (const duplicateRow of existingRows) {
              if (duplicateRow.id === existingRow?.id) {
                continue;
              }

              tx.delete(codexAccounts).where(eq(codexAccounts.id, duplicateRow.id)).run();
            }

            if (existingRow) {
              tx.update(codexAccounts)
                .set(payload)
                .where(eq(codexAccounts.id, existingRow.id))
                .run();
            } else {
              tx.insert(codexAccounts).values(payload).run();
            }
          });

          const account = await this.getAccount(id);
          if (!account) {
            throw new Error('Failed to load saved Codex account');
          }
          return account;
        } finally {
          raw.close();
        }
      },
      async () => {
        const rows = readFallbackRows();
        const existingRow =
          rows.find((row) => row.id === id) ?? getExistingRowByIdentityKey(rows, identityKey);
        const sortOrder = existingRow?.sortOrder ?? getNextSortOrderFromRows(rows);

        if (input.makeActive) {
          for (const row of rows) {
            row.isActive = 0;
            row.updatedAt = now;
          }
        }

        const nextRow: PersistedCodexAccountRow = {
          id,
          email: input.email,
          label: input.label ?? existingRow?.label ?? null,
          accountId: input.accountId,
          authMode: input.authMode,
          workspaceId: input.workspace?.id ?? null,
          workspaceTitle: input.workspace?.title ?? null,
          workspaceRole: input.workspace?.role ?? null,
          workspaceIsDefault: input.workspace?.isDefault ? 1 : 0,
          identityKey,
          encryptedAuthJson,
          snapshotJson: input.snapshot ? JSON.stringify(input.snapshot) : null,
          isActive: input.makeActive ? 1 : existingRow?.isActive ? 1 : 0,
          sortOrder,
          createdAt: existingRow?.createdAt ?? now,
          updatedAt: now,
          lastRefreshedAt: input.snapshot?.lastUpdatedAt ?? existingRow?.lastRefreshedAt ?? null,
        };

        const nextRows = existingRow
          ? rows.map((row) => (getRowIdentityKey(row) === identityKey ? nextRow : row))
          : [...rows, nextRow];

        writeFallbackRows(nextRows);
        return mapRowToRecord(nextRow);
      },
    );
  }

  static async updateSnapshot(id: string, snapshot: CodexAccountSnapshot | null): Promise<void> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          orm
            .update(codexAccounts)
            .set({
              snapshotJson: snapshot ? JSON.stringify(snapshot) : null,
              lastRefreshedAt: snapshot?.lastUpdatedAt ?? null,
              updatedAt: Date.now(),
            })
            .where(eq(codexAccounts.id, id))
            .run();
        } finally {
          raw.close();
        }
      },
      async () => {
        const now = Date.now();
        const nextRows = readFallbackRows().map((row) =>
          row.id === id
            ? {
                ...row,
                snapshotJson: snapshot ? JSON.stringify(snapshot) : null,
                lastRefreshedAt: snapshot?.lastUpdatedAt ?? null,
                updatedAt: now,
              }
            : row,
        );
        writeFallbackRows(nextRows);
      },
    );
  }

  static async updateMetadata(
    id: string,
    updates: Partial<Pick<CodexAccountRecord, 'email' | 'label' | 'authMode'>>,
  ): Promise<void> {
    return runWithFallback(
      async () => {
        const payload: Record<string, string | number | null> = {
          updatedAt: Date.now(),
        };

        if ('email' in updates) {
          payload.email = updates.email ?? null;
        }

        if ('label' in updates) {
          payload.label = updates.label ?? null;
        }

        if ('authMode' in updates) {
          payload.authMode = updates.authMode ?? null;
        }

        const { raw, orm } = getDb();
        try {
          orm.update(codexAccounts).set(payload).where(eq(codexAccounts.id, id)).run();
        } finally {
          raw.close();
        }
      },
      async () => {
        const now = Date.now();
        const nextRows = readFallbackRows().map((row) => {
          if (row.id !== id) {
            return row;
          }

          return {
            ...row,
            email: 'email' in updates ? (updates.email ?? null) : row.email,
            label: 'label' in updates ? (updates.label ?? null) : row.label,
            authMode: 'authMode' in updates ? (updates.authMode ?? null) : row.authMode,
            updatedAt: now,
          };
        });

        writeFallbackRows(nextRows);
      },
    );
  }

  static async setActive(id: string): Promise<void> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        const now = Date.now();
        try {
          orm.transaction((tx) => {
            tx.update(codexAccounts).set({ isActive: 0, updatedAt: now }).run();
            tx.update(codexAccounts)
              .set({ isActive: 1, updatedAt: now })
              .where(eq(codexAccounts.id, id))
              .run();
          });
        } finally {
          raw.close();
        }
      },
      async () => {
        const now = Date.now();
        const nextRows = readFallbackRows().map((row) => ({
          ...row,
          isActive: row.id === id ? 1 : 0,
          updatedAt: now,
        }));
        writeFallbackRows(nextRows);
      },
    );
  }

  static async removeAccount(id: string): Promise<void> {
    const active = await this.getActiveAccount();
    if (active?.id === id) {
      throw new Error('ACTIVE_CODEX_ACCOUNT_DELETE_BLOCKED');
    }

    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          orm.delete(codexAccounts).where(eq(codexAccounts.id, id)).run();
        } finally {
          raw.close();
        }
      },
      async () => {
        const nextRows = readFallbackRows().filter((row) => row.id !== id);
        writeFallbackRows(nextRows);
      },
    );
  }

  static async replaceAuthFile(id: string, authFile: CodexAuthFile): Promise<void> {
    return runWithFallback(
      async () => {
        const { raw, orm } = getDb();
        try {
          orm
            .update(codexAccounts)
            .set({
              encryptedAuthJson: await encrypt(JSON.stringify(authFile)),
              updatedAt: Date.now(),
            })
            .where(eq(codexAccounts.id, id))
            .run();
        } finally {
          raw.close();
        }
      },
      async () => {
        const encryptedAuthJson = await encrypt(JSON.stringify(authFile));
        const now = Date.now();
        const nextRows = readFallbackRows().map((row) =>
          row.id === id
            ? {
                ...row,
                encryptedAuthJson,
                updatedAt: now,
              }
            : row,
        );

        writeFallbackRows(nextRows);
      },
    );
  }
}
