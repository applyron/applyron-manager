export type QuitIntent = 'none' | 'app-quit' | 'update-install';

let currentQuitIntent: QuitIntent = 'none';

export function markAppQuitIntent(): void {
  if (currentQuitIntent === 'none') {
    currentQuitIntent = 'app-quit';
  }
}

export function markUpdateInstallQuitIntent(): void {
  currentQuitIntent = 'update-install';
}

export function getQuitIntent(): QuitIntent {
  return currentQuitIntent;
}

export function shouldHideWindowToTrayOnClose(): boolean {
  return currentQuitIntent === 'none';
}

export function clearQuitIntent(): void {
  currentQuitIntent = 'none';
}

export function resetQuitIntentForTesting(): void {
  clearQuitIntent();
}
