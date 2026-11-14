import React from 'react';
import { QWorldCalendarDate } from '../../core/QWorldCalendar';

interface QWorldCalendarHeaderProps {
  currentDate: QWorldCalendarDate;
  onOpenMap: () => void;
  onOpenSky: () => void;
  onOpenRandomModal: () => void;
}

export const QWorldCalendarHeader: React.FC<QWorldCalendarHeaderProps> = ({
  currentDate,
  onOpenMap,
  onOpenSky,
  onOpenRandomModal,
}) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>
          📅 World Calendar
        </span>
        <span
          style={{
            fontSize: '11px',
            color: '#38bdf8',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '999px',
            padding: '2px 8px',
            fontWeight: 600,
          }}
        >
          395 Solar Days • 13 Months × 30d + 5 Gap
        </span>
        <span style={{ fontSize: '12px', color: '#fde68a', fontWeight: 600 }}>
          🕒 {String(currentDate.clockHour).padStart(2, '0')}:{String(currentDate.clockMinute).padStart(2, '0')}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={onOpenRandomModal}
          style={navBtnStyle('#475569', '#334155')}
          title="Explore procedural X-day calendars for arbitrary planets"
        >
          ⚙️ X-Day Worlds
        </button>
        <button
          onClick={onOpenMap}
          style={navBtnStyle('#0284c7', '#0369a1')}
          title="Return to 3D World Map View"
        >
          🗺️ Planet Map
        </button>
        <button
          onClick={onOpenSky}
          style={navBtnStyle('#7c3aed', '#6d28d9')}
          title="Open Celestial Sky Preview"
        >
          🌙 Celestial Sky
        </button>
      </div>
    </header>
  );
};

function navBtnStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: '6px',
    border: `1px solid ${border}`,
    background: bg,
    color: '#f8fafc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };
}
