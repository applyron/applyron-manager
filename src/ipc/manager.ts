import type { IPCClient } from './client-types';

// Custom IPC Client that correctly builds method paths
function createIPCClient(port: OrpcClientPortBridge) {
  let requestId = 0;
  const pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  port.setOnMessage((rawData) => {
    try {
      if (rawData === undefined || rawData === null) {
        return;
      }

      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      const id = data.i || data.id;
      const pending = pendingRequests.get(id);
      if (pending) {
        pendingRequests.delete(id);
        clearTimeout(pending.timeoutId);
        if (data.e || data.error) {
          const errorMsg = data.e?.m || data.error?.message || JSON.stringify(data.e || data.error);
          console.error('[IPCClient] Error response:', errorMsg);
          pending.reject(new Error(errorMsg));
        } else {
          // ORPC response format: { i, p: { b: { json: value }, s?: statusCode } }
          // Or error: { i, p: { s: 500, b: { json: { code, message } } } }
          let result;
          const payload = data.p;

          // Check for error status
          if (payload?.s && payload.s >= 400) {
            const errorData = payload.b?.json;
            const errorMsg = errorData?.message || errorData?.code || 'Server error';
            console.error('[IPCClient] Server error:', errorData);
            pending.reject(new Error(errorMsg));
            return;
          }

          // Extract successful result
          if (payload?.b?.json !== undefined) {
            result = payload.b.json;
          } else if (data.r !== undefined) {
            // Fallback to 'r' field if present
            result = data.r?.b?.json ?? data.r;
          } else if ('result' in data) {
            result = data.result;
          }

          pending.resolve(result);
        }
      } else {
        console.warn('[IPCClient] No pending request for id:', id);
      }
    } catch (e) {
      console.error('[IPCClient] Error parsing response:', e, rawData);
    }
  });

  async function callMethod(path: string[], input?: unknown): Promise<unknown> {
    const id = String(++requestId);
    const methodPath = path.join('/');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Request /${methodPath} timed out`));
        }
      }, 60000);

      pendingRequests.set(id, { resolve, reject, timeoutId });

      // ORPC MessagePort protocol format
      const payload = {
        i: id,
        p: {
          u: `orpc://localhost/${methodPath}`,
          b: { json: input ?? null },
        },
      };

      port.postMessage(JSON.stringify(payload));
    });
  }

  // Create a Proxy that builds the path chain
  function createProxyChain(pathSoFar: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_target, prop: string) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          // Don't intercept promise methods
          return undefined;
        }
        // Build deeper path
        return createProxyChain([...pathSoFar, prop]);
      },
      apply(_target, _thisArg, args) {
        // Called as function - execute RPC
        const input = args[0];
        return callMethod(pathSoFar, input);
      },
    });
  }

  return createProxyChain() as IPCClient;
}

function getOrpcClientPort() {
  if (!window.electron?.getOrpcClientPort) {
    throw new Error('Electron bridge is unavailable for ORPC client port access.');
  }

  return window.electron.getOrpcClientPort();
}

function startOrpcServer() {
  if (!window.electron?.startOrpcServer) {
    throw new Error('Electron bridge is unavailable for ORPC startup.');
  }

  window.electron.startOrpcServer();
}

export class IPCManager {
  private readonly clientPort: OrpcClientPortBridge;

  public readonly client: IPCClient;

  private initialized: boolean = false;

  constructor() {
    this.clientPort = getOrpcClientPort();
    this.client = createIPCClient(this.clientPort);
  }

  public initialize() {
    if (this.initialized) {
      return;
    }

    startOrpcServer();
    this.clientPort.start();
    this.initialized = true;
  }
}

export const ipc = new IPCManager();
ipc.initialize();
