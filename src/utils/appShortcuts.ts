import type { ManagedIdeTargetId } from '@/managedIde/types';

export const APP_SHORTCUT_EVENTS = {
  refreshGeminiAccounts: 'applyron:shortcut:refresh-gemini-accounts',
  refreshCodexAccounts: 'applyron:shortcut:refresh-codex-accounts',
  proxyStatusChanged: 'applyron:shortcut:proxy-status-changed',
} as const;

export type AppShortcutId =
  | 'dashboard'
  | 'accounts'
  | 'proxy'
  | 'settings'
  | 'refreshAccounts'
  | 'toggleProxy'
  | 'reloadWindow';

export const APP_SHORTCUT_DEFINITIONS: Array<{
  id: AppShortcutId;
  translationKey: string;
  windowsLabel: string;
  macLabel: string;
}> = [
  {
    id: 'dashboard',
    translationKey: 'settings.shortcuts.items.dashboard',
    windowsLabel: 'Ctrl+1',
    macLabel: '⌘1',
  },
  {
    id: 'accounts',
    translationKey: 'settings.shortcuts.items.accounts',
    windowsLabel: 'Ctrl+2',
    macLabel: '⌘2',
  },
  {
    id: 'proxy',
    translationKey: 'settings.shortcuts.items.proxy',
    windowsLabel: 'Ctrl+3',
    macLabel: '⌘3',
  },
  {
    id: 'settings',
    translationKey: 'settings.shortcuts.items.settings',
    windowsLabel: 'Ctrl+4',
    macLabel: '⌘4',
  },
  {
    id: 'refreshAccounts',
    translationKey: 'settings.shortcuts.items.refreshAccounts',
    windowsLabel: 'Ctrl+R',
    macLabel: '⌘R',
  },
  {
    id: 'toggleProxy',
    translationKey: 'settings.shortcuts.items.toggleProxy',
    windowsLabel: 'Ctrl+Shift+P',
    macLabel: '⌘⇧P',
  },
  {
    id: 'reloadWindow',
    translationKey: 'settings.shortcuts.items.reloadWindow',
    windowsLabel: 'F5',
    macLabel: 'F5',
  },
];

export function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac/i.test(navigator.platform);
}

export function getAppShortcutLabel(id: AppShortcutId, isMac = isMacLikePlatform()): string {
  const shortcut = APP_SHORTCUT_DEFINITIONS.find((item) => item.id === id);
  if (!shortcut) {
    return '';
  }

  return isMac ? shortcut.macLabel : shortcut.windowsLabel;
}

export function dispatchAppShortcutEvent(
  eventName: (typeof APP_SHORTCUT_EVENTS)[keyof typeof APP_SHORTCUT_EVENTS],
  detail?: unknown,
): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  return Boolean(target.closest('[contenteditable="true"]'));
}

type ShortcutBindingOptions = {
  getPathname: () => string;
  getManagedIdeTarget: () => ManagedIdeTargetId;
  navigate: (to: string) => void;
  reload: () => void;
  toggleProxy: () => Promise<void>;
  refreshGeminiAccounts: () => void;
  refreshCodexAccounts: () => void;
};

export function bindAppShortcuts(
  windowObject: Window,
  options: ShortcutBindingOptions,
): () => void {
  const handler = (event: KeyboardEvent) => {
    if (isEditableShortcutTarget(event.target)) {
      return;
    }

    const isMac = isMacLikePlatform();
    const hasPrimaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey;
    const pathname = options.getPathname();
    const normalizedKey = event.key.toLowerCase();

    if (event.key === 'F5') {
      event.preventDefault();
      options.reload();
      return;
    }

    if (!hasPrimaryModifier || event.altKey) {
      return;
    }

    if (!event.shiftKey) {
      if (normalizedKey === '1') {
        event.preventDefault();
        options.navigate('/');
        return;
      }

      if (normalizedKey === '2') {
        event.preventDefault();
        options.navigate('/accounts');
        return;
      }

      if (normalizedKey === '3') {
        event.preventDefault();
        options.navigate('/proxy');
        return;
      }

      if (normalizedKey === '4') {
        event.preventDefault();
        options.navigate('/settings');
        return;
      }

      if (normalizedKey === 'r' && pathname === '/accounts') {
        event.preventDefault();
        if (options.getManagedIdeTarget() === 'vscode-codex') {
          options.refreshCodexAccounts();
        } else {
          options.refreshGeminiAccounts();
        }
      }

      return;
    }

    if (normalizedKey === 'p') {
      event.preventDefault();
      void options.toggleProxy();
    }
  };

  windowObject.addEventListener('keydown', handler);
  return () => {
    windowObject.removeEventListener('keydown', handler);
  };
}
