import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockUnlinkSync,
  mockOpenDrizzleConnection,
  mockConfigureDatabase,
  mockExec,
  mockClose,
  mockPragma,
  mockPrepare,
  mockEncrypt,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockOpenDrizzleConnection: vi.fn(),
  mockConfigureDatabase: vi.fn(),
  mockExec: vi.fn(),
  mockClose: vi.fn(),
  mockPragma: vi.fn(),
  mockPrepare: vi.fn(),
  mockEncrypt: vi.fn(async (value: string) => `enc:${value}`),
}));

type MockCloudConnection = {
  raw: { close: ReturnType<typeof vi.fn> };
  orm: {
    select: () => {
      from: () => {
        where: (condition: { __match?: string }) => { all: () => Array<{ value: string }> };
        orderBy: () => { all: () => [] };
        all: () => [];
      };
    };
    insert: () => {
      values: (values: Record<string, unknown>) => {
        onConflictDoUpdate: () => { run: () => { changes: number } };
      };
    };
    update: () => {
      set: (values: Record<string, unknown>) => {
        where: (condition: { __match?: string }) => { run: () => { changes: number } };
        run: () => { changes: number };
      };
    };
    delete: () => {
      where: (condition: { __match?: string }) => { run: () => { changes: number } };
    };
    transaction: (fn: (tx: MockCloudConnection['orm']) => void) => void;
  };
};

let settingsStore: Record<string, string>;
let accountStore: Record<string, Record<string, unknown>>;
let openedConnections: MockCloudConnection[];

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    copyFileSync: mockCopyFileSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (_column: unknown, value: string) => ({ __match: value }),
  desc: (value: unknown) => value,
}));

vi.mock('../../ipc/database/dbConnection', async () => {
  const actual = await vi.importActual<typeof import('../../ipc/database/dbConnection')>(
    '../../ipc/database/dbConnection',
  );

  return {
    ...actual,
    configureDatabase: mockConfigureDatabase,
    openDrizzleConnection: mockOpenDrizzleConnection,
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
  getCloudAccountsDbPath: () => 'cloud.db',
  getAntigravityDbPaths: () => ['ide.db'],
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/security', () => ({
  encrypt: mockEncrypt,
  decryptWithMigration: vi.fn(async (value: string | null) => ({
    decryptedValue: value?.startsWith('enc:') ? value.slice(4) : value,
    usedFallback: null,
    shouldMigrate: false,
  })),
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

function createConnection(): MockCloudConnection {
  const orm: MockCloudConnection['orm'] = {
    select: () => ({
      from: () => ({
        where: (condition: { __match?: string }) => ({
          all: () => {
            const key = condition.__match ?? '';
            const value = settingsStore[key];
            return value === undefined ? [] : [{ value }];
          },
        }),
        orderBy: () => ({
          all: () => [],
        }),
        all: () => [],
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          run: () => {
            if ('key' in values && 'value' in values) {
              settingsStore[String(values.key)] = String(values.value);
            } else if ('id' in values) {
              accountStore[String(values.id)] = values;
            }
            return { changes: 1 };
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: { __match?: string }) => ({
          run: () => {
            const match = condition.__match ?? '';
            if (match in settingsStore && 'value' in values) {
              settingsStore[match] = String(values.value);
            }
            if (match in accountStore) {
              accountStore[match] = {
                ...accountStore[match],
                ...values,
              };
            }
            return { changes: 1 };
          },
        }),
        run: () => ({ changes: 1 }),
      }),
    }),
    delete: () => ({
      where: (condition: { __match?: string }) => ({
        run: () => {
          delete accountStore[condition.__match ?? ''];
          return { changes: 1 };
        },
      }),
    }),
    transaction: (fn: (tx: MockCloudConnection['orm']) => void) => {
      fn(orm);
    },
  };

  return {
    raw: { close: vi.fn() },
    orm,
  };
}

describe('CloudAccountRepo lifecycle', () => {
  beforeEach(() => {
    settingsStore = {};
    accountStore = {};
    openedConnections = [];

    mockExistsSync.mockImplementation((targetPath: string) =>
      targetPath.endsWith('.migration-backup') ? false : true,
    );
    mockPragma.mockImplementation((value: string) => {
      if (value === 'table_info(accounts)') {
        return [
          { name: 'id' },
          { name: 'provider' },
          { name: 'email' },
          { name: 'name' },
          { name: 'avatar_url' },
          { name: 'token_json' },
          { name: 'quota_json' },
          { name: 'created_at' },
          { name: 'last_used' },
          { name: 'status' },
          { name: 'is_active' },
          { name: 'device_profile_json' },
          { name: 'device_history_json' },
        ];
      }
      if (value === 'table_info(codex_accounts)') {
        return [
          { name: 'identity_key' },
          { name: 'sort_order' },
          { name: 'is_active' },
          { name: 'hydration_state' },
        ];
      }
      return [];
    });
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT version FROM schema_migrations')) {
        return {
          all: () => [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }],
        };
      }

      return {
        all: () => [],
        run: () => ({ changes: 1 }),
      };
    });
    mockOpenDrizzleConnection.mockImplementation(() => {
      const connection = createConnection();
      openedConnections.push(connection);
      return connection;
    });
  });

  afterEach(async () => {
    const { CloudAccountRepo } = await import('../../ipc/database/cloudHandler');
    CloudAccountRepo.shutdown();
    vi.clearAllMocks();
  });

  it('reuses the shared owner connection across settings and account operations', async () => {
    const { CloudAccountRepo } = await import('../../ipc/database/cloudHandler');

    await CloudAccountRepo.init();
    CloudAccountRepo.setSetting('ui.language', 'tr');

    await CloudAccountRepo.addAccount({
      id: 'cloud-1',
      provider: 'google',
      email: 'cloud@example.com',
      name: 'Cloud User',
      avatar_url: undefined,
      token: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        expiry_timestamp: 7200,
        token_type: 'Bearer',
      },
      created_at: 1,
      last_used: 1,
      status: 'active',
      is_active: false,
    });

    CloudAccountRepo.removeAccount('cloud-1');

    expect(CloudAccountRepo.getSetting('ui.language', 'en')).toBe('tr');
    expect(openedConnections).toHaveLength(1);
    expect(openedConnections[0]?.raw.close).not.toHaveBeenCalled();
  });

  it('closes the owner connection on shutdown and reopens it on the next init', async () => {
    const { CloudAccountRepo } = await import('../../ipc/database/cloudHandler');

    await CloudAccountRepo.init();
    const firstConnection = openedConnections[0];

    CloudAccountRepo.shutdown();

    expect(firstConnection?.raw.close).toHaveBeenCalledTimes(1);

    await CloudAccountRepo.init();

    expect(openedConnections).toHaveLength(2);
    expect(openedConnections[1]).not.toBe(firstConnection);
  });
});
