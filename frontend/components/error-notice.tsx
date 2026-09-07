'use client';
import { useEffect, useRef } from 'react';

// Dismissible, self-clearing error banner.
// - Has a close (×) button so it never floats indefinitely.
// - Auto-hides its message after a few seconds.
// - Clears the parent's error when this component unmounts (route change), so a
//   stale red notice can never leak across screens.
export function ErrorNotice({
  message,
  onDismiss,
  autoHideMs = 6000,
}: {
  message: string;
  onDismiss?: () => void;
  autoHideMs?: number;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timer lifecycle: (re)arm only when the message changes.
  useEffect(() => {
    if (autoHideMs > 0) {
      timer.current = setTimeout(() => {
        onDismiss?.();
      }, autoHideMs);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, autoHideMs]);

  // On unmount (e.g. navigating away), clear the parent error so it never
  // persists into the next screen.
  useEffect(() => {
    return () => {
      onDismiss?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!message) return null;

  return (
    <div className="notice notice-error">
      <div className="notice-flex">
        <span>{message}</span>
        <button
          type="button"
          className="notice-close"
          aria-label="Cerrar"
          onClick={() => onDismiss?.()}
        >
          ×
        </button>
      </div>
    </div>
  );
}
