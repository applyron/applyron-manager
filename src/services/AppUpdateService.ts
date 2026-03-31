import { app, autoUpdater, session } from 'electron';
import { UpdateSourceType, updateElectronApp } from 'update-electron-app';
import {
  resolveReleaseUpdateSource,
  resolveTrustedStaticUpdateHost,
  validateReleaseUpdateSource,
} from '@/config/managerBrand';
import type { AppUpdateStatus } from '@/types/dashboard';
import { clearQuitIntent, markUpdateInstallQuitIntent } from '@/utils/quitIntent';
import { logger } from '@/utils/logger';
import { ServiceHealthRegistry } from './ServiceHealthRegistry';
import {
  TRUSTED_UPDATE_SPKI_PINS,
  installUpdateCertificatePinning,
} from './updateCertificatePinning';

const SUPPORTED_AUTO_UPDATE_PLATFORMS = new Set(['win32', 'darwin']);

function createInitialStatus(): AppUpdateStatus {
  return {
    status: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    lastCheckedAt: null,
    message: null,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Update check failed.';
}

function normalizeVersionCandidate(candidate: unknown): string | null {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }

  return null;
}

function extractLatestVersion(...payloads: unknown[]): string | null {
  const queue = [...payloads];

  while (queue.length > 0) {
    const current = queue.shift();

    const directVersion = normalizeVersionCandidate(current);
    if (directVersion && /^v?\d/i.test(directVersion)) {
      return directVersion;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;

      for (const key of ['version', 'releaseName', 'releaseVersion', 'name']) {
        const version = normalizeVersionCandidate(record[key]);
        if (version) {
          return version;
        }
      }

      queue.push(...Object.values(record));
    }
  }

  return null;
}

class AppUpdateServiceImpl {
  private status: AppUpdateStatus = createInitialStatus();
  private started = false;
  private configured = false;
  private listenersAttached = false;
  private readonly listeners = new Set<(status: AppUpdateStatus) => void>();

  private applyHealthFromStatus(status: AppUpdateStatus) {
    switch (status.status) {
      case 'unsupported':
        ServiceHealthRegistry.markUnsupported('updater', status.message);
        return;
      case 'error':
        ServiceHealthRegistry.markError('updater', status.message);
        return;
      case 'checking':
        ServiceHealthRegistry.markStarting('updater', status.message ?? 'Checking for updates.');
        return;
      case 'update_available':
        ServiceHealthRegistry.markDegraded(
          'updater',
          status.message ?? 'Update download is still in progress.',
        );
        return;
      case 'ready_to_install':
        ServiceHealthRegistry.markReady(
          'updater',
          status.message ?? 'An update is ready to install.',
        );
        return;
      case 'up_to_date':
        ServiceHealthRegistry.markReady('updater', status.message ?? 'Application is up to date.');
        return;
      default:
        ServiceHealthRegistry.markIdle('updater', status.message);
    }
  }

  private patchStatus(patch: Partial<AppUpdateStatus>) {
    this.status = {
      ...this.status,
      ...patch,
      currentVersion: app.getVersion(),
    };

    const nextStatus = this.getStatus();
    this.applyHealthFromStatus(nextStatus);
    for (const listener of this.listeners) {
      try {
        listener(nextStatus);
      } catch (error) {
        logger.error('App update status listener failed', error);
      }
    }
  }

