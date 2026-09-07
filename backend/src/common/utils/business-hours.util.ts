// ---------------------------------------------------------------------------
// Business-hours & SLA computation helpers.
//
// A Contract.business_hours is stored as a JSON object keyed by ISO weekday:
//   {
//     "mon": [{"start": "09:00", "end": "18:00"}],
//     "tue": [{"start": "09:00", "end": "18:00"}],
//     "sat": [{"start": "09:00", "end": "13:00"}]
//   }
// Days not present (or with no intervals) are non-working.
//
// SLA computation steps business MINUTES between two datetimes, skipping
// non-working hours and optional public holidays (holidays are Fase 2 / seed).
// The resulting due-at dates are "business hours aware".
// ---------------------------------------------------------------------------

export interface TimeInterval {
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export interface BusinessHours {
  // keys: 'mon'..'sun'
  [weekday: string]: TimeInterval[];
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const WEEKDAY_KEYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Map a Date's JS day (0=Sun..6=Sat) to our key.
export function weekdayKeyOf(date: Date): WeekdayKey {
  return WEEKDAY_KEYS[date.getDay()];
}

function parseTime(t: string): { minutes: number } {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return { minutes: h * 60 + m };
}

// Parse an interval into {startMinutes, endMinutes}.
function normalizeInterval(iv: TimeInterval): { startMinutes: number; endMinutes: number } {
  const s = parseTime(iv.start).minutes;
  const e = parseTime(iv.end).minutes;
  return { startMinutes: s, endMinutes: e > s ? e : s };
}

// Return whether the given date falls within any working interval of its weekday.
// Also returns the interval bounds so callers can clamp.
export function isWorkingTime(
  date: Date,
  hours: BusinessHours,
  holidays: Date[] = [],
): boolean {
  const dayKey = weekdayKeyOf(date);
  const intervals = hours[dayKey];
  if (!intervals || intervals.length === 0) return false;
  if (isHoliday(date, holidays)) return false;

  const current = date.getHours() * 60 + date.getMinutes();
  return intervals.some((iv) => {
    const { startMinutes, endMinutes } = normalizeInterval(iv);
    return current >= startMinutes && current < endMinutes;
  });
}

export function isHoliday(date: Date, holidays: Date[]): boolean {
  return holidays.some((h) => {
    return (
      h.getFullYear() === date.getFullYear() &&
      h.getMonth() === date.getMonth() &&
      h.getDate() === date.getDate()
    );
  });
}

// True when the schedule defines at least one working interval on any weekday.
// An empty `{}` (e.g. a ticket with no active contract) means NO business-hour
// restriction, so SLA should use plain 24/7 calendar time instead of searching
// for a business day that doesn't exist.
export function hasWorkingHours(hours: BusinessHours): boolean {
  if (!hours) return false;
  return Object.values(hours).some(
    (intervals) => Array.isArray(intervals) && intervals.length > 0,
  );
}

// Add N business minutes to `from`, respecting business hours. Holidays skipped.
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  hours: BusinessHours,
  holidays: Date[] = [],
): Date {
  if (minutes <= 0) return new Date(from);

  // No business hours configured -> no scheduling restriction. Treat it as a
  // plain calendar offset (24/7). This also prevents the O(n²) spin that
  // happened when `hours` was `{}` and no business day could be found.
  if (!hasWorkingHours(hours)) {
    return new Date(from.getTime() + minutes * 60000);
  }

  let remaining = minutes;
  let cursor = new Date(from);

  // If starting outside business hours, advance to the next working minute.
  // We allow a bounded number of iterations; in practice a few days covers it.
  let guard = 0;
  while (guard++ < 60 * 24 * 30) {
    const dayKey = weekdayKeyOf(cursor);
    const intervals = hours[dayKey];
    if (intervals && intervals.length && !isHoliday(cursor, holidays)) {
      // If we're already inside a working interval, consume from here.
      const current = cursor.getHours() * 60 + cursor.getMinutes();
      const iv = intervals
        .map(normalizeInterval)
        .find((i) => current >= i.startMinutes && current < i.endMinutes);
      if (iv) {
        // End of the current day's working window.
        let dayEnd = new Date(cursor);
        dayEnd.setHours(Math.floor(iv.endMinutes / 60), iv.endMinutes % 60, 0, 0);

        const remainingToday = Math.max(0, (dayEnd.getTime() - cursor.getTime()) / 60000);
        if (remaining > remainingToday) {
          remaining -= remainingToday;
          cursor = new Date(dayEnd.getTime() + 1); // move just past the working window
          // Advance to next working minute (next day or same-day later hour).
          cursor = nextWorkingMinute(cursor, hours, holidays);
        } else {
          return new Date(cursor.getTime() + remaining * 60000);
        }
      } else {
        cursor = nextWorkingMinute(cursor, hours, holidays);
      }
    } else {
      cursor = nextWorkingMinute(cursor, hours, holidays);
    }
  }
  // Fallback: if we somehow looped beyond guard, return calendar-based result.
  return new Date(from.getTime() + minutes * 60000);
}

// Find the next minute that is within a working interval.
function nextWorkingMinute(
  from: Date,
  hours: BusinessHours,
  holidays: Date[] = [],
): Date {
  let cursor = new Date(from);
  let guard = 0;
  while (guard++ < 60 * 24 * 30) {
    const dayKey = weekdayKeyOf(cursor);
    const intervals = hours[dayKey];
    if (intervals && intervals.length && !isHoliday(cursor, holidays)) {
      const current = cursor.getHours() * 60 + cursor.getMinutes();
      for (const iv of intervals) {
        const i = normalizeInterval(iv);
        if (current < i.startMinutes) {
          const next = new Date(cursor);
          next.setHours(Math.floor(i.startMinutes / 60), i.startMinutes % 60, 0, 0);
          return next;
        }
      }
    }
    // Try the next minute (or next day) — advance in 1-minute steps during
    // the day is slow for far dates; use day jumps.
    // Jump to the start of the next day to make this efficient.
    const nextDay = new Date(cursor);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    cursor = nextDay;
  }
  // Guard exhausted: return the CURSOR (the furthest point reached), NOT the
  // original `from`. Returning `from` here made callers re-loop forever on the
  // same date (e.g. when hours is empty), multiplying the O(n²) work.
  return new Date(cursor);
}

// Compute the number of business minutes between two datetimes (for diagnostics).
export function businessMinutesBetween(
  from: Date,
  to: Date,
  hours: BusinessHours,
  holidays: Date[] = [],
): number {
  let count = 0;
  let cursor = new Date(from);
  const stepMs = 60000;
  let guard = 0;
  while (cursor < to && guard++ < 60 * 24 * 60) {
    if (isWorkingTime(cursor, hours, holidays)) count++;
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return count;
}

// --- SLA status classification ---------------------------------------------

export type SlaGotoStatus = 'verde' | 'amarillo' | 'rojo';

// Classify the SLA state at a given moment.
export interface SlaTiming {
  status: SlaGotoStatus;
  remainingMinutes: number;
  pctUsed: number;
}

// Given a deadline (dueAt) and the full SLA window we know the fraction used.
// Simple approach: red if past due, yellow if within the last 25% of the window,
// green otherwise. Requires the total window (minutes) to compute pct.
export function classifySla(
  dueAt: Date,
  totalWindowMinutes: number,
  now: Date = new Date(),
): SlaTiming {
  const remaining = (dueAt.getTime() - now.getTime()) / 60000;
  if (remaining <= 0) {
    return { status: 'rojo', remainingMinutes: remaining, pctUsed: 100 };
  }
  const used = Math.max(0, totalWindowMinutes - remaining);
  const pct = totalWindowMinutes === 0 ? 0 : Math.min(100, (used / totalWindowMinutes) * 100);
  if (pct >= 75) {
    return { status: 'amarillo', remainingMinutes: remaining, pctUsed: pct };
  }
  return { status: 'verde', remainingMinutes: remaining, pctUsed: pct };
}
