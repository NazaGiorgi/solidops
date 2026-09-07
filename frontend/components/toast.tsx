'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: 'info' | 'success' | 'warning' | 'alarm';
  // persistent = never auto-closes (used for agenda reminders / alarms).
  persistent?: boolean;
  // Stable key (e.g. appointment id) used to remember a user's explicit dismiss
  // so the reminder does NOT re-fire on the next polling cycle.
  dismissKey?: string;
  // Optional action to navigate to the related activity.
  actionHref?: string;
  actionLabel?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
  // True if the user explicitly dismissed a reminder for this key.
  isDismissed: (key: string) => boolean;
  // Number of distinct dismissed reminder keys (diagnostics).
  dismissedCount: () => number;
  // Remove a dismissed key (used to un-dismiss stale reminders).
  clearDismissed: (key: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const STORAGE_KEY = 'opsmsp_dismissed_reminders';

function loadDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persistDismissed(list: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Stable keys of reminders the user already closed. Survives re-renders and
  // polling cycles; also persisted to localStorage to survive navigation/reload.
  const dismissedRef = useRef<Set<string>>(new Set(loadDismissed()));
  const toastsRef = useRef<Toast[]>([]);
  // force re-render hook so callers react to new dismissals
  const [, force] = useState(0);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    const removed = toastsRef.current.find((t) => t.id === id);
    if (removed?.dismissKey && !dismissedRef.current.has(removed.dismissKey)) {
      dismissedRef.current.add(removed.dismissKey);
      persistDismissed(Array.from(dismissedRef.current));
      force((n) => n + 1);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const isDismissed = useCallback((key: string) => {
    return dismissedRef.current.has(key);
  }, []);

  const dismissedCount = useCallback(() => {
    return dismissedRef.current.size;
  }, []);

  const clearDismissed = useCallback((key: string) => {
    if (dismissedRef.current.has(key)) {
      dismissedRef.current.delete(key);
      persistDismissed(Array.from(dismissedRef.current));
      force((n) => n + 1);
    }
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    // Auto-hide only NON-persistent toasts (e.g. save confirmations).
    // Persistent toasts (agenda alarms) stay until the user closes/navigates.
    if (!t.persistent) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, 8000);
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss, isDismissed, dismissedCount, clearDismissed }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// Global toast stack rendered once (in the app root).
export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone} ${t.persistent ? 'toast-alarm' : ''}`}>
          <div className="toast-content">
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
            {t.actionHref && t.actionLabel && (
              <a
                className="link toast-action"
                href={t.actionHref}
                onClick={() => dismiss(t.id)}
              >
                {t.actionLabel}
              </a>
            )}
          </div>
          <button className="notice-close" onClick={() => dismiss(t.id)} aria-label="Cerrar">×</button>
        </div>
      ))}
    </div>
  );
}
