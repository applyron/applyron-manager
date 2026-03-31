import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExposeInMainWorld = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockSend = vi.fn();
const mockPostMessage = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
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

  it('exposes the main electron bridge in all environments', async () => {
    vi.stubGlobal('__APPLYRON_E2E__', false);

    await import('@/preload');

    expect(mockExposeInMainWorld).toHaveBeenCalledWith(
      'electron',
      expect.objectContaining({
        startOrpcServer: expect.any(Function),
        onAppAlreadyRunning: expect.any(Function),
      }),
    );
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
