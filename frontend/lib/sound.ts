'use client';
const SOUND_KEY = 'solidops_sound_enabled';
const SOUND_CHANGE_EVENT = 'solidops-sound-change';
const G = globalThis as unknown as { __solidopsAudioCtx?: AudioContext | null };

function loadPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = window.localStorage.getItem(SOUND_KEY);
    return v === null ? true : v !== '0';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return loadPreference();
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch {
    /* localStorage indisponible: best-effort */
  }
  window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
}

export function subscribeSound(cb: () => void): () => void {
  window.addEventListener(SOUND_CHANGE_EVENT, cb);
  return () => window.removeEventListener(SOUND_CHANGE_EVENT, cb);
}

// Un solo AudioContext compartido. La política de autoplay de los navegadores
// deja el contexto "suspended" hasta el primer gesto del usuario: adjuntamos un
// listener one-shot a pointerdown/keydown para reanudarlo en la primera
// interacción (para que el sonido funcione desde ahí). El play() puede seguir
// siendo rechazado antes de ese gesto: no rompemos nada, solo logueamos.
function sharedContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!G.__solidopsAudioCtx) {
      G.__solidopsAudioCtx = new Ctx();
      const resume = () => {
        const c = G.__solidopsAudioCtx;
        if (c && c.state === 'suspended') void c.resume();
      };
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
      void resume();
    }
    return G.__solidopsAudioCtx;
  } catch {
    return null;
  }
}

function playTones(freqs: number[], spacingS: number, durationS: number, gain = 0.12): void {
  const c = sharedContext();
  if (!c) return;
  const now = c.currentTime;
  freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t0 = now + i * spacingS;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + durationS + 0.05);
  });
}

// Ticket nuevo: tríada ascendente (C5-E5-G5), distinta del chime de agenda.
export function playNewTicketSound(): void {
  if (!loadPreference()) return;
  try {
    playTones([523.25, 659.25, 783.99], 0.12, 0.22, 0.11);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sound] ticket nuevo: play() bloqueado por autoplay', e);
  }
}

// Recordatorio de agenda: dos tonos suaves 880Hz luego 660Hz (chime histórico).
export function playReminderChime(): void {
  if (!loadPreference()) return;
  try {
    playTones([880, 660], 0.15, 0.25, 0.12);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sound] agenda: play() bloqueado por autoplay', e);
  }
}