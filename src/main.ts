import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { MessageBoxOptions } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import squirrelStartup from 'electron-squirrel-startup';
import { ipcContext } from '@/ipc/context';
import { IPC_CHANNELS } from './constants';
import { logger } from './utils/logger';
import {
  getExpectedInstallRoot,
  getInstallNoticeText,
  isRunningFromExpectedInstallDir as isRunningFromExpectedInstallDirUtil,
  resolveInstallNoticeLanguage,
} from './utils/installNotice';
import { CloudAccountRepo } from './ipc/database/cloudHandler';
import { initDatabase } from './ipc/database/handler';
import { cloudMonitorService } from './services/CloudMonitorService';
import { CodexAutoSwitchService } from './services/CodexAutoSwitchService';
import { CodexMonitorService } from './services/CodexMonitorService';
import { AuthServer } from './ipc/cloud/authServer';
import { bootstrapNestServer, stopNestServer } from './server/main';
import { initTray, setTrayLanguage, destroyTray, setTrayUpdateStatus } from './ipc/tray/handler';
import { rpcHandler } from './ipc/handler';
import { ConfigManager } from './ipc/config/manager';
import { AppConfig } from './types/config';
import { isAutoStartLaunch, syncAutoStart } from './utils/autoStart';
import { safeStringifyPacket } from './utils/sensitiveDataMasking';
import { isPackagedE2EEnvironment } from './utils/runtimeMode';
import { AppUpdateService } from './services/AppUpdateService';
import {
  getQuitIntent,
  markAppQuitIntent,
  shouldHideWindowToTrayOnClose,
} from './utils/quitIntent';
import { openPathOrThrow } from './utils/openPath';
import { ServiceHealthRegistry } from './services/ServiceHealthRegistry';
import { OrpcTransportManager } from './ipc/orpcTransportManager';
import { createOrFocusMainWindow } from './main/createMainWindow';
import {
  handleStartupFatalError,
  initializeCriticalStartupDependencies,
  runCriticalStartupPhase,
  StartupFatalError,
} from './main/startupLifecycle';
import { prepareStartupDesktopIntegration } from './main/startupDesktopIntegration';
import {
  ensureVisibleWindowsUninstallLauncher,
  triggerWindowsUninstallFromLauncher,
} from './main/windowsInstall';
import { getAgentDir } from './utils/paths';

const inDevelopment = process.env.NODE_ENV === 'development';
const isE2E = isPackagedE2EEnvironment();
const shouldLogOrpcPackets = process.env.APPLYRON_DEBUG_ORPC_PACKETS === '1';
const BACKGROUND_STARTUP_DELAY_MS = 4000;

if (isE2E) {
  const e2eRuntimeRoot = path.join(
    app.getPath('temp'),
    'applyron-manager-e2e',
    String(process.pid),
  );
  const e2eUserDataPath = path.join(e2eRuntimeRoot, 'userData');
  const e2eSessionDataPath = path.join(e2eRuntimeRoot, 'sessionData');

  fs.mkdirSync(e2eUserDataPath, { recursive: true });
  fs.mkdirSync(e2eSessionDataPath, { recursive: true });
  app.setPath('userData', e2eUserDataPath);
  app.setPath('sessionData', e2eSessionDataPath);
}

const packetLogPath = path.join(app.getPath('userData'), 'orpc_packets.log');
let packetLogQueue = Promise.resolve();
const packagedE2EFatalDialogResponse = async () => ({
  response: 1,
  checkboxChecked: false,
});

function logPacket(data: unknown) {
  if (!shouldLogOrpcPackets) {
    return;
  }

  try {
    const line = `[${new Date().toISOString()}] ${safeStringifyPacket(data)}\n`;
    packetLogQueue = packetLogQueue
      .catch(() => undefined)
      .then(() => fs.promises.appendFile(packetLogPath, line))
      .catch((error) => {
        if (error instanceof Error) {
          logger.error('Failed to append ORPC packet log', error);
        }
      });
  } catch (e) {
    if (e instanceof Error) {
      logger.error('Failed to append ORPC packet log', e);
    }
  }
}
ipcMain.on(IPC_CHANNELS.CHANGE_LANGUAGE, (event, lang) => {
  logger.info(`IPC: Received CHANGE_LANGUAGE: ${lang}`);
  setTrayLanguage(lang);
});
app.disableHardwareAcceleration();

