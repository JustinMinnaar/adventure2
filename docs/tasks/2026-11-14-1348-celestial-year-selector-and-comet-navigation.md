# TASK-20261114-1348: Celestial Calendar Year Selector & 12-Year Comet Apparition Navigation

- **Date / Time Reference**: `2026-11-14 13:48:00`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`
- **Task Slug**: `celestial-year-selector-and-comet-navigation`

---

## 1. Summary

Implemented direct **Year Selection & Stepping** controls in the celestial sky simulation (`QWorldSkyPreview`), enabling users to jump to any calendar year (specifically Year 3 and Year 15 to observe the 12-year periodic Red Harbinger comet). Provided year stepping controls (`-1y` / `+1y`), an editable numeric year input, quick year presets with automated peak apparition jump, keyboard shortcuts (`[` and `]`), live HUD comet indicator badges, and direct targeting integration in the Quick Select panel (`Y`).

---

## 2. Key Changes & Decisions

1. **Playback Bar Year Controls (`src/components/QWorldSkyPreview.tsx`)**:
   - Integrated a dedicated Year Selection Group into Row 2 of the playback bar:
     - `-1y` and `+1y` step buttons for single-click annual adjustments.
     - Direct numeric year input (`min={1}`, `max={9999}`) with fail-fast integer parsing.
     - Quick Year Presets dropdown (`Year 1 (Standard)`, `Year 2`, `Year 3 ☄️ Comet`, `Year 4`, `Year 5`, `Year 10`, `Year 15 ☄️ Comet (12y)`, `Year 27 ☄️ Comet (24y)`).
     - Automated peak night apparition positioning: choosing Year 3 or Year 15 from presets automatically positions the observer at Day 55 at 23:00 if currently outside the active apparition window.
     - Crimson highlight border and `☄️ Comet Year` / `☄️ Comet Active` badge when in an apparition year.

2. **Keyboard Shortcuts**:
   - Added `[` (step -1 year) and `]` (step +1 year) hotkeys with mode toasts, respecting input focus.

3. **HUD Readout & Comet Year Badging**:
   - Enhanced the top-left telemetry HUD to display an inline `☄️ Comet Year` / `☄️ Red Harbinger Active` badge when in year 3 or any $12n + 3$ return cycle.

4. **Quick Select Panel (`Y` key) Direct Comet Navigation**:
   - Clicking `☄️ The Red Harbinger` while inactive in the current year automatically transitions the calendar to Year 3 Day 55 at 23:00 and points the camera directly at the comet.

5. **Help Modal & Safe Coding Cleanups**:
   - Documented `[` and `]` year stepping hotkeys in Section 5 of the Help Modal (`?`).
   - Replaced empty `.catch(() => {})` calls with explicit error handlers per Rule 2 of `AGENTS.md`.

6. **Unit Tests (`src/tests/QWorldCelestial.test.ts`)**:
   - Added unit test asserting calendar year jumping, year stepping, local hour and day preservation, and periodic comet activity across years.

---

## 3. Affected Files

- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx): Added year selector controls, hotkeys `[` / `]`, HUD badge, and Quick Select comet navigation.
- [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts): Added unit test for calendar year navigation and stepping.
- [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md): Registered task entry.
- [`docs/tasks/2026-11-14-1348-celestial-year-selector-and-comet-navigation.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1348-celestial-year-selector-and-comet-navigation.md): Created task documentation report.

---

## 4. Validation & Verification

- `pnpm run typecheck`: Passed cleanly with 0 errors (`tsc --noEmit`).
- `pnpm test`: All 10 test suites and 48 tests passed in 3.65s.
- `pnpm run build`: Production bundle succeeded in 2.63s without warnings.

---

## 5. Commit Message Line

`- [2026-11-14 13:48] Celestial Year Selector & Comet Navigation: Added year input, presets, -1y/+1y stepping, '[' and ']' hotkeys, and automated comet apparition navigation.`
