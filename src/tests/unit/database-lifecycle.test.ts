import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockOpenDrizzleConnection,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockOpenDrizzleConnection: vi.fn(),
}));

type MockConnection = {
  path: string;
  raw: { close: ReturnType<typeof vi.fn> };
  orm: {
    select: () => {
      from: () => {
        where: (condition: { __key?: string }) => { all: () => Array<{ value: string }> };
      };
    };
    insert: () => {
      values: (values: { key: string; value: string }) => {
        onConflictDoUpdate: () => { run: () => { changes: number } };
      };
    };
    transaction: (fn: (tx: MockConnection['orm']) => void) => void;
  };
};

let readValues: Record<string, string>;
let writes: Array<{ path: string; key: string; value: string }>;
let openedConnections: MockConnection[];

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (_column: unknown, value: string) => ({ __key: value }),
}));

vi.mock('../../ipc/database/dbConnection', () => ({
  openDrizzleConnection: mockOpenDrizzleConnection,
}));

vi.mock('../../utils/paths', () => ({
  getAntigravityDbPaths: () => ['shared-db.vscdb'],
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createConnection(dbPath: string): MockConnection {
  const orm: MockConnection['orm'] = {
    select: () => ({
      from: () => ({
        where: (condition: { __key?: string }) => ({
          all: () => {
            const key = condition.__key ?? '';
            const value = readValues[key];
            return value === undefined ? [] : [{ value }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: { key: string; value: string }) => ({
        onConflictDoUpdate: () => ({
          run: () => {
            writes.push({ path: dbPath, key: values.key, value: values.value });
            return { changes: 1 };
          },
        }),
      }),
    }),
    transaction: (fn: (tx: MockConnection['orm']) => void) => {
      fn(orm);
    },
  };

  return {
    path: dbPath,
    raw: { close: vi.fn() },
    orm,
  };
}

describe('database handler lifecycle', () => {
  beforeEach(() => {
    readValues = {
      antigravityAuthStatus: JSON.stringify({
        user: { email: 'shared@example.com', name: 'Shared User' },
      }),
    };
    writes = [];
    openedConnections = [];

    mockExistsSync.mockImplementation((targetPath: string) => !targetPath.endsWith('.backup'));
    mockOpenDrizzleConnection.mockImplementation((dbPath: string) => {
      const connection = createConnection(dbPath);
      openedConnections.push(connection);
      return connection;
    });
  });

  afterEach(async () => {
    const { shutdownDatabase } = await import('../../ipc/database/handler');
    shutdownDatabase();
    vi.clearAllMocks();
  });

  it('reuses the shared owner connection for hot-path reads and closes it on shutdown', async () => {
    const { backupAccount, getCurrentAccountInfo, initDatabase, shutdownDatabase } = await import(
      '../../ipc/database/handler'
    );

    initDatabase();
    const info = getCurrentAccountInfo();
    const backup = backupAccount({
      id: 'account-1',
      name: 'Shared User',
      email: 'shared@example.com',
      created_at: '2024-01-01T00:00:00.000Z',
      last_used: '2024-01-01T00:00:00.000Z',
    });

    expect(info.email).toBe('shared@example.com');
    expect(backup.account.email).toBe('shared@example.com');
    expect(openedConnections).toHaveLength(1);
    expect(openedConnections[0]?.raw.close).not.toHaveBeenCalled();

    shutdownDatabase();

    expect(openedConnections[0]?.raw.close).toHaveBeenCalledTimes(1);
  });

  it('uses scoped connections for explicit restore paths and closes them immediately', async () => {
    const { restoreAccount } = await import('../../ipc/database/handler');

    restoreAccount({
      version: '1.0',
      account: {
        id: 'account-1',
        name: 'Scoped User',
        email: 'scoped@example.com',
        created_at: '2024-01-01T00:00:00.000Z',
        last_used: '2024-01-01T00:00:00.000Z',
      },
      data: {
        'antigravityUnifiedStateSync.oauthToken': 'unified',
      },
    });

    expect(openedConnections).toHaveLength(1);
    expect(openedConnections[0]?.path).toBe('shared-db.vscdb');
    expect(openedConnections[0]?.raw.close).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      {
        path: 'shared-db.vscdb',
        key: 'antigravityUnifiedStateSync.oauthToken',
        value: 'unified',
      },
    ]);
  });
});