triggerWindowsUninstallFromLauncher({
  platform: process.platform,
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  existsSync: fs.existsSync,
  spawnImpl: spawn,
  quit: () => {
    app.quit();
  },
  exit: (code) => process.exit(code),
  logger,
});

if (squirrelStartup) {
  app.quit();
  process.exit(0);
}

let globalMainWindow: BrowserWindow | null = null;
let startupConfig: AppConfig | null = null;
let shouldStartHidden = false;
let hasShownInstallNotice = false;
let shutdownCleanupStarted = false;
let backgroundServicesStartupHandle: NodeJS.Timeout | null = null;
const orpcTransportManager = new OrpcTransportManager();

function isRunningFromExpectedInstallDir() {
  return isRunningFromExpectedInstallDirUtil({
    platform: process.platform,
    isPackaged: app.isPackaged,
    localAppData: process.env.LOCALAPPDATA,
    appName: app.getName(),
    execPath: process.execPath,
  });
}

function showWindowsInstallNoticeIfNeeded() {
  if (isE2E) {
    return;
  }

  if (hasShownInstallNotice) {
    return;
  }

  if (isRunningFromExpectedInstallDir()) {
    return;
  }

  const expectedRoot = getExpectedInstallRoot({
    platform: process.platform,
    localAppData: process.env.LOCALAPPDATA,
    appName: app.getName(),
  });
  if (!expectedRoot) {
    return;
  }

  hasShownInstallNotice = true;
  const language = resolveInstallNoticeLanguage({
    configLanguage: startupConfig?.language,
    locale: app.getLocale(),
  });
  const text = getInstallNoticeText(language);

  const options: MessageBoxOptions = {
    type: 'info',
    title: text.title,
    message: text.message,
    detail: `${text.detailPrefix}${expectedRoot}`,
    buttons: [...text.buttons],
    defaultId: 1,
  };

  const showPromise = globalMainWindow
    ? dialog.showMessageBox(globalMainWindow, options)
    : dialog.showMessageBox(options);

  showPromise.then(({ response }) => {
    if (response === 0) {
      void openPathOrThrow(expectedRoot, 'install directory').catch((error) => {
        logger.error('Failed to open expected install root', error);
      });
    }
  });
}

function runShutdownCleanup() {
  if (shutdownCleanupStarted) {
    return;
  }

  shutdownCleanupStarted = true;

  try {
    destroyTray();
  } catch (error) {
    logger.error('Failed to destroy tray during shutdown cleanup', error);
  }

  try {
    orpcTransportManager.reset('Application shutdown in progress.');
  } catch (error) {
    logger.error('Failed to reset ORPC transport during shutdown cleanup', error);
  }

  try {
    AuthServer.stop();
  } catch (error) {
    logger.error('Failed to stop AuthServer during shutdown cleanup', error);
  }

  try {
    CloudAccountRepo.shutdown();
  } catch (error) {
    logger.error('Failed to close cloud account database during shutdown cleanup', error);
  }

  if (backgroundServicesStartupHandle) {
    clearTimeout(backgroundServicesStartupHandle);
    backgroundServicesStartupHandle = null;
  }

  void stopNestServer().catch((error) => {
    logger.error('Failed to stop NestJS server during shutdown cleanup', error);
  });
}

function scheduleBackgroundStartupServices(config: AppConfig): void {
  if (backgroundServicesStartupHandle) {
    clearTimeout(backgroundServicesStartupHandle);
  }

  backgroundServicesStartupHandle = setTimeout(() => {
    backgroundServicesStartupHandle = null;
    void (async () => {
      try {
        logger.info('Startup: Starting cloud quota monitor...');
        cloudMonitorService.start();
        logger.info('Startup: Starting Codex account monitor...');
        CodexMonitorService.start();
        await CodexAutoSwitchService.syncWithConfig(config);
      } catch (error) {
        logger.error('Startup: Failed to initialize delayed background services', error);
      }
    })();
  }, BACKGROUND_STARTUP_DELAY_MS);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    logger.info('Second instance detected, focusing existing window');
    if (app.isReady()) {
      void createWindow({ startHidden: false }).then(() => {
        globalMainWindow?.webContents.send('APP_ALREADY_RUNNING');
      });
      return;
    }
    app.whenReady().then(() => {
      void createWindow({ startHidden: false }).then(() => {
        globalMainWindow?.webContents.send('APP_ALREADY_RUNNING');
      });
    });
  });
}

