import React from 'react';
import {
  QWorldCalendarConfig,
  QWorldCalendarDate,
  getCalendarEventsForDay,
  calendarDateToWorldHours,
} from '../../core/QWorldCalendar';

interface QWorldCalendarIntercalaryViewProps {
  config: QWorldCalendarConfig;
  year: number;
  currentDate: QWorldCalendarDate;
  onSelectDate: (worldHours: number) => void;
}

export const QWorldCalendarIntercalaryView: React.FC<QWorldCalendarIntercalaryViewProps> = ({
  config,
  year,
  currentDate,
  onSelectDate,
}) => {
  const gap = config.intercalaryGap;
  const regularDays = config.months.reduce((acc, m) => acc + m.daysCount, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px', overflowY: 'auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', color: '#fcd34d', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🎉</span>
          <span>{gap.name} (Year-End Festival)</span>
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#cbd5e1' }}>
          {gap.lore} (Days {regularDays + 1}–{config.daysPerYear} of Year {year})
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {gap.dayNames.map((name, idx) => {
          const dayNumber = idx + 1;
          const dayOfYear = regularDays + dayNumber;
          const isToday =
            currentDate.year === year &&
            currentDate.isIntercalary &&
            currentDate.dayOfMonth === dayNumber;
          const events = getCalendarEventsForDay(year, dayOfYear, config);

          return (
            <div
              key={name}
              onClick={() => {
                const wh = calendarDateToWorldHours(year, dayOfYear, currentDate.localHour, config);
                onSelectDate(wh);
              }}
              style={{
                padding: '16px',
                borderRadius: '8px',
                border: isToday ? '2px solid #f59e0b' : '1px solid #78350f',
                background: isToday ? 'rgba(245, 158, 11, 0.2)' : 'rgba(30, 15, 5, 0.65)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#fcd34d', fontWeight: 700, textTransform: 'uppercase' }}>
                  Festival Day {dayNumber}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                  D{dayOfYear}
                </span>
              </div>

              <div style={{ fontSize: '16px', fontWeight: 800, color: '#fef3c7' }}>
                {name}
              </div>

              <div style={{ fontSize: '11px', color: '#fde68a', lineHeight: 1.4 }}>
                {events.map((e) => e.description).join(' ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
