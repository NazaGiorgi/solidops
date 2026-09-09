'use client';
import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'solidops_theme';
export type Theme = 'dark' | 'light';

export function getSavedTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(THEME_KEY);
  return v === 'dark' || v === 'light' ? v : null;
}

export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Preferencia manual siempre gana; si nunca eligió, respeta el sistema.
export function resolveTheme(): Theme {
  return getSavedTheme() || systemTheme();
}

export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.setAttribute('data-theme', t);
  el.removeAttribute('data-portal');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(resolveTheme());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggle };
}