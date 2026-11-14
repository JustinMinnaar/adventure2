import React, { useState } from 'react';
import { generateWorldCalendar } from '../../core/QWorldCalendar';

interface QWorldCalendarRandomDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QWorldCalendarRandomDrawer: React.FC<QWorldCalendarRandomDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const [customDays, setCustomDays] = useState<number>(365);
  const [monthLength, setMonthLength] = useState<number>(30);

  if (!isOpen) return null;

  const generated = generateWorldCalendar(customDays, 24, monthLength);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '560px',
          maxWidth: '96vw',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#f8fafc', fontWeight: 800 }}>
            ⚙️ Procedural X-Day World Calendars
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
          For procedural worlds where orbital period or spin speed yields an arbitrary count of solar days (e.g. 280, 365, 395, 425),
          the engine automatically partitions $X$ days into equal 30-day months with an intercalary festival gap.
        </p>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8' }}>
            Total Solar Days (X):
            <input
              type="number"
              min={50}
              max={1200}
              value={customDays}
              onChange={(e) => setCustomDays(Math.max(10, parseInt(e.target.value, 10) || 10))}
              style={{ width: '70px', marginLeft: '6px', padding: '3px', background: '#020617', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px' }}
            />
          </label>

          <label style={{ fontSize: '12px', color: '#94a3b8' }}>
            Month Length:
            <input
              type="number"
              min={10}
              max={60}
              value={monthLength}
              onChange={(e) => setMonthLength(Math.max(10, parseInt(e.target.value, 10) || 10))}
              style={{ width: '50px', marginLeft: '6px', padding: '3px', background: '#020617', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px' }}
            />
          </label>
        </div>

        {/* Results readout */}
        <div style={{ padding: '12px', background: '#020617', border: '1px solid #1e293b', borderRadius: '6px', fontSize: '12px', color: '#cbd5e1' }}>
          <div><strong>Configured Breakdown:</strong> {generated.description}</div>
          <div style={{ marginTop: '4px' }}>
            • Regular Months: <strong>{generated.months.length}</strong> ({generated.months.map((m) => m.name).join(', ')})
          </div>
          <div style={{ marginTop: '4px' }}>
            • Intercalary Gap: <strong>{generated.intercalaryGap.daysCount} days</strong> ({generated.intercalaryGap.name})
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            padding: '7px 14px',
            borderRadius: '6px',
            border: 'none',
            background: '#0284c7',
            color: '#ffffff',
            fontWeight: 700,
            cursor: 'pointer',
            alignSelf: 'flex-end',
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
};