  private attachListeners() {
    if (this.listenersAttached) {
      return;
    }

    this.listenersAttached = true;

    autoUpdater.on('checking-for-update', ((..._args: unknown[]) => {
      if (this.status.status === 'ready_to_install') {
        return;
      }

      logger.info('Auto updater is checking for updates');
      this.patchStatus({
        status: 'checking',
        message: null,
      });
    }) as () => void);

    autoUpdater.on('update-available', ((...args: unknown[]) => {
      if (this.status.status === 'ready_to_install') {
        return;
      }

      const latestVersion = extractLatestVersion(...args);
      logger.info('Update available', { latestVersion });
      this.patchStatus({
        status: 'update_available',
        latestVersion,
        lastCheckedAt: Date.now(),
        message: null,
      });
    }) as (...args: unknown[]) => void);

    autoUpdater.on('update-not-available', ((...args: unknown[]) => {
      if (this.status.status === 'ready_to_install') {
        return;
      }

      const latestVersion = extractLatestVersion(...args);
      logger.info('Application is up to date', { latestVersion });
      this.patchStatus({
        status: 'up_to_date',
        latestVersion,
        lastCheckedAt: Date.now(),
        message: null,
      });
    }) as (...args: unknown[]) => void);

    autoUpdater.on('error', ((error: unknown) => {
      const message = getErrorMessage(error);
      logger.error('Auto update error', error);
      this.patchStatus({
        status: 'error',
        message,
        lastCheckedAt: Date.now(),
      });
    }) as (error: unknown) => void);

    autoUpdater.on('update-downloaded', ((...args: unknown[]) => {
      const latestVersion = extractLatestVersion(...args) ?? this.status.latestVersion;
      logger.info('Update downloaded and ready to install', { latestVersion });
      this.patchStatus({
        status: 'ready_to_install',
        latestVersion,
        lastCheckedAt: Date.now(),
        message: null,
      });
    }) as (...args: unknown[]) => void);
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.patchStatus({});

    if (!app.isPackaged) {
      logger.info('Skipping auto updater setup because the app is not packaged');
      this.patchStatus({
        status: 'error',
        message: 'Automatic updates are only available in packaged builds.',
      });
      return;
    }

    if (!SUPPORTED_AUTO_UPDATE_PLATFORMS.has(process.platform)) {
      logger.info(`Skipping auto updater setup on unsupported platform ${process.platform}`);
      this.patchStatus({
        status: 'unsupported',
        message: 'Automatic updates are not supported on this platform.',
      });
      return;
    }

    this.attachListeners();

    try {
      const updateSource = validateReleaseUpdateSource(
        resolveReleaseUpdateSource({ allowEnvOverride: false }),
      );
      if (updateSource.type !== 'static') {
        throw new Error(
          'Automatic updates are disabled because packaged builds only support the pinned static update source.',
        );
      }

      installUpdateCertificatePinning({
        app,
        defaultSession: session.defaultSession,
        trustedHost: resolveTrustedStaticUpdateHost({ allowEnvOverride: false }),
        allowedPins: TRUSTED_UPDATE_SPKI_PINS,
        logger,
      });

      logger.info(`Initializing static auto updater with ${updateSource.baseUrl}`);
      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.StaticStorage,
          baseUrl: updateSource.baseUrl,
        },
        notifyUser: false,
      });

      this.configured = true;
      ServiceHealthRegistry.markReady('updater', 'Automatic updates are configured.');
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error('Failed to initialize auto updater', error);
      this.patchStatus({
        status: 'error',
        message,
      });
    }
  }

  getStatus(): AppUpdateStatus {
    return {
      ...this.status,
      currentVersion: app.getVersion(),
    };
  }

  subscribe(listener: (status: AppUpdateStatus) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkForUpdatesManual(): Promise<AppUpdateStatus> {
    if (!this.started) {
      this.start();
    }

    if (!this.configured || this.status.status === 'ready_to_install') {
      return this.getStatus();
    }

    this.patchStatus({
      status: 'checking',
      message: null,
    });

    try {
      await Promise.resolve(autoUpdater.checkForUpdates());
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error('Manual update check failed', error);
      this.patchStatus({
        status: 'error',
        message,
        lastCheckedAt: Date.now(),
      });
    }

    return this.getStatus();
  }

  installDownloadedUpdate(): AppUpdateStatus {
    const currentStatus = this.getStatus();

    if (!this.configured || currentStatus.status !== 'ready_to_install') {
      return currentStatus;
    }

    logger.info('Installing downloaded update after user confirmation');
    markUpdateInstallQuitIntent();
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (error) {
        clearQuitIntent();
        logger.error('Failed to start downloaded update installation', error);
      }
    });

    return currentStatus;
  }
}

export const AppUpdateService = new AppUpdateServiceImpl();
