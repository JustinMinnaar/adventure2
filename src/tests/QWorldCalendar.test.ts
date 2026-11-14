import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VAELORA_CALENDAR,
  worldHoursToCalendarDate,
  calendarDateToWorldHours,
  calendarMonthDayToWorldHours,
  generateWorldCalendar,
  getCalendarEventsForDay,
} from '../core/QWorldCalendar';

describe('QWorldCalendar', () => {
  it('defines the standard 13-month x 30-day + 5-day intercalary gap calendar (395 days)', () => {
    expect(DEFAULT_VAELORA_CALENDAR.daysPerYear).toBe(395);
    expect(DEFAULT_VAELORA_CALENDAR.months.length).toBe(13);
    for (const m of DEFAULT_VAELORA_CALENDAR.months) {
      expect(m.daysCount).toBe(30);
    }
    expect(DEFAULT_VAELORA_CALENDAR.intercalaryGap.daysCount).toBe(5);
    expect(DEFAULT_VAELORA_CALENDAR.intercalaryGap.dayNames.length).toBe(5);
  });

  it('accurately converts world hours into calendar dates across regular months and year-end gap days', () => {
    // Day 1 Year 1 at 12:00
    const d1 = worldHoursToCalendarDate(12, DEFAULT_VAELORA_CALENDAR);
    expect(d1.year).toBe(1);
    expect(d1.dayOfYear).toBe(1);
    expect(d1.monthIndex).toBe(0);
    expect(d1.monthName).toBe('Deepfrost');
    expect(d1.dayOfMonth).toBe(1);
    expect(d1.isIntercalary).toBe(false);
    expect(d1.formattedDate).toBe('1 Deepfrost, Year 1');

    // Day 30 Year 1: last day of month 1
    const d30 = worldHoursToCalendarDate(29 * 24 + 14, DEFAULT_VAELORA_CALENDAR);
    expect(d30.monthIndex).toBe(0);
    expect(d30.monthName).toBe('Deepfrost');
    expect(d30.dayOfMonth).toBe(30);
    expect(d30.isIntercalary).toBe(false);

    // Day 31 Year 1: first day of month 2 (Rimewake)
    const d31 = worldHoursToCalendarDate(30 * 24 + 8, DEFAULT_VAELORA_CALENDAR);
    expect(d31.monthIndex).toBe(1);
    expect(d31.monthName).toBe('Rimewake');
    expect(d31.dayOfMonth).toBe(1);
    expect(d31.isIntercalary).toBe(false);

    // Day 390 Year 1: last day of month 13 (Shadowsend)
    const d390 = worldHoursToCalendarDate(389 * 24 + 18, DEFAULT_VAELORA_CALENDAR);
    expect(d390.monthIndex).toBe(12);
    expect(d390.monthName).toBe('Shadowsend');
    expect(d390.dayOfMonth).toBe(30);
    expect(d390.isIntercalary).toBe(false);

    // Day 391 Year 1: first intercalary gap day
    const d391 = worldHoursToCalendarDate(390 * 24 + 12, DEFAULT_VAELORA_CALENDAR);
    expect(d391.year).toBe(1);
    expect(d391.dayOfYear).toBe(391);
    expect(d391.isIntercalary).toBe(true);
    expect(d391.dayOfMonth).toBe(1);
    expect(d391.dayName).toBe('Hearth-Rest');
    expect(d391.formattedDate).toBe("Hearth-Rest, Year 1");

    // Day 395 Year 1: final intercalary gap day (Year's Threshold)
    const d395 = worldHoursToCalendarDate(394 * 24 + 23, DEFAULT_VAELORA_CALENDAR);
    expect(d395.year).toBe(1);
    expect(d395.dayOfYear).toBe(395);
    expect(d395.isIntercalary).toBe(true);
    expect(d395.dayOfMonth).toBe(5);
    expect(d395.dayName).toBe("Year's Threshold");

    // Day 396: Day 1 of Year 2!
    const d396 = worldHoursToCalendarDate(395 * 24 + 6, DEFAULT_VAELORA_CALENDAR);
    expect(d396.year).toBe(2);
    expect(d396.dayOfYear).toBe(1);
    expect(d396.monthIndex).toBe(0);
    expect(d396.monthName).toBe('Deepfrost');
    expect(d396.dayOfMonth).toBe(1);
    expect(d396.isIntercalary).toBe(false);
  });

  it('performs lossless round-trip conversions between dates and continuous world hours', () => {
    const testCases = [
      { year: 1, dayOfYear: 1, hour: 12.5 },
      { year: 1, dayOfYear: 55, hour: 23 },
      { year: 2, dayOfYear: 180, hour: 0 },
      { year: 3, dayOfYear: 391, hour: 18.25 },
      { year: 15, dayOfYear: 395, hour: 23.9 },
    ];

    for (const tc of testCases) {
      const wh = calendarDateToWorldHours(tc.year, tc.dayOfYear, tc.hour, DEFAULT_VAELORA_CALENDAR);
      const date = worldHoursToCalendarDate(wh, DEFAULT_VAELORA_CALENDAR);
      expect(date.year).toBe(tc.year);
      expect(date.dayOfYear).toBe(tc.dayOfYear);
      expect(date.localHour).toBeCloseTo(tc.hour, 3);
    }
  });

  it('converts month and day-of-month to world hours seamlessly', () => {
    // 15 Blossomtide (Month index 4, day 15)
    // 4 months * 30 days = 120 days + 15 = day 135
    const wh = calendarMonthDayToWorldHours(3, 4, 15, 14, DEFAULT_VAELORA_CALENDAR);
    const date = worldHoursToCalendarDate(wh, DEFAULT_VAELORA_CALENDAR);
    expect(date.year).toBe(3);
    expect(date.monthIndex).toBe(4);
    expect(date.monthName).toBe('Blossomtide');
    expect(date.dayOfMonth).toBe(15);
    expect(date.dayOfYear).toBe(135);
  });

  it('procedurally generates X-day calendars for arbitrary planets and star systems', () => {
    // 365-day planet: 12 months x 30 days + 5 gap days
    const cal365 = generateWorldCalendar(365, 24, 30);
    expect(cal365.daysPerYear).toBe(365);
    expect(cal365.months.length).toBe(12);
    expect(cal365.intercalaryGap.daysCount).toBe(5);

    // 425-day planet: 14 months x 30 days + 5 gap days
    const cal425 = generateWorldCalendar(425, 24, 30);
    expect(cal425.daysPerYear).toBe(425);
    expect(cal425.months.length).toBe(14);
    expect(cal425.intercalaryGap.daysCount).toBe(5);

    // 280-day planet: 9 months x 30 days + 10 gap days
    const cal280 = generateWorldCalendar(280, 24, 30);
    expect(cal280.daysPerYear).toBe(280);
    expect(cal280.months.length).toBe(9);
    expect(cal280.intercalaryGap.daysCount).toBe(10);
  });

  it('projects celestial omens, equinoxes, and comet events onto calendar dates', () => {
    // Equinoxes
    const springEqEvents = getCalendarEventsForDay(1, Math.round((80 / 365) * 395), DEFAULT_VAELORA_CALENDAR);
    expect(springEqEvents.some((e) => e.type === 'equinox')).toBe(true);

    // Intercalary Gap Festival Days
    const gapEvents = getCalendarEventsForDay(1, 391, DEFAULT_VAELORA_CALENDAR);
    expect(gapEvents.some((e) => e.type === 'festival')).toBe(true);

    // Comet in Year 3 Day 55 (Peak Apparition)
    const cometY3 = getCalendarEventsForDay(3, 55, DEFAULT_VAELORA_CALENDAR);
    expect(cometY3.some((e) => e.type === 'comet' && e.title.includes('Peak'))).toBe(true);

    // Comet dormant in Year 4 Day 55
    const cometY4 = getCalendarEventsForDay(4, 55, DEFAULT_VAELORA_CALENDAR);
    expect(cometY4.some((e) => e.type === 'comet')).toBe(false);

    // Comet returns in Year 15 Day 55
    const cometY15 = getCalendarEventsForDay(15, 55, DEFAULT_VAELORA_CALENDAR);
    expect(cometY15.some((e) => e.type === 'comet')).toBe(true);
  });
});
