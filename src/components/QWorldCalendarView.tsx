import React, { useState, useEffect, useCallback } from 'react';
import {
  DEFAULT_VAELORA_CALENDAR,
  worldHoursToCalendarDate,
  calendarDateToWorldHours,
} from '../core/QWorldCalendar';
import { QWorldCalendarHeader } from './calendar/QWorldCalendarHeader';
import { QWorldCalendarYearBar } from './calendar/QWorldCalendarYearBar';
import { QWorldCalendarMonthTabs } from './calendar/QWorldCalendarMonthTabs';
import { QWorldCalendarGrid } from './calendar/QWorldCalendarGrid';
import { QWorldCalendarIntercalaryView } from './calendar/QWorldCalendarIntercalaryView';
import { QWorldCalendarRandomDrawer } from './calendar/QWorldCalendarRandomDrawer';

export const QWorldCalendarView: React.FC = () => {
  const [worldHours, setWorldHours] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('adventure2_sky_sync_state');
      if (raw) {
        const parsed = JSON.parse(raw) as { worldHours?: number };
        if (typeof parsed.worldHours === 'number' && Number.isFinite(parsed.worldHours)) {
          return parsed.worldHours;
        }
      }
    } catch (err: unknown) {
      console.warn('[QWorldCalendarView] Initial storage read warning:', err);
    }
    return 80 * 24 + 12;
  });

  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(() => {
    const cur = worldHoursToCalendarDate(80 * 24 + 12, DEFAULT_VAELORA_CALENDAR);
    return cur.monthIndex;
  });

  const [showRandomModal, setShowRandomModal] = useState<boolean>(false);

  // Sync calendar worldHours across BroadcastChannel and localStorage
  useEffect(() => {
    window.name = 'adventure2_calendar';
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('adventure2_sky_sync');
      channel.onmessage = (ev: MessageEvent<{ type?: string; source?: string; worldHours?: number }>) => {
        if (
          ev.data &&
          ev.data.source !== 'calendar' &&
          ev.data.type !== 'map-state' &&
          typeof ev.data.worldHours === 'number' &&
          Number.isFinite(ev.data.worldHours)
        ) {
          setWorldHours(ev.data.worldHours);
        }
      };
    } catch (err: unknown) {
      console.warn('[QWorldCalendarView] BroadcastChannel init warning:', err);
    }

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'adventure2_sky_sync_state' && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue) as { type?: string; source?: string; worldHours?: number };
          if (
            parsed.source !== 'calendar' &&
            parsed.type === 'time-sync' &&
            typeof parsed.worldHours === 'number' &&
            Number.isFinite(parsed.worldHours)
          ) {
            setWorldHours(parsed.worldHours);
          }
        } catch (err: unknown) {
          console.warn('[QWorldCalendarView] Storage parse warning:', err);
        }
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleUpdateWorldHours = useCallback((newHours: number) => {
    setWorldHours(newHours);
    const now = Date.now();
    const timeMsg = { type: 'time-sync' as const, source: 'calendar' as const, worldHours: newHours, updatedAt: now };
    try {
      const channel = new BroadcastChannel('adventure2_sky_sync');
      channel.postMessage(timeMsg);
      channel.close();
    } catch (err: unknown) {
      console.warn('[QWorldCalendarView] Post message warning:', err);
    }

    try {
      const raw = localStorage.getItem('adventure2_sky_sync_state');
      const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem('adventure2_sky_sync_state', JSON.stringify({ ...prev, ...timeMsg }));
    } catch (err: unknown) {
      console.warn('[QWorldCalendarView] LocalStorage write warning:', err);
    }
  }, []);

  const currentDate = worldHoursToCalendarDate(worldHours, DEFAULT_VAELORA_CALENDAR);

  const handleStepYear = (delta: number) => {
    const yearHours = DEFAULT_VAELORA_CALENDAR.daysPerYear * DEFAULT_VAELORA_CALENDAR.hoursPerDay;
    const nextHours = Math.max(0, worldHours + delta * yearHours);
    handleUpdateWorldHours(nextHours);
  };

  const handleYearChange = (newYear: number) => {
    const nextHours = calendarDateToWorldHours(
      newYear,
      currentDate.dayOfYear,
      currentDate.localHour,
      DEFAULT_VAELORA_CALENDAR
    );
    handleUpdateWorldHours(nextHours);
  };

  const currentMonth = DEFAULT_VAELORA_CALENDAR.months[selectedMonthIdx] ?? DEFAULT_VAELORA_CALENDAR.months[0];

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#020617', color: '#f8fafc', overflow: 'hidden' }}>
      <QWorldCalendarHeader
        currentDate={currentDate}
        onOpenMap={() => { window.open('/?view=map', 'adventure2_main_map'); }}
        onOpenSky={() => { window.open('/?view=sky', 'adventure2_sky_preview'); }}
        onOpenRandomModal={() => setShowRandomModal(true)}
      />

      <QWorldCalendarYearBar
        year={currentDate.year}
        onYearChange={handleYearChange}
        onStepYear={handleStepYear}
      />

      <QWorldCalendarMonthTabs
        config={DEFAULT_VAELORA_CALENDAR}
        selectedMonthIdx={selectedMonthIdx}
        currentMonthIdx={currentDate.monthIndex}
        isCurrentIntercalary={currentDate.isIntercalary}
        onSelectMonth={setSelectedMonthIdx}
      />

      {selectedMonthIdx === -1 ? (
        <QWorldCalendarIntercalaryView
          config={DEFAULT_VAELORA_CALENDAR}
          year={currentDate.year}
          currentDate={currentDate}
          onSelectDate={handleUpdateWorldHours}
        />
      ) : (
        <QWorldCalendarGrid
          config={DEFAULT_VAELORA_CALENDAR}
          month={currentMonth}
          year={currentDate.year}
          currentDate={currentDate}
          onSelectDate={handleUpdateWorldHours}
        />
      )}

      <QWorldCalendarRandomDrawer
        isOpen={showRandomModal}
        onClose={() => setShowRandomModal(false)}
      />
    </div>
  );
};
