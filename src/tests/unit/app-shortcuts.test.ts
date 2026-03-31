// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SHORTCUT_EVENTS,
  bindAppShortcuts,
  isEditableShortcutTarget,
} from '@/utils/appShortcuts';

describe('app shortcuts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates with the core Ctrl shortcuts', () => {
    const navigate = vi.fn();
    const cleanup = bindAppShortcuts(window, {
      getPathname: () => '/',
      getManagedIdeTarget: () => 'antigravity',
      navigate,
      reload: vi.fn(),
      toggleProxy: vi.fn(async () => undefined),
      refreshGeminiAccounts: vi.fn(),
      refreshCodexAccounts: vi.fn(),
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true }));

    expect(navigate).toHaveBeenNthCalledWith(1, '/accounts');
    expect(navigate).toHaveBeenNthCalledWith(2, '/proxy');
    cleanup();
  });

  it('refreshes the active accounts target only on the accounts route', () => {
    const refreshGeminiAccounts = vi.fn();
    const refreshCodexAccounts = vi.fn();
    const cleanup = bindAppShortcuts(window, {
      getPathname: () => '/accounts',
      getManagedIdeTarget: () => 'vscode-codex',
      navigate: vi.fn(),
      reload: vi.fn(),
      toggleProxy: vi.fn(async () => undefined),
      refreshGeminiAccounts,
      refreshCodexAccounts,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));

    expect(refreshCodexAccounts).toHaveBeenCalledTimes(1);
    expect(refreshGeminiAccounts).not.toHaveBeenCalled();
    cleanup();
  });

  it('toggles proxy on Ctrl+Shift+P and reloads on F5', () => {
    const toggleProxy = vi.fn(async () => undefined);
    const reload = vi.fn();
    const cleanup = bindAppShortcuts(window, {
      getPathname: () => '/proxy',
      getManagedIdeTarget: () => 'antigravity',
      navigate: vi.fn(),
      reload,
      toggleProxy,
      refreshGeminiAccounts: vi.fn(),
      refreshCodexAccounts: vi.fn(),
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }));

    expect(toggleProxy).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('ignores shortcuts while focus is inside editable inputs', () => {
    const navigate = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);

    const cleanup = bindAppShortcuts(window, {
      getPathname: () => '/',
      getManagedIdeTarget: () => 'antigravity',
      navigate,
      reload: vi.fn(),
      toggleProxy: vi.fn(async () => undefined),
      refreshGeminiAccounts: vi.fn(),
      refreshCodexAccounts: vi.fn(),
    });

    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }));

    expect(navigate).not.toHaveBeenCalled();
    expect(isEditableShortcutTarget(input)).toBe(true);
    cleanup();
    input.remove();
  });

  it('exposes stable custom shortcut event names', () => {
    expect(APP_SHORTCUT_EVENTS.refreshGeminiAccounts).toBe(
      'applyron:shortcut:refresh-gemini-accounts',
    );
    expect(APP_SHORTCUT_EVENTS.refreshCodexAccounts).toBe(
      'applyron:shortcut:refresh-codex-accounts',
    );
    expect(APP_SHORTCUT_EVENTS.proxyStatusChanged).toBe('applyron:shortcut:proxy-status-changed');
  });
});
