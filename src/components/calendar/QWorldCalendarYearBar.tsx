import React from 'react';

interface QWorldCalendarYearBarProps {
  year: number;
  onYearChange: (year: number) => void;
  onStepYear: (delta: number) => void;
}

export const QWorldCalendarYearBar: React.FC<QWorldCalendarYearBarProps> = ({
  year,
  onYearChange,
  onStepYear,
}) => {
  const isCometYear = year === 3 || (year > 3 && (year - 3) % 12 === 0);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: '#090d16',
        borderBottom: '1px solid #1e293b',
        flexWrap: 'wrap',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={() => onStepYear(-1)} style={stepBtnStyle} title="Step back 1 year ([ hotkey)">
          ◀ -1 Year
        </button>

        <span style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Year:
          <input
            type="number"
            min={1}
            max={9999}
            value={year}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 1) onYearChange(val);
            }}
            style={{
              width: '60px',
              padding: '2px 6px',
              borderRadius: '4px',
              border: isCometYear ? '1px solid #ef4444' : '1px solid #334155',
              background: isCometYear ? '#450a0a' : '#020617',
              color: isCometYear ? '#f87171' : '#f8fafc',
              fontFamily: 'monospace',
              fontSize: '13px',
              fontWeight: 700,
              textAlign: 'center',
            }}
          />
        </span>

        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: isCometYear ? '1px solid #ef4444' : '1px solid #334155',
            background: isCometYear ? '#450a0a' : '#020617',
            color: isCometYear ? '#f87171' : '#cbd5e1',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          <option value={1}>Year 1 (Founding Era)</option>
          <option value={2}>Year 2</option>
          <option value={3}>Year 3 ☄️ Comet (The Red Harbinger)</option>
          <option value={4}>Year 4</option>
          <option value={5}>Year 5</option>
          <option value={10}>Year 10</option>
          <option value={15}>Year 15 ☄️ Comet Return (12y orbit)</option>
          <option value={27}>Year 27 ☄️ Comet Return (24y orbit)</option>
          {![1, 2, 3, 4, 5, 10, 15, 27].includes(year) && <option value={year}>Year {year}</option>}
        </select>

        <button onClick={() => onStepYear(1)} style={stepBtnStyle} title="Step forward 1 year (] hotkey)">
          +1 Year ▶
        </button>
      </div>

      {isCometYear && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: '999px',
            background: 'rgba(239, 68, 68, 0.18)',
            border: '1px solid #ef4444',
            color: '#fca5a5',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          <span>☄️</span>
          <span>12-Year Periodic Comet Apparition Year! (Days 30–80)</span>
        </div>
      )}
    </div>
  );
};

const stepBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '5px',
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#e2e8f0',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
};
