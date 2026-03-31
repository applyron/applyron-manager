import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './constants';

function isMessagePortLike(value: unknown): value is MessagePort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'postMessage' in value &&
    typeof value.postMessage === 'function' &&
    'start' in value &&
    typeof value.start === 'function'
  );
}

type OrpcTestMode = 'cloudAccountsFailure' | null;
type PreloadGlobalWithTestMode = typeof globalThis & {
  __APPLYRON_ORPC_TEST_MODE__?: OrpcTestMode;
};

const preloadGlobal = globalThis as PreloadGlobalWithTestMode;

function resolveInitialOrpcTestMode(): OrpcTestMode {
  if (process.env.APPLYRON_E2E_ORPC_MODE === 'cloudAccountsFailure') {
    return 'cloudAccountsFailure';
  }

  const cliMode = process.argv.find((argument) => argument.startsWith('--applyron-e2e-orpc-mode='));
  if (cliMode?.split('=').at(1) === 'cloudAccountsFailure') {
    return 'cloudAccountsFailure';
  }

  return null;
}

function getOrpcTestMode(): OrpcTestMode {
  return preloadGlobal.__APPLYRON_ORPC_TEST_MODE__ ?? null;
}

function setOrpcTestMode(mode: OrpcTestMode) {
  preloadGlobal.__APPLYRON_ORPC_TEST_MODE__ = mode;
}

if (preloadGlobal.__APPLYRON_ORPC_TEST_MODE__ === undefined) {
  setOrpcTestMode(resolveInitialOrpcTestMode());
}
let orpcClientPort: MessagePort | null = null;
let orpcClientMessageHandler: ((data: unknown) => void) | null = null;

function bindOrpcClientPort(port: MessagePort) {
  orpcClientPort = port;
  orpcClientPort.onmessage = (event) => {
    orpcClientMessageHandler?.(event.data);
  };
}

function createOrpcClientBridge(): OrpcClientPortBridge {
  return {
    postMessage: (message: string) => {
      if (!orpcClientPort) {
        throw new Error('ORPC client port is not initialized.');
      }

      orpcClientPort.postMessage(message);
    },
    start: () => {
      if (!orpcClientPort) {
        throw new Error('ORPC client port is not initialized.');
      }

      orpcClientPort.start();
    },
    setOnMessage: (handler) => {
      orpcClientMessageHandler = handler;
    },
  };
}

function attachCloudAccountsFailureStub(port: MessagePort) {
  port.start();
  port.onmessage = (event) => {
    try {
      const request = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      const requestId = request && (request.i || request.id);
      const requestUrl = (request && request.p && request.p.u) || '';

      if (!requestId) {
        return;
      }

      if (requestUrl.includes('/cloud/listCloudAccounts')) {
        port.postMessage(
          JSON.stringify({
            i: requestId,
            p: { s: 500, b: { json: { message: 'internal server error' } } },
          }),
        );
        return;
      }

      let result = null;
      if (requestUrl.includes('/process/isProcessRunning')) {
        result = false;
      } else if (requestUrl.includes('/cloud/getAutoSwitchEnabled')) {
        result = false;
      }

      port.postMessage(
        JSON.stringify({
          i: requestId,
          p: { b: { json: result } },
        }),
      );
    } catch (error) {
      console.error('[Preload] Failed to handle ORPC test stub message', error);
    }
  };
}

const electronBridge: ElectronBridge = {
  getBootstrapFlags: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BOOTSTRAP_FLAGS),
  startOrpcServer: () => {
    const channel = new MessageChannel();
    const serverPort = channel.port1;
    const clientPort = channel.port2;
    bindOrpcClientPort(clientPort);

    if (getOrpcTestMode() === 'cloudAccountsFailure') {
      if (!isMessagePortLike(serverPort)) {
        console.error('[Preload] ORPC test stub requires a usable MessagePort');
        throw new TypeError('Invalid ORPC MessagePort received for test stub');
      }
      attachCloudAccountsFailureStub(serverPort);
      return;
    }

    try {
      ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
    } catch (error) {
      console.error('[Preload] Failed to transfer ORPC server port', error);
      throw new TypeError('Invalid ORPC MessagePort received');
    }
  },
  getOrpcClientPort: () => createOrpcClientBridge(),
  onGoogleAuthCode: (callback: (code: string) => void) => {
    const handler = (_event: unknown, code: string) => callback(code);
    ipcRenderer.on('GOOGLE_AUTH_CODE', handler);
    return () => ipcRenderer.off('GOOGLE_AUTH_CODE', handler);
  },
  onAppAlreadyRunning: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('APP_ALREADY_RUNNING', handler);
    return () => ipcRenderer.off('APP_ALREADY_RUNNING', handler);
  },
  changeLanguage: (lang: string) => {
    ipcRenderer.send(IPC_CHANNELS.CHANGE_LANGUAGE, lang);
  },
};

contextBridge.exposeInMainWorld('electron', electronBridge);

if (__APPLYRON_E2E__) {
  const electronTestBridge: ElectronTestBridge = {
    setOrpcTestMode: (mode) => {
      setOrpcTestMode(mode);
    },
    getOrpcTestMode: () => getOrpcTestMode(),
  };

  contextBridge.exposeInMainWorld('electronTest', electronTestBridge);
}