process.on('exit', (code) => {
  logger.info(`Process exit event triggered with code: ${code}`);
});

process.on('before-exit', (code) => {
  logger.info(`Process before-exit event triggered with code: ${code}`);
});

async function createWindow({ startHidden }: { startHidden: boolean }) {
  const preload = path.join(__dirname, 'preload.js');
  const iconPath = inDevelopment
    ? path.join(process.cwd(), 'src/assets/icon.png')
    : path.join(__dirname, '../assets/icon.png');

  const mainWindow = await createOrFocusMainWindow({
    currentWindow: globalMainWindow,
    startHidden,
    inDevelopment,
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    preloadPath: preload,
    rendererName: MAIN_WINDOW_VITE_NAME,
    iconPath,
    isPackaged: app.isPackaged,
    isPackagedE2E: isE2E,
    logger,
    onCreated: (window) => {
      globalMainWindow = window;
      logger.info('createWindow: setting main window in ipcContext');
      ipcContext.setMainWindow(window);
      logger.info('createWindow: setMainWindow done');
    },
    onCloseRequested: (event, mainWindowInstance) => {
      if (shouldHideWindowToTrayOnClose()) {
        event.preventDefault();
        mainWindowInstance.hide();
        logger.info('Window close intercepted -> Minimized to tray');
        return;
      }
      logger.info(`Window close event triggered (quitIntent=${getQuitIntent()})`);
    },
    onClosed: () => {
      logger.info('Window closed event triggered');
      orpcTransportManager.reset('Main window closed.');
      globalMainWindow = null;
    },
    onFocus: () => {
      if (isE2E) {
        return;
      }

      void cloudMonitorService.handleAppFocus();
      CodexMonitorService.handleAppFocus();
    },
    onAfterCreate: () => {
      logger.info('Window created');
      showWindowsInstallNoticeIfNeeded();
    },
  });

  return mainWindow;
}

app.on('child-process-gone', (_event, details) => {
  logger.error('Child process gone:', details);
});

app.on('before-quit', () => {
  markAppQuitIntent();
  logger.info(`App before-quit event triggered - quitIntent=${getQuitIntent()}`);
});

app.on('will-quit', (_event) => {
  logger.info(`App will quit event triggered - quitIntent=${getQuitIntent()}`);
  runShutdownCleanup();
});

app.on('quit', (_event, exitCode) => {
  logger.info(`App quit event triggered with code: ${exitCode}`);
});

async function setupORPC() {
  ipcMain.on(IPC_CHANNELS.START_ORPC_SERVER, (event) => {
    logger.info('IPC: Received START_ORPC_SERVER');
    const [port] = event.ports;
    try {
      const outcome = orpcTransportManager.attach({
        senderId: event.sender.id,
        port,
        upgrade: (attachedPort) => {
          rpcHandler.upgrade(attachedPort);
        },
        onMessage: shouldLogOrpcPackets
          ? (data) => {
              logPacket(data);
            }
          : undefined,
      });
      event.sender.once('destroyed', () => {
        orpcTransportManager.releaseForSender(event.sender.id, 'Renderer webContents destroyed.');
      });
      logger.info(`IPC: rpcHandler upgraded successfully (${outcome})`);
    } catch (error) {
      logger.error('IPC: Failed to upgrade rpcHandler', error);
    }
  });
}

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

