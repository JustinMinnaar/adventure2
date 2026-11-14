// ============================================================================
// QWorldCalendar — Shared Multi-World Calendar Engine for Adventure2
// Handles 13-month x 30-day + N intercalary gap days (default 395 days),
// arbitrary X-day calendars for procedural worlds, date math, and event markers.
// ============================================================================

export interface QWorldCalendarMonth {
  index: number; // 0 to monthCount - 1
  name: string;
  shortName: string;
  daysCount: number; // typically 30
  season: 'Winter' | 'Spring' | 'Summer' | 'Autumn';
  lore: string;
}

export interface QWorldCalendarIntercalaryGap {
  name: string; // e.g. "The Reckoning Veil"
  daysCount: number; // N (typically 5)
  dayNames: string[]; // Names for each gap day
  lore: string;
}

export interface QWorldCalendarConfig {
  id: string;
  name: string;
  description: string;
  daysPerYear: number; // e.g. 395 (13 * 30 + 5)
  hoursPerDay: number; // e.g. 24
  months: QWorldCalendarMonth[];
  intercalaryGap: QWorldCalendarIntercalaryGap;
  weekDays: string[];
}

export interface QWorldCalendarDate {
  year: number; // 1-based (Year 1, Year 2...)
  dayOfYear: number; // 1 to daysPerYear
  localHour: number; // 0 to hoursPerDay (fractional)
  clockHour: number; // 0 to 23
  clockMinute: number; // 0 to 59
  clockSecond: number; // 0 to 59
  isIntercalary: boolean;
  monthIndex: number; // 0 to months.length - 1 (-1 if intercalary gap)
  monthName: string;
  dayOfMonth: number; // 1 to 30 (or 1 to N if intercalary)
  dayName: string;
  seasonName: string;
  dayOfWeekIndex: number;
  dayOfWeekName: string;
  formattedDate: string; // e.g. "14 Blossomtide, Year 3"
}

export interface QWorldCalendarDayEvent {
  id: string;
  title: string;
  type: 'solstice' | 'equinox' | 'full-moon' | 'ash-full' | 'comet' | 'festival';
  severity: 'info' | 'omen' | 'celestial';
  description: string;
  icon: string;
}

export const DEFAULT_WEEK_DAYS: string[] = [
  'Solas',   // Sunday / Sun day
  'Vaelis',  // Monday / Silver Moon day
  'Tears',   // Tuesday / Crystal Shards day
  'Morvath', // Wednesday / Dark Moon day
  'Astral',  // Thursday / Galaxy River day
  'Aether',  // Friday / Spirit & Star day
  'Crown',   // Saturday / Zenith Rest day
];

export const DEFAULT_VAELORA_MONTHS: QWorldCalendarMonth[] = [
  { index: 0, name: 'Deepfrost', shortName: 'DPF', daysCount: 30, season: 'Winter', lore: 'The deepest snows blankets the high crags under the winter stars.' },
  { index: 1, name: 'Rimewake', shortName: 'RMK', daysCount: 30, season: 'Winter', lore: 'Hoarfrost lines the valleys as early morning mists rise from frozen lakes.' },
  { index: 2, name: 'Stormthaw', shortName: 'STW', daysCount: 30, season: 'Spring', lore: 'Torrential gales melt the high peaks and rivers roar into flood plains.' },
  { index: 3, name: 'Greenrise', shortName: 'GRS', daysCount: 30, season: 'Spring', lore: 'Emerald moss and budding pines awaken along the southern valleys.' },
  { index: 4, name: 'Blossomtide', shortName: 'BLS', daysCount: 30, season: 'Spring', lore: 'Mountain meadows erupt in wild violet, azure, and gold flowers.' },
  { index: 5, name: 'Sunreach', shortName: 'SNR', daysCount: 30, season: 'Summer', lore: 'Solis climbs to high declination, warming the continental heartlands.' },
  { index: 6, name: 'Highflame', shortName: 'HFL', daysCount: 30, season: 'Summer', lore: 'Midsummer zenith heats the steppes and plains with relentless clarity.' },
  { index: 7, name: 'Goldreap', shortName: 'GRP', daysCount: 30, season: 'Summer', lore: 'Golden grain fields harvest under long twilight evenings.' },
  { index: 8, name: 'Leafward', shortName: 'LFW', daysCount: 30, season: 'Autumn', lore: 'Temperate deciduous forests turn crimson, copper, and bronze.' },
  { index: 9, name: 'Duskfall', shortName: 'DSK', daysCount: 30, season: 'Autumn', lore: 'Lengthening shadows herald chilly winds and migrating flocks.' },
  { index: 10, name: 'Frostveil', shortName: 'FRV', daysCount: 30, season: 'Autumn', lore: 'Crisp rime coats the fallen leaves and woodsmoke scents the air.' },
  { index: 11, name: 'Longnight', shortName: 'LNT', daysCount: 30, season: 'Winter', lore: 'The sun hangs low over the southern horizon, yielding long starry vigils.' },
  { index: 12, name: 'Shadowsend', shortName: 'SHS', daysCount: 30, season: 'Winter', lore: 'The 13th month of the year; shadows stretch longest before the gap.' },
];

