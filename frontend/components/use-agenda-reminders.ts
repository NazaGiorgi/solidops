'use client';
import { useEffect, useRef } from 'react';
import { api, getToken } from '../lib/api';
import { useToast } from './toast';

interface ApptReminder {
  id: string;
  subject: string | null;
  startAt: string;
  reminderMinutes: number | null;
  technician?: { user?: { name?: string } } | null;
}

// Short chime for agenda alarms (Web Audio — no external asset needed).
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // Two soft tones: 880Hz then 660Hz, gentle decay.
    const freqs = [880, 660];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.15 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.3);
    });
  } catch {
    /* sound is best-effort; silence on failure */
  }
}

// Polls for appointments whose reminder threshold is about to hit and fires a
// PERSISTENT alarm toast (blinks + sound + link to the activity) that stays
// until the user closes it or navigates to the activity.
export function useAgendaReminders() {
  // UNCONDITIONAL: if this line never appears in the console, the hook is not
  // being invoked at all (i.e. the component that calls it never mounts).
  const ctx = useToast();
  // [DIAG] timestamp + contador real de invocaciones (para distinguir re-render
  // de remount).
  const g = (globalThis as unknown as { __remindersInvocations?: number });
  g.__remindersInvocations = (g.__remindersInvocations || 0) + 1;
  // eslint-disable-next-line no-console
  console.log('[reminders] MOUNTED', 't=' + Date.now(), 'invoc=' + g.__remindersInvocations, {
    hasToken: !!getToken(),
    dismissedCount: ctx.dismissedCount(),
  });

  const { push, isDismissed, dismissedCount, clearDismissed } = ctx;
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[reminders] EFFECT ran', 't=' + Date.now(), { hasToken: !!getToken() });
    if (!getToken()) return;
    // NOTE: no `running` ref guard here. React StrictMode mounts the effect,
    // unmounts it (running the cleanup), then mounts it again. A one-shot
    // `running` guard would let the cleanup clear the interval and block the
    // second mount from recreating it, leaving NO polling at all. Relying on
    // the cleanup alone is correct: each mount creates the interval, each
    // unmount clears it.

    const tick = async () => {
      try {
        // eslint-disable-next-line no-console
        console.log('[reminders] TICKING');
        const now = Date.now();
        const from = new Date(now - 5 * 60000).toISOString();
        const to = new Date(now + 24 * 60 * 60000).toISOString();
        const list = await api.get<ApptReminder[]>(`/appointments?from=${from}&to=${to}`);
        // eslint-disable-next-line no-console
        console.log('[reminders] fetching', { from, to, count: list.length });
        for (const a of list) {
          if (!a.reminderMinutes) continue;
          const start = new Date(a.startAt).getTime();
          const remindAt = start - a.reminderMinutes * 60000;
          // eslint-disable-next-line no-console
          console.log('[reminders] eval', {
            id: a.id,
            subject: a.subject,
            startAt: a.startAt,
            reminderMinutes: a.reminderMinutes,
            now,
            remindAt,
            shouldFire: now >= remindAt && a.reminderMinutes > 0,
          });
          if (now >= remindAt && a.reminderMinutes > 0) {
            // Instrument each gate so the console reveals EXACTLY what blocks.
            // eslint-disable-next-line no-console
            console.log('[reminders] GATES', {
              id: a.id,
              firedThisSession: fired.current.has(a.id),
              dismissed: isDismissed(a.id),
              dismissedCount: dismissedCount(),
            });
            // Skip if already fired this session OR the user dismissed it.
            if (fired.current.has(a.id)) continue;
            if (isDismissed(a.id)) {
              // If the appointment already STARTED (past its start time), the
              // dismissal is stale — clear it so the reminder is not blocked
              // forever. (A dismissal only makes sense before the event.)
              if (now >= start) {
                // eslint-disable-next-line no-console
                console.log('[reminders] clearing stale dismissal for', a.id);
                clearDismissed(a.id);
              } else {
                continue;
              }
            }
            fired.current.add(a.id);
            // eslint-disable-next-line no-console
            console.log('[reminders] CALLING showToast', a.id);
            const minsLeft = Math.max(0, Math.round((start - now) / 60000));
            playChime();
            push({
              title: `⏰ ${a.subject || 'Turno próximo'}`,
              body: `${a.technician?.user?.name || 'Técnico'} · empieza en ${minsLeft} min`,
              tone: 'alarm',
              persistent: true,
              dismissKey: a.id, // stable key so closing it sticks
              actionHref: '/agenda',
              actionLabel: 'ver actividad',
            });
          }
        }
        // Keep the de-dup set bounded.
        if (fired.current.size > 1000) fired.current = new Set();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[reminders] ERROR', e);
      }
    };

    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
