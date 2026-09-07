import { nextOccurrenceDate } from './calendar.service';
import { RecurrenceRule } from '../../common/enums';

describe('nextOccurrenceDate', () => {
  it('advances daily', () => {
    const d = new Date('2026-01-05T10:00:00Z');
    const next = nextOccurrenceDate(d, RecurrenceRule.DAILY);
    expect(next.toISOString()).toBe(new Date('2026-01-06T10:00:00Z').toISOString());
  });
  it('advances weekly', () => {
    const d = new Date('2026-01-05T10:00:00Z');
    const next = nextOccurrenceDate(d, RecurrenceRule.WEEKLY);
    expect(next.toISOString()).toBe(new Date('2026-01-12T10:00:00Z').toISOString());
  });
  it('advances monthly', () => {
    const d = new Date('2026-01-05T10:00:00Z');
    const next = nextOccurrenceDate(d, RecurrenceRule.MONTHLY);
    expect(next.getUTCMonth()).toBe(1); // February
  });
  it('falls back to +1 day for none', () => {
    const d = new Date('2026-01-05T10:00:00Z');
    const next = nextOccurrenceDate(d, RecurrenceRule.NONE);
    expect(next.toISOString()).toBe(new Date('2026-01-06T10:00:00Z').toISOString());
  });
});
