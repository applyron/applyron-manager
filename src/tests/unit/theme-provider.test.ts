// @vitest-environment happy-dom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '@/components/theme-provider';

const { mockSetThemeMode } = vi.hoisted(() => ({
  mockSetThemeMode: vi.fn(),
}));

vi.mock('@/ipc/manager', () => ({
  ipc: {
    client: {
      theme: {
        setThemeMode: mockSetThemeMode,
      },
    },
  },
}));

type MediaQueryListener = (event: MediaQueryListEvent) => void;

function createMatchMedia(matches: boolean) {
  const listeners = new Set<MediaQueryListener>();

  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.add(listener as MediaQueryListener);
      }
    },
    removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as MediaQueryListener);
      }
    },
    addListener: (listener: MediaQueryListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: MediaQueryListener) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
    setMatches(nextMatches: boolean) {
      this.matches = nextMatches;
      listeners.forEach((listener) =>
        listener({
          matches: nextMatches,
          media: this.media,
        } as MediaQueryListEvent),
      );
    },
  };
}

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return React.createElement(
    'div',
    null,
    React.createElement('div', { 'data-testid': 'theme' }, theme),
    React.createElement('div', { 'data-testid': 'resolved-theme' }, resolvedTheme),
    React.createElement('button', { type: 'button', onClick: () => setTheme('dark') }, 'dark'),
    React.createElement('button', { type: 'button', onClick: () => setTheme('light') }, 'light'),
  );
}

function renderWithThemeProvider() {
  return render(
    React.createElement(ThemeProvider, {
      storageKey: 'test-theme',
      defaultTheme: 'system',
      children: React.createElement(ThemeProbe),
    }),
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    mockSetThemeMode.mockReset();
  });

  it('resolves dark mode from the current system preference when theme is system', () => {
    const mediaQuery = createMatchMedia(true);
    window.matchMedia = vi.fn().mockImplementation(() => mediaQuery as unknown as MediaQueryList);
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    renderWithThemeProvider();

    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved-theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    getItemSpy.mockRestore();
  });

  it('updates the resolved theme when the system preference changes in system mode', async () => {
    const mediaQuery = createMatchMedia(true);
    window.matchMedia = vi.fn().mockImplementation(() => mediaQuery as unknown as MediaQueryList);

    renderWithThemeProvider();

    mediaQuery.setMatches(false);

    await waitFor(() => {
      expect(screen.getByTestId('resolved-theme').textContent).toBe('light');
    });
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('persists explicit theme changes and notifies the IPC layer', async () => {
    const mediaQuery = createMatchMedia(false);
    window.matchMedia = vi.fn().mockImplementation(() => mediaQuery as unknown as MediaQueryList);

    renderWithThemeProvider();

    fireEvent.click(screen.getByRole('button', { name: 'dark' }));

    await waitFor(() => {
      expect(screen.getByTestId('theme').textContent).toBe('dark');
    });
    expect(screen.getByTestId('resolved-theme').textContent).toBe('dark');
    expect(localStorage.getItem('test-theme')).toBe('dark');
    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
  });
});
