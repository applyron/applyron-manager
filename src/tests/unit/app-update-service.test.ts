import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdateStatus } from '@/types/dashboard';
import type { ReleaseUpdateSource } from '@/config/managerBrand';

const mockGetVersion = vi.fn(() => '0.10.0');
const mockAppOn = vi.fn();
const mockAutoUpdaterOn = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockQuitAndInstall = vi.fn();
const mockUpdateElectronApp = vi.fn();
const mockInstallUpdateCertificatePinning = vi.fn();
const mockResolveReleaseUpdateSource = vi.fn<() => ReleaseUpdateSource>(() => ({
  type: 'static',
  baseUrl: 'https://updates.applyron.com/applyron-manager/win32/x64',
}));
const mockResolveTrustedStaticUpdateHost = vi.fn(() => 'updates.applyron.com');
const mockValidateReleaseUpdateSource = vi.fn((input) => input);
const mockClearQuitIntent = vi.fn();
const mockMarkUpdateInstallQuitIntent = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockMarkIdle = vi.fn();
const mockMarkStarting = vi.fn();
const mockMarkReady = vi.fn();
const mockMarkError = vi.fn();
const mockMarkUnsupported = vi.fn();
const mockMarkDegraded = vi.fn();

let mockIsPackaged = false;
const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

vi.mock('electron', () => ({
  app: {
    getVersion: () => mockGetVersion(),
    on: (...args: Parameters<typeof mockAppOn>) => mockAppOn(...args),
    get isPackaged() {
      return mockIsPackaged;
    },
  },
  autoUpdater: {
    on: (...args: Parameters<typeof mockAutoUpdaterOn>) => mockAutoUpdaterOn(...args),
    checkForUpdates: (...args: Parameters<typeof mockCheckForUpdates>) =>
      mockCheckForUpdates(...args),
    quitAndInstall: (...args: Parameters<typeof mockQuitAndInstall>) => mockQuitAndInstall(...args),
  },
  session: {
    defaultSession: {},
  },
}));

vi.mock('update-electron-app', () => ({
  UpdateSourceType: {
    StaticStorage: 'static',
    ElectronPublicUpdateService: 'github',
  },
  updateElectronApp: (...args: Parameters<typeof mockUpdateElectronApp>) =>
    mockUpdateElectronApp(...args),
}));

vi.mock('@/config/managerBrand', () => ({
  resolveReleaseUpdateSource: (...args: Parameters<typeof mockResolveReleaseUpdateSource>) =>
    mockResolveReleaseUpdateSource(...args),
  resolveTrustedStaticUpdateHost: (
    ...args: Parameters<typeof mockResolveTrustedStaticUpdateHost>
  ) => mockResolveTrustedStaticUpdateHost(...args),
  validateReleaseUpdateSource: (...args: Parameters<typeof mockValidateReleaseUpdateSource>) =>
    mockValidateReleaseUpdateSource(...args),
}));

vi.mock('@/services/updateCertificatePinning', () => ({
  TRUSTED_UPDATE_SPKI_PINS: ['primary-pin', 'backup-pin'],
  installUpdateCertificatePinning: (
    ...args: Parameters<typeof mockInstallUpdateCertificatePinning>
  ) => mockInstallUpdateCertificatePinning(...args),
}));

vi.mock('@/utils/quitIntent', () => ({
  clearQuitIntent: (...args: Parameters<typeof mockClearQuitIntent>) =>
    mockClearQuitIntent(...args),
  markUpdateInstallQuitIntent: (...args: Parameters<typeof mockMarkUpdateInstallQuitIntent>) =>
    mockMarkUpdateInstallQuitIntent(...args),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: (...args: Parameters<typeof mockLoggerInfo>) => mockLoggerInfo(...args),
    error: (...args: Parameters<typeof mockLoggerError>) => mockLoggerError(...args),
  },
}));

vi.mock('@/services/ServiceHealthRegistry', () => ({
  ServiceHealthRegistry: {
    markIdle: (...args: Parameters<typeof mockMarkIdle>) => mockMarkIdle(...args),
    markStarting: (...args: Parameters<typeof mockMarkStarting>) => mockMarkStarting(...args),
    markReady: (...args: Parameters<typeof mockMarkReady>) => mockMarkReady(...args),
    markError: (...args: Parameters<typeof mockMarkError>) => mockMarkError(...args),
    markUnsupported: (...args: Parameters<typeof mockMarkUnsupported>) =>
      mockMarkUnsupported(...args),
    markDegraded: (...args: Parameters<typeof mockMarkDegraded>) => mockMarkDegraded(...args),
  },
}));

