import React from 'react';
import { QWorldCalendarConfig } from '../../core/QWorldCalendar';

interface QWorldCalendarMonthTabsProps {
  config: QWorldCalendarConfig;
  selectedMonthIdx: number; // 0..12, or -1 for intercalary gap
  currentMonthIdx: number;
  isCurrentIntercalary: boolean;
  onSelectMonth: (monthIdx: number) => void;
}

export const QWorldCalendarMonthTabs: React.FC<QWorldCalendarMonthTabsProps> = ({
  config,
  selectedMonthIdx,
  currentMonthIdx,
  isCurrentIntercalary,
  onSelectMonth,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 12px',
        background: '#090d16',
        borderBottom: '1px solid #1e293b',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      {config.months.map((m) => {
        const isSelected = selectedMonthIdx === m.index;
        const isCurrent = currentMonthIdx === m.index && !isCurrentIntercalary;
        const seasonBg = getSeasonColor(m.season);

        return (
          <button
            key={m.index}
            onClick={() => onSelectMonth(m.index)}
            title={`${m.name} (${m.season}, 30 days) • ${m.lore}`}
            style={{
              padding: '5px 10px',
              borderRadius: '5px',
              border: isSelected ? '1px solid #38bdf8' : isCurrent ? '1px solid #eab308' : '1px solid #1e293b',
              background: isSelected ? '#0369a1' : '#0f172a',
              color: isSelected ? '#ffffff' : '#cbd5e1',
              fontSize: '11px',
              fontWeight: isSelected || isCurrent ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              position: 'relative',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: seasonBg }} />
            <span>
              {m.index + 1}. {m.name}
            </span>
            {isCurrent && (
              <span style={{ fontSize: '8px', color: '#fde047', marginLeft: '2px' }}>●</span>
            )}
          </button>
        );
      })}

      {/* The 14th tab: Intercalary Festival Gap */}
      <button
        onClick={() => onSelectMonth(-1)}
        title={`${config.intercalaryGap.name} (${config.intercalaryGap.daysCount} days outside the months)`}
        style={{
          padding: '5px 12px',
          borderRadius: '5px',
          border: selectedMonthIdx === -1 ? '1px solid #f59e0b' : isCurrentIntercalary ? '1px solid #eab308' : '1px solid #451a03',
          background: selectedMonthIdx === -1 ? '#78350f' : 'rgba(120, 53, 15, 0.4)',
          color: selectedMonthIdx === -1 ? '#fef3c7' : '#fcd34d',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
        }}
      >
        <span>🎉</span>
        <span>{config.intercalaryGap.name} ({config.intercalaryGap.daysCount}d)</span>
        {isCurrentIntercalary && <span style={{ fontSize: '8px', color: '#fde047' }}>●</span>}
      </button>
    </div>
  );
};

function getSeasonColor(season: string): string {
  switch (season) {
    case 'Spring': return '#34d399';
    case 'Summer': return '#fbbf24';
    case 'Autumn': return '#fb923c';
    case 'Winter': return '#38bdf8';
    default: return '#a855f7';
  }
}