app
  .whenReady()
  .then(() =>
    runCriticalStartupPhase({
      initializeCriticalDependencies: () => {
        if (isE2E) {
          logger.info(
            'Running cloud account storage init in E2E package; skipping managed IDE DB init',
          );
          return initializeCriticalStartupDependencies({
            logger,
            initCloudAccountRepo: () => CloudAccountRepo.init(),
            initLegacyDatabase: () => {
              logger.info('Skipping managed IDE DB init in E2E package');
            },
          });
        }

        return initializeCriticalStartupDependencies({
          logger,
          initCloudAccountRepo: () => CloudAccountRepo.init(),
          initLegacyDatabase: () => initDatabase(),
        });
      },
      continueStartup: async () => {
        logger.info('Step: Load Config');
        const config = ConfigManager.loadConfig();
        startupConfig = config;
        shouldStartHidden = prepareStartupDesktopIntegration({
          config,
          isPackagedE2E: isE2E,
          logger,
          syncAutoStart,
          detectAutoStartLaunch: () => isAutoStartLaunch(),
          ensureVisibleWindowsUninstallLauncher: () => {
            ensureVisibleWindowsUninstallLauncher({
              platform: process.platform,
              isPackaged: app.isPackaged,
              execPath: process.execPath,
              existsSync: fs.existsSync,
              statSync: fs.statSync,
              copyFileSync: fs.copyFileSync,
              logger,
            });
          },
        }).shouldStartHidden;

        logger.info('Step: setupORPC');
        await setupORPC();

        logger.info('Step: createWindow');
        await createWindow({ startHidden: shouldStartHidden });

        logger.info('Step: installExtensions (SKIPPED)');
        // return installExtensions();

        logger.info('Step: checkForUpdates');
        if (isE2E) {
          logger.info('Skipping update check in E2E package');
        } else {
          AppUpdateService.subscribe((status) => {
            setTrayUpdateStatus(status);
          });
          setTrayUpdateStatus(AppUpdateService.getStatus());
          AppUpdateService.start();
        }

        // Initialize background services.
        try {
          if (isE2E) {
            logger.info('Skipping background startup services in E2E package');
            ServiceHealthRegistry.markIdle('proxy_server', 'Disabled during packaged E2E run.');
            ServiceHealthRegistry.markIdle('cloud_monitor', 'Disabled during packaged E2E run.');
            ServiceHealthRegistry.markIdle('codex_monitor', 'Disabled during packaged E2E run.');
          } else {
            ServiceHealthRegistry.markIdle('auth_server', null);
          }

          // Gateway Server (NestJS) - auto-start if enabled
          const startupRuntimeConfig = startupConfig || ConfigManager.loadConfig();
          if (!isE2E && startupRuntimeConfig.proxy?.auto_start) {
            const port = startupRuntimeConfig.proxy?.port || 8045;
            if (startupRuntimeConfig.proxy) {
              await bootstrapNestServer(startupRuntimeConfig.proxy);
            }
            logger.info(`NestJS Proxy: Auto-started on port ${port}`);
          } else if (!isE2E) {
            ServiceHealthRegistry.markIdle('proxy_server', 'Auto-start is disabled.');
          }

          if (!isE2E) {
            logger.info(
              `Startup: Scheduling cloud and Codex monitors after ${BACKGROUND_STARTUP_DELAY_MS}ms`,
            );
            scheduleBackgroundStartupServices(startupRuntimeConfig);
          }
        } catch (e) {
          logger.error('Startup: Failed to initialize services', e);
        }

        logger.info('Step: Startup Complete');
        if (globalMainWindow) {
          if (isE2E) {
            logger.info('Skipping tray init in E2E package');
          } else {
            initTray(globalMainWindow);
          }
        }
      },
      onFatalError: (error) =>
        handleStartupFatalError({
          error,
          logger,
          runShutdownCleanup,
          showMessageBox: isE2E
            ? packagedE2EFatalDialogResponse
            : dialog.showMessageBox.bind(dialog),
          openPath: openPathOrThrow,
          getLogDir: getAgentDir,
          exit: (code) => app.exit(code),
        }),
    }),
  )
  .catch((error) => {
    if (error instanceof Error && error.message.startsWith('STARTUP_RELEASE_ASSERTION_FAILED|')) {
      const [, userMessage = error.message] = error.message.split('|');
      return handleStartupFatalError({
        error: new StartupFatalError('STARTUP_RELEASE_ASSERTION_FAILED', userMessage, error),
        logger,
        runShutdownCleanup,
        showMessageBox: isE2E ? packagedE2EFatalDialogResponse : dialog.showMessageBox.bind(dialog),
        openPath: openPathOrThrow,
        getLogDir: getAgentDir,
        exit: (code) => app.exit(code),
      });
    }

    logger.error('Failed to start application:', error);
    return handleStartupFatalError({
      error: new StartupFatalError(
        'STARTUP_UNEXPECTED_FAILURE',
        error instanceof Error ? error.message : 'Unexpected startup failure.',
        error,
      ),
      logger,
      runShutdownCleanup,
      showMessageBox: isE2E ? packagedE2EFatalDialogResponse : dialog.showMessageBox.bind(dialog),
      openPath: openPathOrThrow,
      getLogDir: getAgentDir,
      exit: (code) => app.exit(code),
    });
  });

//osX only
app.on('window-all-closed', () => {
  logger.info('Window all closed event triggered');
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // Keep app running for tray
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow({ startHidden: false });
  }
});
//osX only ends
