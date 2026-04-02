import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockExec,
  mockClose,
  mockConfigureDatabase,
  mockPragma,
  mockPrepare,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExec: vi.fn(),
  mockClose: vi.fn(),
  mockConfigureDatabase: vi.fn(),
  mockPragma: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
  },
}));

vi.mock('../../ipc/database/dbConnection', async () => {
  const actual = await vi.importActual<typeof import('../../ipc/database/dbConnection')>(
    '../../ipc/database/dbConnection',
  );

  return {
    ...actual,
    configureDatabase: mockConfigureDatabase,
  };
});

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    exec = mockExec;
    close = mockClose;
    pragma = mockPragma;
    prepare = mockPrepare;
  },
}));

import { ensureCloudDatabaseInitialized } from '../../ipc/database/cloudHandler';

describe('ensureCloudDatabaseInitialized', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockPragma.mockImplementation((value: string) => {
      if (value === 'table_info(codex_accounts)') {
        return [{ name: 'identity_key' }];
      }
      return [];
    });
    mockPrepare.mockReturnValue({
      all: () => [],
      run: () => ({ changes: 1 }),
    });
  });

  it('creates the Codex account table and indexes on initialization', () => {
    ensureCloudDatabaseInitialized('D:\\temp\\cloud_accounts.db');

    const executedSql = mockExec.mock.calls.map(([sql]) => String(sql)).join('\n');

    expect(mockConfigureDatabase).toHaveBeenCalledTimes(1);
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS accounts');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS settings');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS codex_accounts');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(executedSql).toContain('idx_codex_accounts_identity_key');
    expect(executedSql).toContain('idx_codex_accounts_sort_order');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('creates the parent directory when the database folder is missing', () => {
    mockExistsSync.mockReturnValue(false);

    ensureCloudDatabaseInitialized('D:\\temp\\nested\\cloud_accounts.db');

    expect(mockMkdirSync).toHaveBeenCalledWith('D:\\temp\\nested', { recursive: true });
  });
});
