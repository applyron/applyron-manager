import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import { CODEX_GLOBAL_STATE_DB_TIMEOUT_MS, CODEX_GLOBAL_STATE_LOCK_BACKOFF_MS } from './constants';
import { getFileUpdatedAt } from './runtimeEnvironment';
import type { CodexGlobalStateMutationResult, CodexGlobalStateSnapshot } from './types';

const codexGlobalStateLockUntilByPath = new Map<string, number>();

export function resetCodexGlobalStateLockTrackingForTesting(): void {
  codexGlobalStateLockUntilByPath.clear();
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

function createEmptyCodexGlobalStateSnapshot(dbPath: string | null): CodexGlobalStateSnapshot {
  return {
    rawValue: null,
    codexCloudAccess: null,
    defaultServiceTier: null,
    agentMode: null,
    updatedAt: getFileUpdatedAt(dbPath),
  };
}

function isSqliteLockError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  if (candidate.code === 'SQLITE_BUSY' || candidate.code === 'SQLITE_LOCKED') {
    return true;
  }

  if (typeof candidate.message === 'string') {
    const normalizedMessage = candidate.message.toLowerCase();
    return (
      normalizedMessage.includes('sqlite_busy') ||
      normalizedMessage.includes('sqlite_locked') ||
      normalizedMessage.includes('database is locked')
    );
  }

  return false;
}

function shouldSkipCodexGlobalStateAccess(dbPath: string | null): boolean {
  if (!dbPath) {
    return false;
  }

  const lockedUntil = codexGlobalStateLockUntilByPath.get(dbPath) ?? 0;
  if (lockedUntil <= Date.now()) {
    codexGlobalStateLockUntilByPath.delete(dbPath);
    return false;
  }

  return true;
}

function clearCodexGlobalStateLock(dbPath: string | null): void {
  if (dbPath) {
    codexGlobalStateLockUntilByPath.delete(dbPath);
  }
}

function markCodexGlobalStateLocked(
  dbPath: string,
  operation: 'read' | 'write' | 'clear',
  error: unknown,
): void {
  codexGlobalStateLockUntilByPath.set(dbPath, Date.now() + CODEX_GLOBAL_STATE_LOCK_BACKOFF_MS);
  logger.warn(`VS Code Codex global state ${operation} skipped because state.vscdb is locked`, error);
}

export function readCodexGlobalStateSnapshot(dbPath: string | null): CodexGlobalStateSnapshot {
  if (!dbPath) {
    return createEmptyCodexGlobalStateSnapshot(null);
  }

  if (shouldSkipCodexGlobalStateAccess(dbPath)) {
    return createEmptyCodexGlobalStateSnapshot(dbPath);
  }

  let database: InstanceType<typeof Database> | null = null;
  try {
    database = new Database(dbPath, {
      readonly: true,
      timeout: CODEX_GLOBAL_STATE_DB_TIMEOUT_MS,
    });
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = 'openai.chatgpt'")
      .get() as { value?: string } | undefined;

    if (!row?.value) {
      clearCodexGlobalStateLock(dbPath);
      return createEmptyCodexGlobalStateSnapshot(dbPath);
    }

    const parsed = JSON.parse(row.value) as {
      [key: string]: unknown;
      ['persisted-atom-state']?: Record<string, unknown>;
    };

    const atomState = getRecordCandidate(parsed['persisted-atom-state']);
    const rootState = parsed as Record<string, unknown>;

    clearCodexGlobalStateLock(dbPath);
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
    if (isSqliteLockError(error) && dbPath) {
      markCodexGlobalStateLocked(dbPath, 'read', error);
      return createEmptyCodexGlobalStateSnapshot(dbPath);
    }

    logger.warn('Failed to read VS Code Codex global state hints', error);
    return createEmptyCodexGlobalStateSnapshot(dbPath);
  } finally {
    database?.close();
  }
}

export function writeCodexGlobalStateSnapshot(
  dbPath: string | null,
  rawValue: string,
): CodexGlobalStateMutationResult {
  if (!dbPath) {
    return { ok: false, reason: 'missing' };
  }

  if (shouldSkipCodexGlobalStateAccess(dbPath)) {
    return { ok: false, reason: 'locked' };
  }

  let database: InstanceType<typeof Database> | null = null;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    database = new Database(dbPath, {
      timeout: CODEX_GLOBAL_STATE_DB_TIMEOUT_MS,
    });
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
    clearCodexGlobalStateLock(dbPath);
    return { ok: true, reason: 'success' };
  } catch (error) {
    if (isSqliteLockError(error)) {
      markCodexGlobalStateLocked(dbPath, 'write', error);
      return { ok: false, reason: 'locked' };
    }

    logger.warn('Failed to write VS Code Codex global state hints', error);
    return { ok: false, reason: 'error' };
  } finally {
    database?.close();
  }
}

export function clearCodexGlobalStateSnapshot(
  dbPath: string | null,
): CodexGlobalStateMutationResult {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { ok: false, reason: 'missing' };
  }

  if (shouldSkipCodexGlobalStateAccess(dbPath)) {
    return { ok: false, reason: 'locked' };
  }

  let database: InstanceType<typeof Database> | null = null;
  try {
    database = new Database(dbPath, {
      timeout: CODEX_GLOBAL_STATE_DB_TIMEOUT_MS,
    });
    database.prepare("DELETE FROM ItemTable WHERE key = 'openai.chatgpt'").run();
    clearCodexGlobalStateLock(dbPath);
    return { ok: true, reason: 'success' };
  } catch (error) {
    if (isSqliteLockError(error)) {
      markCodexGlobalStateLocked(dbPath, 'clear', error);
      return { ok: false, reason: 'locked' };
    }

    logger.warn('Failed to clear VS Code Codex global state snapshot', error);
    return { ok: false, reason: 'error' };
  } finally {
    database?.close();
  }
}
