# TASK-20261114-1400: Shared Multi-World Calendar Engine, Dedicated Calendar Tab & Orbital Physics

- **Date / Time Reference**: `2026-11-14 14:00:00`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`
- **Task Slug**: `shared-calendar-and-orbital-mechanics`

---

## 1. Summary

Architected and implemented a shared multi-world calendar engine (`QWorldCalendar.ts`) and interactive calendar view (`QWorldCalendarView.tsx` with dedicated modular sub-components) synchronized in real-time across the 3D Planet View, Celestial Sky Preview, and the new Calendar Tab. Defined Vaelora's default calendar as 13 months of 30 days plus a 5-day intercalary year-end gap festival ("The Reckoning Veil") totaling 395 solar days per year. Implemented procedural $X$-day calendar partitioning for arbitrary procedural planets, and provided an in-depth astrophysical analysis of orbital and rotational mechanics when a world's orbit is not 365.25 days or its spin is not 24 hours.

---

## 2. Key Changes & Decisions

1. **Shared Calendar Core Engine (`src/core/QWorldCalendar.ts`)**:
   - Implemented `DEFAULT_VAELORA_CALENDAR`: 13 regular months of 30 days each (390 days), plus 5 intercalary festival gap days (Days 391–395: Hearth-Rest, Moon's Vigil, Void-Watch, Star-Turn, Year's Threshold).
   - `worldHoursToCalendarDate`: bidirectional date conversion providing year, dayOfYear, localHour, clock time, month, dayOfMonth, weekday, and formatted strings.
   - `generateWorldCalendar`: procedural partitioner for arbitrary $X$-day planets, dividing solar days into equal months and an intercalary gap.
   - `getCalendarEventsForDay`: marks celestial omens (Vernal Equinox, Summer Solstice, Autumnal Equinox, Winter Solstice, Full Vaelis, Ash-Full Morvath, and the 12-Year Red Harbinger Comet).

2. **Celestial Engine Alignment (`src/core/QWorldCelestial.ts`)**:
   - Updated `DEFAULT_CELESTIAL_CONFIG` to 395 days per year with 13 named months.
   - Scale-invariant vernal equinox calculation using `VERNAL_EQUINOX_FRACTION = 80 / 365`, ensuring all solar coordinates, seasonal transitions, eclipse projections, and comet mechanics scale smoothly with any arbitrary day count.

3. **Dedicated Interactive Calendar View & Modularity**:
   - `src/components/QWorldCalendarView.tsx`: top-level orchestrator with real-time `BroadcastChannel('adventure2_sky_sync')` and `localStorage` syncing.
   - `src/components/calendar/QWorldCalendarHeader.tsx`: top bar with time of day, quick navigation buttons to Planet Map and Celestial Sky.
   - `src/components/calendar/QWorldCalendarYearBar.tsx`: year stepper, numeric year input, quick year presets, and comet year indicator badge.
   - `src/components/calendar/QWorldCalendarMonthTabs.tsx`: 13 season-colored month tabs plus intercalary gap tab.
   - `src/components/calendar/QWorldCalendarGrid.tsx`: 30-day month grid with weekday headers, day numbers, day-of-year labels, current day highlight, and clickable celestial event chips.
   - `src/components/calendar/QWorldCalendarIntercalaryView.tsx`: 5-day festival card view for The Reckoning Veil.
   - `src/components/calendar/QWorldCalendarRandomDrawer.tsx`: procedural $X$-day calendar calculator modal.

4. **Multi-View Integration**:
   - `src/main.tsx`: routed `?view=calendar` to render `QWorldCalendarView`.
   - `src/components/QWorldToolbar.tsx`: added `📅` calendar button alongside `🌙` sky button.
   - `src/components/QWorldSkyPreview.tsx`: added `📅 Calendar` button to sky header.

5. **Unit & Functional Tests (`src/tests/QWorldCalendar.test.ts`)**:
   - Added 6 unit tests validating the 13-month $\times$ 30-day + 5-day gap calendar, date conversions, procedural $X$-day generation, and celestial event projection.

---

## 3. Affected Files

- [`src/core/QWorldCalendar.ts`](file:///f:/Dev/adventure2/src/core/QWorldCalendar.ts): Created calendar engine.
- [`src/components/calendar/QWorldCalendarHeader.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarHeader.tsx): Created calendar header.
- [`src/components/calendar/QWorldCalendarYearBar.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarYearBar.tsx): Created year navigation bar.
- [`src/components/calendar/QWorldCalendarMonthTabs.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarMonthTabs.tsx): Created month tabs.
- [`src/components/calendar/QWorldCalendarGrid.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarGrid.tsx): Created 30-day month grid.
- [`src/components/calendar/QWorldCalendarIntercalaryView.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarIntercalaryView.tsx): Created intercalary gap view.
- [`src/components/calendar/QWorldCalendarRandomDrawer.tsx`](file:///f:/Dev/adventure2/src/components/calendar/QWorldCalendarRandomDrawer.tsx): Created procedural calendar modal.
- [`src/components/QWorldCalendarView.tsx`](file:///f:/Dev/adventure2/src/components/QWorldCalendarView.tsx): Created top-level calendar view.
- [`src/main.tsx`](file:///f:/Dev/adventure2/src/main.tsx): Added `?view=calendar` routing.
- [`src/components/QWorldToolbar.tsx`](file:///f:/Dev/adventure2/src/components/QWorldToolbar.tsx): Added `📅` calendar button.
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx): Added `📅 Calendar` button.
- [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts): Aligned to 395 days and 13 months.
- [`src/tests/QWorldCalendar.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCalendar.test.ts): Unit test suite for calendar engine.
- [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md): Registered task entry.
- [`docs/tasks/2026-11-14-1400-shared-calendar-and-orbital-mechanics.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1400-shared-calendar-and-orbital-mechanics.md): Created task report.

---

## 4. Validation & Verification

- `pnpm run typecheck`: Passed with 0 errors (`tsc --noEmit`).
- `pnpm test`: 11 test suites and 54 tests passed in 3.05s.
- `pnpm run build`: Production bundle succeeded in 2.68s.

---

## 5. Commit Message Line

`- [2026-11-14 14:00] Shared Calendar & Orbital Mechanics: Added 13-month 395-day calendar engine, dedicated interactive calendar tab, multi-view sync, and procedural X-day world calendar generation.`