export const DEFAULT_INTERCALARY_GAP: QWorldCalendarIntercalaryGap = {
  name: 'The Reckoning Veil',
  daysCount: 5,
  dayNames: [
    "Hearth-Rest",       // Day 1: Hearth-fires burn, debts forgiven
    "Moon's Vigil",      // Day 2: Silver vigil of Vaelis
    "Void-Watch",        // Day 3: Silence observed for the Black Moon
    "Star-Turn",         // Day 4: Celebration of the Astral River
    "Year's Threshold",  // Day 5: Crossing into the New Sun
  ],
  lore: 'The 5 intercalary days outside the months, where time stands unbound between the old sun and the new.',
};

export const DEFAULT_VAELORA_CALENDAR: QWorldCalendarConfig = {
  id: 'vaelora-standard',
  name: 'Vaelorian Solar Reckoning',
  description: '13 months of 30 days plus 5 intercalary festival days (395 solar days per year).',
  daysPerYear: 395,
  hoursPerDay: 24,
  months: DEFAULT_VAELORA_MONTHS,
  intercalaryGap: DEFAULT_INTERCALARY_GAP,
  weekDays: DEFAULT_WEEK_DAYS,
};

/**
 * Procedurally generates an X-day calendar for any arbitrary planet,
 * splitting total solar days into equal months (default 30 days) and an intercalary gap.
 */
export function generateWorldCalendar(
  totalSolarDays: number,
  hoursPerDay = 24,
  preferredMonthLength = 30
): QWorldCalendarConfig {
  if (totalSolarDays < 1) {
    throw new Error(`[QWorldCalendar] totalSolarDays must be positive (received: ${totalSolarDays})`);
  }
  const monthLen = Math.max(10, preferredMonthLength);
  const monthCount = Math.max(1, Math.floor(totalSolarDays / monthLen));
  const gapDays = totalSolarDays - monthCount * monthLen;

  const generatedMonths: QWorldCalendarMonth[] = [];
  const baseNames = [
    'Deepfrost', 'Rimewake', 'Stormthaw', 'Greenrise', 'Blossomtide',
    'Sunreach', 'Highflame', 'Goldreap', 'Leafward', 'Duskfall',
    'Frostveil', 'Longnight', 'Shadowsend', 'Aethertide', 'Crownveil', 'Starlight'
  ];

  for (let i = 0; i < monthCount; i++) {
    const fraction = (i + 0.5) / monthCount;
    let season: QWorldCalendarMonth['season'] = 'Winter';
    if (fraction >= 0.20 && fraction < 0.45) season = 'Spring';
    else if (fraction >= 0.45 && fraction < 0.70) season = 'Summer';
    else if (fraction >= 0.70 && fraction < 0.95) season = 'Autumn';

    const name = baseNames[i] ?? `Month ${i + 1}`;
    generatedMonths.push({
      index: i,
      name,
      shortName: name.slice(0, 3).toUpperCase(),
      daysCount: monthLen,
      season,
      lore: `The ${i + 1}${getOrdinalSuffix(i + 1)} month of the orbital year (${season}).`,
    });
  }

  const gapDayNames: string[] = [];
  for (let g = 1; g <= gapDays; g++) {
    gapDayNames.push(`Intercalary Day ${g}`);
  }

  return {
    id: `world-cal-${totalSolarDays}d`,
    name: `${totalSolarDays}-Day Solar Reckoning`,
    description: `${monthCount} months of ${monthLen} days plus ${gapDays} intercalary gap days.`,
    daysPerYear: totalSolarDays,
    hoursPerDay,
    months: generatedMonths,
    intercalaryGap: {
      name: gapDays > 0 ? 'The Year-End Intercalary Gap' : 'None',
      daysCount: gapDays,
      dayNames: gapDayNames,
      lore: `${gapDays} intercalary days separating the orbital years.`,
    },
    weekDays: DEFAULT_WEEK_DAYS,
  };
}

