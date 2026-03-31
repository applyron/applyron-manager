import { app, dialog } from 'electron';
import { getAgentDir } from '@/utils/paths';
import { openPathOrThrow } from '@/utils/openPath';
import { logger as defaultLogger } from '@/utils/logger';

type StartupLogger = Pick<typeof defaultLogger, 'info' | 'error'>;

export class StartupFatalError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    cause?: unknown,
  ) {
    super(`${code}|${userMessage}`);
    this.name = 'StartupFatalError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
      });
    }
  }
}

export async function initializeCriticalStartupDependencies(input: {
  logger?: StartupLogger;
  initCloudAccountRepo: () => Promise<void>;
  initLegacyDatabase: () => void | Promise<void>;
}): Promise<void> {
  const { initCloudAccountRepo, initLegacyDatabase, logger = defaultLogger } = input;

  logger.info('Step: Initialize CloudAccountRepo');
  try {
    await initCloudAccountRepo();
  } catch (error) {
    throw new StartupFatalError(
      'STARTUP_CLOUD_DB_INIT_FAILED',
      'Cloud account storage failed to initialize.',
      error,
    );
  }

  logger.info('Step: Initialize managed IDE DB (WAL mode)');
  try {
    await initLegacyDatabase();
  } catch (error) {
    throw new StartupFatalError(
      'STARTUP_LEGACY_DB_INIT_FAILED',
      'Managed IDE database failed to initialize.',
      error,
    );
  }
}

export async function handleStartupFatalError(input: {
  error: StartupFatalError;
  logger?: StartupLogger;
  runShutdownCleanup: () => void | Promise<void>;
  exit?: (code: number) => void;
  openPath?: (targetPath: string, context: string) => Promise<void>;
  showMessageBox?: typeof dialog.showMessageBox;
  getLogDir?: () => string;
}): Promise<void> {
  const {
    error,
    runShutdownCleanup,
    logger = defaultLogger,
    exit = (code) => app.exit(code),
    openPath = openPathOrThrow,
    showMessageBox = dialog.showMessageBox.bind(dialog),
    getLogDir = getAgentDir,
  } = input;

  logger.error(`Fatal startup error: ${error.code}`, error);

  const logDir = getLogDir();
  const detailParts = [error.userMessage];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message.trim()) {
    detailParts.push(cause.message);
  }

  const response = await showMessageBox({
    type: 'error',
    title: 'Startup failed',
    message: 'Applyron Manager could not start safely.',
    detail: detailParts.join('\n\n'),
    buttons: ['Open Log Directory', 'Close'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });

  if (response.response === 0) {
    await openPath(logDir, 'log directory').catch((openError) => {
      logger.error('Failed to open log directory after fatal startup error', openError);
    });
  }

  await runShutdownCleanup();
  exit(1);
}

export async function runCriticalStartupPhase<T>(input: {
  initializeCriticalDependencies: () => Promise<void>;
  continueStartup: () => Promise<T>;
  onFatalError: (error: StartupFatalError) => Promise<void>;
}): Promise<T | undefined> {
  const { initializeCriticalDependencies, continueStartup, onFatalError } = input;

  try {
    await initializeCriticalDependencies();
  } catch (error) {
    if (error instanceof StartupFatalError) {
      await onFatalError(error);
      return undefined;
    }

    throw error;
  }

  return continueStartup();
}
