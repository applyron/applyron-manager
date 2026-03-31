import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('IPCManager', () => {
  const originalElectron = window.electron;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: originalElectron,
    });
    vi.unstubAllGlobals();
  });

  it('starts the ORPC server through the preload bridge', async () => {
    const startClientPort = vi.fn();
    const setOnMessage = vi.fn();
    const fakeClientPort = {
      start: startClientPort,
      postMessage: vi.fn(),
      setOnMessage,
    } satisfies OrpcClientPortBridge;
    const startOrpcServer = vi.fn();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        ...originalElectron,
        startOrpcServer,
        getOrpcClientPort: vi.fn(() => fakeClientPort),
      },
    });

    const { IPCManager } = await import('@/ipc/manager');

    startClientPort.mockClear();
    startOrpcServer.mockClear();
    setOnMessage.mockClear();

    const manager = new IPCManager();
    manager.initialize();

    expect(startClientPort).toHaveBeenCalledOnce();
    expect(startOrpcServer).toHaveBeenCalledOnce();
    expect(setOnMessage).toHaveBeenCalledOnce();

    manager.initialize();
    expect(startOrpcServer).toHaveBeenCalledOnce();
  });

  it('clears the per-request timeout as soon as a response arrives', async () => {
    vi.useFakeTimers();

    let onMessageHandler: ((data: unknown) => void) | null = null;
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const fakeClientPort = {
      start: vi.fn(),
      postMessage: vi.fn((message: string) => {
        const payload = JSON.parse(message);
        onMessageHandler?.(
          JSON.stringify({
            i: payload.i,
            p: { b: { json: { ok: true } } },
          }),
        );
      }),
      setOnMessage: vi.fn((handler: ((data: unknown) => void) | null) => {
        onMessageHandler = handler;
      }),
    } satisfies OrpcClientPortBridge;

    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        ...originalElectron,
        startOrpcServer: vi.fn(),
        getOrpcClientPort: vi.fn(() => fakeClientPort),
      },
    });

    const { IPCManager } = await import('@/ipc/manager');
    const manager = new IPCManager();
    manager.initialize();

    await expect(manager.client.cloud.listCloudAccounts()).resolves.toEqual({ ok: true });
    expect(clearTimeoutSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
