'use client';
import { useEffect, useRef } from 'react';

// Dismissible, self-clearing error banner.
// - Has a close (×) button so it never floats indefinitely.
// - Auto-hides its message after a few seconds.
// - Callers render it only while their error is set, so unmounting already
//   clears the parent state. Do not call onDismiss from a cleanup effect:
//   StrictMode mounts/unmounts effects once in dev, which wiped the message
//   immediately after it appeared.
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
