import {
  addBusinessMinutes,
  isWorkingTime,
  classifySla,
  hasWorkingHours,
  BusinessHours,
} from './business-hours.util';

// Standard 9-18 MF business window.
const week9to18: BusinessHours = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
};

describe('addBusinessMinutes', () => {
  it('adds minutes within the same working window', () => {
    const start = new Date('2026-01-05T09:00:00'); // Monday 9:00
    const result = addBusinessMinutes(start, 60, week9to18);
    expect(result.toISOString()).toBe(new Date('2026-01-05T10:00:00').toISOString());
  });

  it('skips non-working hours and rolls to the next business day', () => {
    const start = new Date('2026-01-05T17:30:00'); // Monday 17:30
    // 60 min: 30 min left today (17:30->18:00), then next 30 min at Tue 09:00.
    const result = addBusinessMinutes(start, 60, week9to18);
    expect(result.getDay()).toBe(2); // Tuesday
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
  });

  it('handles a deadline exactly at the weekend boundary', () => {
    const start = new Date('2026-01-09T17:00:00'); // Friday 17:00
    // 5 hours: 1h today (17->18) then 4h Monday (09->13).
    const result = addBusinessMinutes(start, 300, week9to18);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getHours()).toBe(13);
  });
});

describe('isWorkingTime', () => {
  it('returns true inside business hours', () => {
    expect(isWorkingTime(new Date('2026-01-05T10:00:00'), week9to18)).toBe(true);
  });
  it('returns false outside business hours and on weekends', () => {
    expect(isWorkingTime(new Date('2026-01-05T20:00:00'), week9to18)).toBe(false);
    expect(isWorkingTime(new Date('2026-01-04T10:00:00'), week9to18)).toBe(false); // Sunday
  });
});

describe('hasWorkingHours', () => {
  it('returns false for empty or null schedule', () => {
    expect(hasWorkingHours({})).toBe(false);
    expect(hasWorkingHours(null as unknown as BusinessHours)).toBe(false);
  });
  it('returns false when days exist but no intervals', () => {
    expect(hasWorkingHours({ mon: [], tue: [] })).toBe(false);
  });
  it('returns true when at least one interval exists', () => {
    expect(hasWorkingHours(week9to18)).toBe(true);
  });
});

describe('addBusinessMinutes with empty hours (no contract)', () => {
  it('returns a plain calendar offset instead of spinning (24/7 fallback)', () => {
    const start = new Date('2026-01-05T09:00:00');
    // Must return immediately (not iterate 43k×43k). Assert correct calendar result.
    const r = addBusinessMinutes(start, 480, {});
    expect(r.getTime()).toBe(start.getTime() + 480 * 60000);
  });
});

describe('classifySla', () => {
  // total window 480 minutes = 8h.
  it('is verde early in the window', () => {
    const due = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h remaining
    const r = classifySla(due, 480, new Date());
    expect(r.status).toBe('verde');
  });
  it('turns amarillo inside the last 25%', () => {
    const due = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1h remaining of 8h = 87.5% used
    const r = classifySla(due, 480, new Date());
    expect(r.status).toBe('amarillo');
  });
  it('is rojo after the deadline', () => {
    const due = new Date(Date.now() - 1000);
    const r = classifySla(due, 480, new Date());
    expect(r.status).toBe('rojo');
  });
});
