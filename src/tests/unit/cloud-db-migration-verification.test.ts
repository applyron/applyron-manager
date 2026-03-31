import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockUnlinkSync,
  mockExec,
  mockClose,
  mockConfigureDatabase,
  mockPragma,
  mockPrepare,
  mockEncrypt,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockExec: vi.fn(),
  mockClose: vi.fn(),
  mockConfigureDatabase: vi.fn(),
  mockPragma: vi.fn(),
  mockPrepare: vi.fn(),
  mockEncrypt: vi.fn(async (value: string) => `enc:${value}`),
  mockLoggerError: vi.fn(),
}));

type MigrationRow = {
  id: string;
  tokenJson: string | null;
  quotaJson: string | null;
};

let migrationRows: MigrationRow[] = [];
let migrationUpdates: Array<{ values: Record<string, unknown>; condition: unknown }> = [];
let tableColumns: string[] = [];
let appliedMigrationVersions: number[] = [];

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    copyFileSync: mockCopyFileSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (_column: unknown, value: string) => ({ __id: value }),
  desc: (value: unknown) => value,
}));

vi.mock('../../ipc/database/dbConnection', async () => {
  const actual = await vi.importActual<typeof import('../../ipc/database/dbConnection')>(
    '../../ipc/database/dbConnection',
  );

  return {
    ...actual,
    configureDatabase: mockConfigureDatabase,
    openDrizzleConnection: () => ({
      raw: { close: mockClose },
      orm: {
        select: () => ({
          from: () => ({
            all: () => migrationRows,
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: (condition: unknown) => ({
              run: () => {
                migrationUpdates.push({ values, condition });
                return { changes: 1 };
              },
            }),
          }),
        }),
      },
    }),
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

vi.mock('../../utils/paths', () => ({
  getCloudAccountsDbPath: () => 'D:\\temp\\cloud_accounts.db',
  getAntigravityDbPaths: () => ['D:\\temp\\ide.db'],
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/security', () => ({
  encrypt: mockEncrypt,
  decryptWithMigration: vi.fn(),
}));

vi.mock('../../services/GoogleAPIService', () => ({
  GoogleAPIService: {
    getUserInfo: vi.fn(),
  },
}));

vi.mock('../../utils/antigravityVersion', () => ({
  getAntigravityVersion: vi.fn(),
  isNewVersion: vi.fn(),
}));

import { CloudAccountRepo, ensureCloudDatabaseInitialized } from '../../ipc/database/cloudHandler';

describe('migration verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    migrationRows = [];
    migrationUpdates = [];
    tableColumns = [
      'id',
      'provider',
      'email',
      'name',
      'avatar_url',
      'token_json',
      'quota_json',
      'created_at',
      'last_used',
      'status',
    ];
    appliedMigrationVersions = [];
    mockExistsSync.mockImplementation((targetPath: string) =>
      targetPath.endsWith('.migration-backup') ? false : true,
    );
    mockPragma.mockImplementation((value: string) => {
      if (value === 'table_info(accounts)') {
        return tableColumns.map((name) => ({ name }));
      }
      return [];
    });
    mockExec.mockImplementation((sql: string) => {
      const normalized = String(sql);
      if (normalized.includes('ADD COLUMN is_active')) {
        tableColumns.push('is_active');
      }
      if (normalized.includes('ADD COLUMN device_profile_json')) {
        tableColumns.push('device_profile_json');
      }
      if (normalized.includes('ADD COLUMN device_history_json')) {
        tableColumns.push('device_history_json');
      }
    });
    mockPrepare.mockImplementation((sql: string) => {
      const normalized = String(sql);
      if (normalized.includes('SELECT version FROM schema_migrations')) {
        return {
          all: () => appliedMigrationVersions.map((version) => ({ version })),
        };
      }
      if (normalized.includes('SELECT id, token_json AS tokenJson')) {
        return {
          all: () => migrationRows,
        };
      }
      if (normalized.includes('INSERT OR REPLACE INTO schema_migrations')) {
        return {
          run: (version: number) => {
            appliedMigrationVersions.push(version);
            return { changes: 1 };
          },
        };
      }
      if (normalized.includes('UPDATE accounts')) {
        return {
          run: (values: Record<string, unknown>) => {
            migrationUpdates.push({ values, condition: null });
            return { changes: 1 };
          },
        };
      }
      return {
        all: () => [],
        run: () => ({ changes: 1 }),
      };
    });
    CloudAccountRepo.shutdown();
  });

  it('applies ad-hoc schema migration for older account tables', () => {
    ensureCloudDatabaseInitialized('D:\\temp\\cloud_accounts.db');

    const executedSql = mockExec.mock.calls.map(([sql]) => String(sql)).join('\n');

    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS accounts');
    expect(executedSql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });

  it('applies versioned migrations and re-encrypts plaintext rows during repository init', async () => {
    migrationRows = [
      {
        id: 'legacy-plain',
        tokenJson: '{"access_token":"legacy"}',
        quotaJson: '{"models":{"gemini-3-flash":{"percentage":80}}}',
      },
      {
        id: 'already-encrypted',
        tokenJson: 'enc:already',
        quotaJson: 'enc:already',
      },
    ];

    await CloudAccountRepo.init();

    expect(appliedMigrationVersions).toEqual([1, 2, 3, 4]);
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      'D:\\temp\\cloud_accounts.db',
      'D:\\temp\\cloud_accounts.db.migration-backup',
    );
    expect(mockEncrypt).toHaveBeenCalledTimes(2);
    expect(mockEncrypt).toHaveBeenNthCalledWith(1, '{"access_token":"legacy"}');
    expect(mockEncrypt).toHaveBeenNthCalledWith(
      2,
      '{"models":{"gemini-3-flash":{"percentage":80}}}',
    );
    expect(migrationUpdates).toHaveLength(1);
    expect(migrationUpdates[0]?.values).toEqual({
      id: 'legacy-plain',
      tokenJson: 'enc:{"access_token":"legacy"}',
      quotaJson: 'enc:{"models":{"gemini-3-flash":{"percentage":80}}}',
    });
  });

  it('restores the backup if a migration step fails', async () => {
    migrationRows = [
      {
        id: 'legacy-plain',
        tokenJson: '{"access_token":"legacy"}',
        quotaJson: null,
      },
    ];
    mockExistsSync.mockImplementation((_targetPath: string) => true);
    mockEncrypt.mockRejectedValueOnce(new Error('encrypt_failed'));

    await expect(CloudAccountRepo.init()).rejects.toThrow('encrypt_failed');

    expect(mockCopyFileSync).toHaveBeenNthCalledWith(
      1,
      'D:\\temp\\cloud_accounts.db',
      'D:\\temp\\cloud_accounts.db.migration-backup',
    );
    expect(mockCopyFileSync).toHaveBeenNthCalledWith(
      2,
      'D:\\temp\\cloud_accounts.db.migration-backup',
      'D:\\temp\\cloud_accounts.db',
    );
  });
});
