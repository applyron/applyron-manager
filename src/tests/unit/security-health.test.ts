import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    decryptString: vi.fn(),
    encryptString: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => 'C:\\test'),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(async (_path: string, encoding?: string) => {
      if (encoding === 'utf8') {
        const error = new Error('not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }

      const error = new Error('not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  },
}));

vi.mock('keytar', () => ({
  default: {
    findCredentials: vi.fn(async () => {
      throw new Error('keytar unavailable');
    }),
    getPassword: vi.fn(async () => null),
    setPassword: vi.fn(),
  },
}));

describe('security service health', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { ServiceHealthRegistry } = await import('../../services/ServiceHealthRegistry');
    ServiceHealthRegistry.resetForTesting();
  });

  it('marks credential storage as degraded when file fallback is used', async () => {
    const { encrypt } = await import('../../utils/security');
    const { ServiceHealthRegistry } = await import('../../services/ServiceHealthRegistry');

    await expect(encrypt('secret')).resolves.toMatch(/^[a-f0-9]+:/);

    const security = ServiceHealthRegistry.getSummary().services.find(
      (item) => item.id === 'security',
    );

    expect(security?.state).toBe('error');
    expect(security?.message).toContain('Degraded security');
  });
});
