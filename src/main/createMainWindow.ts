import { BrowserWindow } from 'electron';
import type { Event } from 'electron';
import path from 'path';
import {
  getDeniedWindowOpenHandlerResponse,
  isAllowedMainWindowNavigation,
} from '@/utils/windowSecurity';

export function focusExistingMainWindow(
  mainWindow: Pick<
    BrowserWindow,
    'hide' | 'isMinimized' | 'restore' | 'isVisible' | 'show' | 'focus'
  >,
  startHidden: boolean,
): true {
  if (startHidden) {
    mainWindow.hide();
    return true;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  return true;
}

export async function waitForViteServer({
  url,
  logger,
  fetchImpl = fetch,
  maxRetries = 30,
  delayMs = 500,
}: {
  url: string;
  logger: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  delayMs?: number;
}): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        logger.info(`createWindow: Vite server ready after ${attempt * delayMs}ms`);
        return true;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  logger.error('createWindow: Vite server did not start in time');
  return false;
}

export async function createOrFocusMainWindow({
  currentWindow,
  startHidden,
  inDevelopment,
  devServerUrl,
  preloadPath,
  rendererName,
  iconPath,
  isPackaged,
  isPackagedE2E,
  logger,
  onCreated,
  onCloseRequested,
  onClosed,
  onFocus,
  onAfterCreate,
}: {
  currentWindow: BrowserWindow | null;
  startHidden: boolean;
  inDevelopment: boolean;
  devServerUrl?: string;
  preloadPath: string;
  rendererName: string;
  iconPath: string;
  isPackaged: boolean;
  isPackagedE2E: boolean;
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  onCreated: (window: BrowserWindow) => void;
  onCloseRequested: (event: Event, mainWindow: BrowserWindow) => void;
  onClosed: () => void;
  onFocus: () => void;
  onAfterCreate: () => void;
}): Promise<BrowserWindow> {
  if (currentWindow && !currentWindow.isDestroyed()) {
    focusExistingMainWindow(currentWindow, startHidden);
    return currentWindow;
  }

  logger.info('createWindow: start');
  logger.info(`createWindow: preload path: ${preloadPath}`);
  logger.info('createWindow: attempting to create BrowserWindow');

  const additionalArguments =
    isPackagedE2E && process.env.APPLYRON_E2E_ORPC_MODE
      ? [`--applyron-e2e-orpc-mode=${process.env.APPLYRON_E2E_ORPC_MODE}`]
      : undefined;
  const webPreferences = {
    devTools: inDevelopment,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: !inDevelopment,
    preload: preloadPath,
    ...(additionalArguments ? { additionalArguments } : {}),
  };

  assertPackagedBrowserWindowSecurity({
    inDevelopment,
    isPackaged,
    isPackagedE2E,
    webPreferences,
  });

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !startHidden,
    autoHideMenuBar: true,
    webPreferences,
    icon: iconPath,
  });

  onCreated(mainWindow);
  logger.info('createWindow: BrowserWindow instance created');

  if (startHidden) {
    mainWindow.hide();
    logger.info('createWindow: startHidden enabled, window hidden');
  }

  if (inDevelopment && devServerUrl) {
    logger.info(`createWindow: waiting for Vite dev server at ${devServerUrl}`);
    const ready = await waitForViteServer({ url: devServerUrl, logger });
    if (mainWindow.isDestroyed()) {
      logger.warn('createWindow: BrowserWindow destroyed before Vite URL load');
      return mainWindow;
    }

    if (ready) {
      logger.info(`createWindow: loading URL ${devServerUrl}`);
      void mainWindow.loadURL(devServerUrl);
    } else {
      logger.error('createWindow: Failed to connect to Vite server, loading anyway');
      void mainWindow.loadURL(devServerUrl);
    }
  } else {
    logger.info('createWindow: loading file index.html');
    void mainWindow.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`));
  }

  onAfterCreate();

  mainWindow.on('close', (event) => {
    onCloseRequested(event, mainWindow);
  });

  mainWindow.on('closed', () => {
    onClosed();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn(`Blocked renderer window open attempt: ${url}`);
    return getDeniedWindowOpenHandlerResponse();
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (
      isAllowedMainWindowNavigation(navigationUrl, {
        devServerUrl,
        isPackaged,
      })
    ) {
      return;
    }

    event.preventDefault();
    logger.warn(`Blocked top-level navigation attempt: ${navigationUrl}`);
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      logger.error(
        `Page failed to load: ${errorCode} - ${errorDescription} - URL: ${validatedURL}`,
      );
    },
  );

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('Page finished loading successfully');
  });

  mainWindow.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details;
    logger.info(`[Renderer Console][${level}] ${message} (${sourceId}:${lineNumber})`);
  });

  mainWindow.on('focus', () => {
    onFocus();
  });

  return mainWindow;
}

export function assertPackagedBrowserWindowSecurity(input: {
  inDevelopment: boolean;
  isPackaged: boolean;
  isPackagedE2E: boolean;
  webPreferences: {
    sandbox: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
  };
}): void {
  if (input.inDevelopment || !input.isPackaged || input.isPackagedE2E) {
    return;
  }

  if (
    input.webPreferences.sandbox !== true ||
    input.webPreferences.contextIsolation !== true ||
    input.webPreferences.nodeIntegration !== false
  ) {
    throw new Error(
      'STARTUP_RELEASE_ASSERTION_FAILED|Packaged builds must keep sandbox enabled, context isolation enabled, and Node integration disabled.',
    );
  }
}
