import { afterEach, describe, expect, it } from 'vitest';
import {
  getQuitIntent,
  markAppQuitIntent,
  markUpdateInstallQuitIntent,
  resetQuitIntentForTesting,
  shouldHideWindowToTrayOnClose,
} from '../../utils/quitIntent';

describe('quit intent', () => {
  afterEach(() => {
    resetQuitIntentForTesting();
  });

  it('hides the window to tray by default', () => {
    expect(getQuitIntent()).toBe('none');
    expect(shouldHideWindowToTrayOnClose()).toBe(true);
  });

  it('allows window close when the app is quitting normally', () => {
    markAppQuitIntent();

    expect(getQuitIntent()).toBe('app-quit');
    expect(shouldHideWindowToTrayOnClose()).toBe(false);
  });

  it('allows window close immediately for update installation', () => {
    markUpdateInstallQuitIntent();

    expect(getQuitIntent()).toBe('update-install');
    expect(shouldHideWindowToTrayOnClose()).toBe(false);
  });
});
