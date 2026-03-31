import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExposeInMainWorld = vi.fn();
const mockInvoke = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockSend = vi.fn();
const mockPostMessage = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    off: mockOff,
    send: mockSend,
    postMessage: mockPostMessage,
  },
}));

describe('preload bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes the bootstrap flag bridge in all environments', async () => {
    vi.stubGlobal('__APPLYRON_E2E__', false);
    mockInvoke.mockResolvedValue({ sentryEnabled: true });

    await import('@/preload');

    expect(mockExposeInMainWorld).toHaveBeenCalledWith(
      'electron',
      expect.objectContaining({
        getBootstrapFlags: expect.any(Function),
        startOrpcServer: expect.any(Function),
        onAppAlreadyRunning: expect.any(Function),
      }),
    );

    const bridge = mockExposeInMainWorld.mock.calls[0][1] as ElectronBridge;
    await expect(bridge.getBootstrapFlags()).resolves.toEqual({ sentryEnabled: true });
  });

  it('only exposes the electronTest bridge in packaged E2E mode', async () => {
    vi.stubGlobal('__APPLYRON_E2E__', true);

    await import('@/preload');

    expect(mockExposeInMainWorld).toHaveBeenCalledWith(
      'electronTest',
      expect.objectContaining({
        setOrpcTestMode: expect.any(Function),
      }),
    );
  });
});
