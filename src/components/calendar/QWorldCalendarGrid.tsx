import React from 'react';
import {
  QWorldCalendarConfig,
  QWorldCalendarMonth,
  QWorldCalendarDate,
  getCalendarEventsForDay,
  calendarMonthDayToWorldHours,
} from '../../core/QWorldCalendar';

interface QWorldCalendarGridProps {
  config: QWorldCalendarConfig;
  month: QWorldCalendarMonth;
  year: number;
  currentDate: QWorldCalendarDate;
  onSelectDate: (worldHours: number) => void;
}

export const QWorldCalendarGrid: React.FC<QWorldCalendarGridProps> = ({
  config,
  month,
  year,
  currentDate,
  onSelectDate,
}) => {
  const days = Array.from({ length: month.daysCount }, (_, i) => i + 1);

  // Calculate day-of-year offset for this month
  let dayOffset = 0;
  for (let i = 0; i < month.index; i++) {
    dayOffset += config.months[i].daysCount;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '14px', overflowY: 'auto' }}>
      {/* Month description header */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#f8fafc', fontWeight: 800 }}>
            {month.name} (Month {month.index + 1} of {config.months.length})
          </h2>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            Season: <strong style={{ color: '#cbd5e1' }}>{month.season}</strong> • {month.lore}
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#64748b' }}>
          Days {dayOffset + 1}–{dayOffset + month.daysCount} of Year {year}
        </div>
      </div>

      {/* Weekday headers (7 columns) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px' }}>
        {config.weekDays.map((wd) => (
          <div
            key={wd}
            style={{
              padding: '6px',
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: '#94a3b8',
              background: '#0f172a',
              borderRadius: '4px',
            }}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* 30 days grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', flex: 1 }}>
        {days.map((d) => {
          const dayOfYear = dayOffset + d;
          const isToday =
            currentDate.year === year &&
            !currentDate.isIntercalary &&
            currentDate.monthIndex === month.index &&
            currentDate.dayOfMonth === d;
          const events = getCalendarEventsForDay(year, dayOfYear, config);

          return (
            <div
              key={d}
              onClick={() => {
                const wh = calendarMonthDayToWorldHours(year, month.index, d, currentDate.localHour, config);
                onSelectDate(wh);
              }}
              style={{
                minHeight: '75px',
                padding: '6px 8px',
                borderRadius: '6px',
                border: isToday ? '2px solid #38bdf8' : '1px solid #1e293b',
                background: isToday ? 'rgba(56, 189, 248, 0.12)' : '#090d16',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: isToday ? 800 : 600,
                    color: isToday ? '#38bdf8' : '#e2e8f0',
                  }}
                >
                  {d}
                </span>
                <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                  D{dayOfYear}
                </span>
              </div>

              {/* Event chips */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    title={ev.description}
                    style={{
                      fontSize: '10px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: getEventBg(ev.severity),
                      color: getEventColor(ev.severity),
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                    }}
                  >
                    <span>{ev.icon}</span>
                    <span>{ev.title}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function getEventBg(sev: string): string {
  switch (sev) {
    case 'omen': return 'rgba(239, 68, 68, 0.25)';
    case 'celestial': return 'rgba(56, 189, 248, 0.2)';
    default: return 'rgba(148, 163, 184, 0.15)';
  }
}

function getEventColor(sev: string): string {
  switch (sev) {
    case 'omen': return '#fca5a5';
    case 'celestial': return '#7dd3fc';
    default: return '#e2e8f0';
  }
}