/**
 * Converts continuous world hours into a rich calendar date.
 */
export function worldHoursToCalendarDate(
  worldHours: number,
  config: QWorldCalendarConfig = DEFAULT_VAELORA_CALENDAR
): QWorldCalendarDate {
  const hpd = Math.max(1, config.hoursPerDay);
  const dpy = Math.max(1, config.daysPerYear);

  const safeHours = Math.max(0, worldHours);
  const dayFloor = Math.floor(safeHours / hpd);
  const yearZeroIdx = Math.floor(dayFloor / dpy);
  const year = yearZeroIdx + 1;
  const dayOfYear = dayFloor - yearZeroIdx * dpy + 1;

  const localHour = safeHours - dayFloor * hpd;
  const clockHour = Math.floor(localHour);
  const clockMinute = Math.floor((localHour - clockHour) * 60);
  const clockSecond = Math.floor(((localHour - clockHour) * 60 - clockMinute) * 60);

  const totalRegularDays = config.months.reduce((acc, m) => acc + m.daysCount, 0);
  const isIntercalary = dayOfYear > totalRegularDays;

  let monthIndex = -1;
  let monthName = config.intercalaryGap.name;
  let dayOfMonth = 1;
  let dayName = `Day ${dayOfYear}`;
  let seasonName = 'Intercalary';

  if (!isIntercalary) {
    let accumulatedDays = 0;
    for (let i = 0; i < config.months.length; i++) {
      const m = config.months[i];
      if (dayOfYear <= accumulatedDays + m.daysCount) {
        monthIndex = i;
        monthName = m.name;
        dayOfMonth = dayOfYear - accumulatedDays;
        dayName = `${dayOfMonth} ${m.name}`;
        seasonName = m.season;
        break;
      }
      accumulatedDays += m.daysCount;
    }
  } else {
    dayOfMonth = dayOfYear - totalRegularDays;
    const namedDay = config.intercalaryGap.dayNames[dayOfMonth - 1];
    dayName = namedDay ?? `Gap Day ${dayOfMonth}`;
    seasonName = 'Year-End Festival';
  }

  const dayOfWeekIndex = (dayFloor) % config.weekDays.length;
  const dayOfWeekName = config.weekDays[dayOfWeekIndex] ?? 'Solas';

  const formattedDate = isIntercalary
    ? `${dayName}, Year ${year}`
    : `${dayOfMonth} ${monthName}, Year ${year}`;

  return {
    year,
    dayOfYear,
    localHour,
    clockHour,
    clockMinute,
    clockSecond,
    isIntercalary,
    monthIndex,
    monthName,
    dayOfMonth,
    dayName,
    seasonName,
    dayOfWeekIndex,
    dayOfWeekName,
    formattedDate,
  };
}

/**
 * Converts year, dayOfYear, and hour into continuous worldHours.
 */
export function calendarDateToWorldHours(
  year: number,
  dayOfYear: number,
  localHour = 12,
  config: QWorldCalendarConfig = DEFAULT_VAELORA_CALENDAR
): number {
  const clampedYear = Math.max(1, year);
  const clampedDay = Math.max(1, Math.min(config.daysPerYear, dayOfYear));
  const totalDays = (clampedYear - 1) * config.daysPerYear + (clampedDay - 1);
  return totalDays * config.hoursPerDay + Math.max(0, Math.min(config.hoursPerDay - 0.001, localHour));
}

/**
 * Converts month and day-of-month into continuous worldHours.
 */
export function calendarMonthDayToWorldHours(
  year: number,
  monthIndex: number,
  dayOfMonth: number,
  localHour = 12,
  config: QWorldCalendarConfig = DEFAULT_VAELORA_CALENDAR
): number {
  if (monthIndex < 0 || monthIndex >= config.months.length) {
    // Intercalary gap
    const regularDays = config.months.reduce((acc, m) => acc + m.daysCount, 0);
    const dayOfYear = regularDays + Math.max(1, Math.min(config.intercalaryGap.daysCount, dayOfMonth));
    return calendarDateToWorldHours(year, dayOfYear, localHour, config);
  }

  let accumulatedDays = 0;
  for (let i = 0; i < monthIndex; i++) {
    accumulatedDays += config.months[i].daysCount;
  }
  const m = config.months[monthIndex];
  const dayOfYear = accumulatedDays + Math.max(1, Math.min(m.daysCount, dayOfMonth));
  return calendarDateToWorldHours(year, dayOfYear, localHour, config);
}

/**
 * Identifies celestial and cultural events for any specific day in the calendar.
 */
