import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleStartupFatalError,
  initializeCriticalStartupDependencies,
  runCriticalStartupPhase,
  StartupFatalError,
} from '@/main/startupLifecycle';

describe('startupLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps cloud database initialization failures as fatal startup errors', async () => {
    await expect(
      initializeCriticalStartupDependencies({
        logger: {
          info: vi.fn(),
          error: vi.fn(),
        },
        initCloudAccountRepo: async () => {
          throw new Error('cloud broken');
        },
        initLegacyDatabase: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'STARTUP_CLOUD_DB_INIT_FAILED',
      userMessage: 'Cloud account storage failed to initialize.',
    });
  });

  it('wraps legacy database initialization failures as fatal startup errors', async () => {
    await expect(
      initializeCriticalStartupDependencies({
        logger: {
          info: vi.fn(),
          error: vi.fn(),
        },
        initCloudAccountRepo: async () => undefined,
        initLegacyDatabase: () => {
          throw new Error('legacy broken');
        },
      }),
    ).rejects.toMatchObject({
      code: 'STARTUP_LEGACY_DB_INIT_FAILED',
      userMessage: 'Managed IDE database failed to initialize.',
    });
  });

  it('stops the startup continuation path and routes fatal init failures to the handler', async () => {
    const continueStartup = vi.fn(async () => 'started');
    const onFatalError = vi.fn(async () => undefined);

    const result = await runCriticalStartupPhase({
      initializeCriticalDependencies: async () => {
        throw new StartupFatalError('STARTUP_CLOUD_DB_INIT_FAILED', 'Cloud init failed.');
      },
      continueStartup,
      onFatalError,
    });

    expect(result).toBeUndefined();
    expect(continueStartup).not.toHaveBeenCalled();
    expect(onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STARTUP_CLOUD_DB_INIT_FAILED',
      }),
    );
  });

  it('shows a fatal startup dialog, opens logs on demand, and exits the app', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 0, checkboxChecked: false }));
    const openPath = vi.fn(async () => undefined);
    const runShutdownCleanup = vi.fn();
    const exit = vi.fn();
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await handleStartupFatalError({
      error: new StartupFatalError(
        'STARTUP_UNEXPECTED_FAILURE',
        'Unexpected startup failure.',
        new Error('root cause'),
      ),
      logger,
      showMessageBox,
      openPath,
      getLogDir: () => 'C:\\logs',
      runShutdownCleanup,
      exit,
    });

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Startup failed',
        message: 'Applyron Manager could not start safely.',
        detail: expect.stringContaining('root cause'),
      }),
    );
    expect(openPath).toHaveBeenCalledWith('C:\\logs', 'log directory');
    expect(runShutdownCleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('still exits cleanly when the user closes the fatal dialog without opening logs', async () => {
    const showMessageBox = vi.fn(async () => ({ response: 1, checkboxChecked: false }));
    const openPath = vi.fn(async () => undefined);
    const runShutdownCleanup = vi.fn();
    const exit = vi.fn();

    await handleStartupFatalError({
      error: new StartupFatalError('STARTUP_UNEXPECTED_FAILURE', 'Unexpected startup failure.'),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
      showMessageBox,
      openPath,
      runShutdownCleanup,
      exit,
    });

    expect(openPath).not.toHaveBeenCalled();
    expect(runShutdownCleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
