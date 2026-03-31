import { describe, expect, it } from 'vitest';
import {
  getDeniedWindowOpenHandlerResponse,
  isAllowedMainWindowNavigation,
} from '@/utils/windowSecurity';

describe('windowSecurity', () => {
  it('allows same-origin navigation while running the Vite dev server', () => {
    expect(
      isAllowedMainWindowNavigation('http://localhost:5173/settings', {
        devServerUrl: 'http://localhost:5173',
        isPackaged: false,
      }),
    ).toBe(true);
  });

  it('blocks external navigation while running the Vite dev server', () => {
    expect(
      isAllowedMainWindowNavigation('https://example.com/settings', {
        devServerUrl: 'http://localhost:5173',
        isPackaged: false,
      }),
    ).toBe(false);
  });

  it('allows local file navigation for packaged builds', () => {
    expect(
      isAllowedMainWindowNavigation('file:///renderer/main_window/index.html', {
        isPackaged: true,
      }),
    ).toBe(true);
  });

  it('denies all renderer-triggered popup creation attempts', () => {
    expect(getDeniedWindowOpenHandlerResponse()).toEqual({ action: 'deny' });
  });
});