async function loadService() {
  const { AppUpdateService } = await import('@/services/AppUpdateService');
  return AppUpdateService as unknown as {
    subscribe(listener: (status: AppUpdateStatus) => void): () => void;
    patchStatus(patch: Partial<AppUpdateStatus>): void;
    start(): void;
    getStatus(): AppUpdateStatus;
  };
}

describe('AppUpdateService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackaged = false;
    setPlatform(originalPlatform);
    mockResolveReleaseUpdateSource.mockReturnValue({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/win32/x64',
    });
    mockResolveTrustedStaticUpdateHost.mockReturnValue('updates.applyron.com');
    mockValidateReleaseUpdateSource.mockImplementation((input) => input);
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('notifies listeners on status changes and supports unsubscribe', async () => {
    const service = await loadService();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.patchStatus({
      status: 'checking',
      latestVersion: '0.10.1',
      lastCheckedAt: 123,
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'checking',
        currentVersion: '0.10.0',
        latestVersion: '0.10.1',
        lastCheckedAt: 123,
      }),
    );

    unsubscribe();
    service.patchStatus({
      status: 'ready_to_install',
      latestVersion: '0.10.1',
      lastCheckedAt: 456,
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reports an error when auto updates are started outside packaged builds', async () => {
    const service = await loadService();

    service.start();

    expect(mockUpdateElectronApp).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        status: 'error',
        message: 'Automatic updates are only available in packaged builds.',
      }),
    );
    expect(mockMarkError).toHaveBeenCalledWith(
      'updater',
      'Automatic updates are only available in packaged builds.',
    );
  });

  it('marks Linux packaged builds as unsupported', async () => {
    mockIsPackaged = true;
    setPlatform('linux');
    const service = await loadService();

    service.start();

    expect(mockUpdateElectronApp).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        status: 'unsupported',
        message: 'Automatic updates are not supported on this platform.',
      }),
    );
    expect(mockMarkUnsupported).toHaveBeenCalledWith(
      'updater',
      'Automatic updates are not supported on this platform.',
    );
  });

  it('initializes the trusted static update source on Windows packaged builds', async () => {
    mockIsPackaged = true;
    setPlatform('win32');
    const service = await loadService();

    service.start();

    expect(mockValidateReleaseUpdateSource).toHaveBeenCalledWith({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/win32/x64',
    });
    expect(mockInstallUpdateCertificatePinning).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.any(Object),
        defaultSession: expect.any(Object),
        trustedHost: 'updates.applyron.com',
        allowedPins: ['primary-pin', 'backup-pin'],
      }),
    );
    expect(mockUpdateElectronApp).toHaveBeenCalledWith({
      updateSource: {
        type: 'static',
        baseUrl: 'https://updates.applyron.com/applyron-manager/win32/x64',
      },
      notifyUser: false,
    });
    expect(mockMarkReady).toHaveBeenCalledWith('updater', 'Automatic updates are configured.');
  });

  it('initializes the trusted static update source on macOS packaged builds', async () => {
    mockIsPackaged = true;
    setPlatform('darwin');
    mockResolveReleaseUpdateSource.mockReturnValue({
      type: 'static',
      baseUrl: 'https://updates.applyron.com/applyron-manager/darwin/x64',
    });
    const service = await loadService();

    service.start();

    expect(mockUpdateElectronApp).toHaveBeenCalledWith({
      updateSource: {
        type: 'static',
        baseUrl: 'https://updates.applyron.com/applyron-manager/darwin/x64',
      },
      notifyUser: false,
    });
    expect(mockMarkReady).toHaveBeenCalledWith('updater', 'Automatic updates are configured.');
  });

  it('surfaces trusted-source validation failures as updater errors', async () => {
    mockIsPackaged = true;
    setPlatform('win32');
    mockValidateReleaseUpdateSource.mockImplementation(() => {
      throw new Error('Automatic updates are disabled because the static update host is invalid.');
    });
    const service = await loadService();

    service.start();

    expect(mockUpdateElectronApp).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        status: 'error',
        message: 'Automatic updates are disabled because the static update host is invalid.',
      }),
    );
    expect(mockMarkError).toHaveBeenCalledWith(
      'updater',
      'Automatic updates are disabled because the static update host is invalid.',
    );
  });

  it('surfaces certificate pinning failures as updater errors', async () => {
    mockIsPackaged = true;
    setPlatform('win32');
    mockInstallUpdateCertificatePinning.mockImplementation(() => {
      throw new Error(
        'Automatic updates are disabled because the update certificate pin set is incomplete.',
      );
    });
    const service = await loadService();

    service.start();

    expect(mockUpdateElectronApp).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        status: 'error',
        message:
          'Automatic updates are disabled because the update certificate pin set is incomplete.',
      }),
    );
  });
});
