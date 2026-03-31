import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockReadFileSync,
  mockSetErrorReportingEnabled,
  mockSetSentryReporter,
  mockLoggerError,
  mockMarkIdle,
  mockMarkError,
  mockMarkReady,
  mockGetVersion,
  mockSentryInit,
  mockSentryWithScope,
  mockSentryCaptureException,
  mockSentryCaptureMessage,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockSetErrorReportingEnabled: vi.fn(),
  mockSetSentryReporter: vi.fn(),
  mockLoggerError: vi.fn(),
  mockMarkIdle: vi.fn(),
  mockMarkError: vi.fn(),
  mockMarkReady: vi.fn(),
  mockGetVersion: vi.fn(() => '0.10.0'),
  mockSentryInit: vi.fn(),
  mockSentryWithScope: vi.fn(),
  mockSentryCaptureException: vi.fn(),
  mockSentryCaptureMessage: vi.fn(),
}));

let mockIsPackaged = false;

vi.mock('electron', () => ({
  app: {
    getVersion: () => mockGetVersion(),
    get isPackaged() {
      return mockIsPackaged;
    },
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
    readFileSync: (...args: Parameters<typeof mockReadFileSync>) => mockReadFileSync(...args),
  },
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
  readFileSync: (...args: Parameters<typeof mockReadFileSync>) => mockReadFileSync(...args),
}));

vi.mock('@/config/managerBrand', () => ({
  MANAGER_PRODUCT_SLUG: 'applyron-manager',
  getManagerConfigPath: vi.fn(() => 'C:\\config\\gui_config.json'),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    error: (...args: Parameters<typeof mockLoggerError>) => mockLoggerError(...args),
    setErrorReportingEnabled: (...args: Parameters<typeof mockSetErrorReportingEnabled>) =>
      mockSetErrorReportingEnabled(...args),
    setSentryReporter: (...args: Parameters<typeof mockSetSentryReporter>) =>
      mockSetSentryReporter(...args),
  },
}));

vi.mock('@/services/ServiceHealthRegistry', () => ({
  ServiceHealthRegistry: {
    markIdle: (...args: Parameters<typeof mockMarkIdle>) => mockMarkIdle(...args),
    markError: (...args: Parameters<typeof mockMarkError>) => mockMarkError(...args),
    markReady: (...args: Parameters<typeof mockMarkReady>) => mockMarkReady(...args),
  },
}));

vi.mock('@sentry/electron/main', () => ({
  init: (...args: Parameters<typeof mockSentryInit>) => mockSentryInit(...args),
  withScope: (...args: Parameters<typeof mockSentryWithScope>) => mockSentryWithScope(...args),
  captureException: (...args: Parameters<typeof mockSentryCaptureException>) =>
    mockSentryCaptureException(...args),
  captureMessage: (...args: Parameters<typeof mockSentryCaptureMessage>) =>
    mockSentryCaptureMessage(...args),
}));

async function loadInstrumentModule(config: {
  privacy_consent_asked?: boolean;
  error_reporting_enabled?: boolean;
}) {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify(config));

  const instrumentModule = await import('@/instrument');
  await instrumentModule.initializeErrorReportingPromise;
  return instrumentModule;
}

describe('instrument error reporting bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackaged = false;
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it('keeps monitoring idle when anonymous error reporting consent is disabled', async () => {
    await loadInstrumentModule({
      privacy_consent_asked: false,
      error_reporting_enabled: true,
    });

    expect(mockSetErrorReportingEnabled).toHaveBeenCalledWith(false);
    expect(mockSetSentryReporter).toHaveBeenCalledWith(null);
    expect(mockMarkIdle).toHaveBeenCalledWith(
      'monitoring',
      'Anonymous error reporting is disabled.',
    );
    expect(mockMarkError).not.toHaveBeenCalled();
  });

  it('marks monitoring as an error when packaged reporting is enabled without SENTRY_DSN', async () => {
    mockIsPackaged = true;

    await loadInstrumentModule({
      privacy_consent_asked: true,
      error_reporting_enabled: true,
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      'Anonymous error reporting is enabled, but SENTRY_DSN is missing.',
    );
    expect(mockSetErrorReportingEnabled).toHaveBeenCalledWith(false);
    expect(mockSetSentryReporter).toHaveBeenCalledWith(null);
    expect(mockMarkError).toHaveBeenCalledWith(
      'monitoring',
      'Anonymous error reporting is enabled, but SENTRY_DSN is missing.',
    );
  });

  it('initializes Sentry when consent is enabled and SENTRY_DSN is configured', async () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/1';
    mockIsPackaged = true;

    await loadInstrumentModule({
      privacy_consent_asked: true,
      error_reporting_enabled: true,
    });

    expect(mockSetErrorReportingEnabled).toHaveBeenCalledWith(true);
    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockMarkReady).toHaveBeenCalledWith(
      'monitoring',
      'Anonymous error reporting is enabled.',
    );
    expect(mockSetSentryReporter).toHaveBeenCalledWith(expect.any(Function));
  });
});
