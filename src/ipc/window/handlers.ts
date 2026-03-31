import { os } from '@orpc/server';
import { ipcContext } from '../context';
import { logger } from '../../utils/logger';

function getMainWindow() {
  const window = ipcContext.mainWindow;
  if (!window) {
    throw new Error('Main window is not set in IPC context.');
  }
  return window;
}

export const minimizeWindow = os.handler(() => {
  getMainWindow().minimize();
});

export const maximizeWindow = os.handler(() => {
  const window = getMainWindow();

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

export const closeWindow = os.handler(() => {
  logger.info('IPC: closeWindow called');
  getMainWindow().close();
});
