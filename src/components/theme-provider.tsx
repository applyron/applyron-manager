import React, { createContext, useContext, useEffect, useState } from 'react';
import { ipc } from '@/ipc/manager';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  const storedTheme = localStorage.getItem(storageKey);
  return storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'system'
    ? storedTheme
    : defaultTheme;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { children, defaultTheme = 'system', storageKey = 'vite-ui-theme' } = props;
  const [{ theme, resolvedTheme }, setThemeState] = useState(() => {
    const initialTheme = readStoredTheme(storageKey, defaultTheme);
    return {
      theme: initialTheme,
      resolvedTheme: initialTheme === 'system' ? getSystemTheme() : initialTheme,
    };
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const applyTheme = (nextTheme: Theme) => {
      const nextResolvedTheme =
        nextTheme === 'system' ? (mediaQuery?.matches ? 'dark' : 'light') : nextTheme;

      root.classList.remove('light', 'dark');
      root.classList.add(nextResolvedTheme);
      setThemeState((current) =>
        current.resolvedTheme === nextResolvedTheme
          ? current
          : {
              ...current,
              resolvedTheme: nextResolvedTheme,
            },
      );
    };

    applyTheme(theme);

    if (!mediaQuery) {
      return;
    }

    const handleMediaChange = () => {
      if (theme === 'system') {
        applyTheme('system');
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
      return () => mediaQuery.removeEventListener('change', handleMediaChange);
    }

    mediaQuery.addListener?.(handleMediaChange);
    return () => mediaQuery.removeListener?.(handleMediaChange);
  }, [theme]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setThemeState((current) => ({
        ...current,
        theme,
      }));
      void ipc.client.theme.setThemeMode(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider value={value} {...props}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
