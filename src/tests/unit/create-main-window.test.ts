import { describe, expect, it, vi } from 'vitest';
import {
  assertPackagedBrowserWindowSecurity,
  focusExistingMainWindow,
  waitForViteServer,
} from '@/main/createMainWindow';

describe('createMainWindow helpers', () => {
  it('focuses an existing window when startHidden is false', () => {
    const mainWindow = {
      hide: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };

    const handled = focusExistingMainWindow(mainWindow as never, false);

    expect(handled).toBe(true);
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide).not.toHaveBeenCalled();
  });

  it('hides an existing window when startHidden is true', () => {
    const mainWindow = {
      hide: vi.fn(),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      isVisible: vi.fn(() => true),
      show: vi.fn(),
      focus: vi.fn(),
    };

    const handled = focusExistingMainWindow(mainWindow as never, true);

    expect(handled).toBe(true);
    expect(mainWindow.hide).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).not.toHaveBeenCalled();
  });

  it('waits for the dev server until it becomes ready', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('still booting'))
      .mockResolvedValueOnce({ ok: true } as Response);

    const ready = await waitForViteServer({
      url: 'http://localhost:3000',
      logger,
      fetchImpl,
      maxRetries: 3,
      delayMs: 0,
    });

    expect(ready).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('createWindow: Vite server ready after 0ms');
  });

  it('allows secure packaged browser window preferences', () => {
    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: true,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      }),
    ).not.toThrow();
  });

  it('rejects packaged builds that disable sandboxing', () => {
    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: true,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
        },
      }),
    ).toThrow('STARTUP_RELEASE_ASSERTION_FAILED|');
  });

  it('rejects packaged builds that disable context isolation', () => {
    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: true,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: false,
          nodeIntegration: false,
        },
      }),
    ).toThrow('STARTUP_RELEASE_ASSERTION_FAILED|');
  });

  it('rejects packaged builds that enable node integration', () => {
    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: true,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: true,
        },
      }),
    ).toThrow('STARTUP_RELEASE_ASSERTION_FAILED|');
  });

  it('skips the packaged assertion in development, unpackaged, and packaged E2E runs', () => {
    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: true,
        isPackaged: true,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: false,
          contextIsolation: false,
          nodeIntegration: true,
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: false,
        isPackagedE2E: false,
        webPreferences: {
          sandbox: false,
          contextIsolation: false,
          nodeIntegration: true,
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertPackagedBrowserWindowSecurity({
        inDevelopment: false,
        isPackaged: true,
        isPackagedE2E: true,
        webPreferences: {
          sandbox: false,
          contextIsolation: false,
          nodeIntegration: true,
        },
      }),
    ).not.toThrow();
  });
});