export function getCalendarEventsForDay(
  year: number,
  dayOfYear: number,
  config: QWorldCalendarConfig = DEFAULT_VAELORA_CALENDAR
): QWorldCalendarDayEvent[] {
  const events: QWorldCalendarDayEvent[] = [];
  const dpy = config.daysPerYear;

  // 1. Equinoxes and Solstices (approximate solar quarter days based on 80-day spring equinox offset)
  const springEqDay = Math.round((80 / 365) * dpy);
  const summerSolDay = Math.round(((80 + 91.25) / 365) * dpy);
  const autumnEqDay = Math.round(((80 + 182.5) / 365) * dpy);
  const winterSolDay = Math.round(((80 + 273.75) / 365) * dpy);

  if (dayOfYear === springEqDay) {
    events.push({
      id: 'vernal-equinox',
      title: 'Vernal Equinox',
      type: 'equinox',
      severity: 'celestial',
      description: 'Day and night stand in perfect balance as Solis crosses the celestial equator.',
      icon: '🌱',
    });
  } else if (dayOfYear === summerSolDay) {
    events.push({
      id: 'summer-solstice',
      title: 'Summer Solstice',
      type: 'solstice',
      severity: 'celestial',
      description: 'The longest day of the year; Solis achieves its highest northern zenith.',
      icon: '☀️',
    });
  } else if (dayOfYear === autumnEqDay) {
    events.push({
      id: 'autumnal-equinox',
      title: 'Autumnal Equinox',
      type: 'equinox',
      severity: 'celestial',
      description: 'The second balance of equal day and night before the descent into frost.',
      icon: '🍂',
    });
  } else if (dayOfYear === winterSolDay) {
    events.push({
      id: 'winter-solstice',
      title: 'Winter Solstice',
      type: 'solstice',
      severity: 'celestial',
      description: 'The shortest day and longest night of the orbital year.',
      icon: '❄️',
    });
  }

  // 2. Intercalary Gap Days
  const regularDays = config.months.reduce((acc, m) => acc + m.daysCount, 0);
  if (dayOfYear > regularDays) {
    const gapDayIdx = dayOfYear - regularDays - 1;
    const gapName = config.intercalaryGap.dayNames[gapDayIdx] ?? `Festival Day ${gapDayIdx + 1}`;
    events.push({
      id: `gap-day-${gapDayIdx + 1}`,
      title: gapName,
      type: 'festival',
      severity: 'info',
      description: `Day ${gapDayIdx + 1} of ${config.intercalaryGap.name}: Time outside the numbered months.`,
      icon: '🎉',
    });
  }

  // 3. Periodic Comet: The Red Harbinger (12-year orbit appearing in Year 3, Year 15, Year 27...)
  const isCometYear = year === 3 || (year > 3 && (year - 3) % 12 === 0);
  if (isCometYear && dayOfYear >= 30 && dayOfYear <= 80) {
    const isPeak = dayOfYear === 55;
    events.push({
      id: 'comet-harbinger',
      title: isPeak ? '☄️ The Red Harbinger (Perihelion Peak)' : '☄️ The Red Harbinger Visible',
      type: 'comet',
      severity: 'omen',
      description: isPeak
        ? 'Peak perihelion apparition! The crimson tail sweeps 4x moon width across the firmament.'
        : 'The terrifying pale red omen blazes in the northern night sky.',
      icon: '☄️',
    });
  }

  // 4. Primary Moon (Vaelis) Full Moon (synodic period 28 days)
  const totalDays = (year - 1) * dpy + (dayOfYear - 1);
  const moonPhaseFrac = (totalDays % 28) / 28;
  if (Math.abs(moonPhaseFrac - 0.5) < 0.035) {
    events.push({
      id: 'full-vaelis',
      title: 'Full Vaelis (Silver Tide)',
      type: 'full-moon',
      severity: 'celestial',
      description: 'Vaelis shines at full silver brilliance, casting deep clear shadows by night.',
      icon: '🌕',
    });
  }

  // 5. Black Moon (Morvath) Opposition Surge ("Ash-Full", period ~113 days)
  const morvathPhaseFrac = (totalDays % 113) / 113;
  if (Math.abs(morvathPhaseFrac - 0.5) < 0.015) {
    events.push({
      id: 'ash-full-morvath',
      title: 'Ash-Full Morvath',
      type: 'ash-full',
      severity: 'omen',
      description: 'The carbonaceous black moon flares with ember-red opposition surge.',
      icon: '🌑',
    });
  }

  return events;
}

function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}
