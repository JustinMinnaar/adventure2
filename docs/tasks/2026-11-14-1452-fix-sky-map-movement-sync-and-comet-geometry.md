# TASK-20261114-1452: Fix Sky Map Movement Sync Feedback Loop & Comet Visibility Geometry

- **Date / Time Reference**: 2026-11-14 14:52:00
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`
- **Summary**: Investigated and resolved why the sky map was not moving correctly during playback or time navigation. Discovered that the diurnal/sidereal math across Year 1 and Year 3 is mathematically pure and identical, but two separate issues caused the problem: (1) an unthrottled BroadcastChannel ping-pong loop between the open 3D Map tab and Sky Preview tab that repeatedly snapped `worldHours` backwards to throttled background-tab timestamps, and (2) comet apparition shortcuts defaulted to hour 23:00 when the comet had already set and was 40° underground, aiming the camera downward into the dark ground polygon.
- **Key Changes & Decisions**:
  1. **BroadcastChannel Synchronization Architecture (`src/components/QWorldSkyPreview.tsx` & `src/App.tsx`)**:
     - In `QWorldSkyPreview.tsx`, guarded `applySync` to reject external `worldHours` while simulation playback is active (`playing === true`) or when the user recently interacted with time controls (`lastLocalEditRef.current > Date.now() - 2000`).
     - Reused a persistent `BroadcastChannel` instance and throttled outgoing `worldHours` updates during playback to at most 4 updates/sec (250 ms), eliminating 60 FPS message flooding.
     - In `App.tsx`, tagged outgoing payloads with `source: 'map'` and only included `worldHours` when the user actively moved the toolbar time slider (`userEditedMapHoursRef`), preventing background tabs from echoing stale timestamps back to the celestial view.
  2. **Comet Day 55 Night Visibility Window**:
     - Verified orbital geometry: On Day 55 around perihelion, Solis sets at ~18:15. Between 18:30 and 19:30 (dusk/dark), the comet is high in the western sky at **+14.3° to +25° altitude** with its 4× moon width red tail streaming upward.
     - At 23:00, the comet has already set and is **-40.3° below the horizon**; aiming at it turned the camera into the subterranean dirt.
     - Updated all apparition jump targets (Year 3, Year 15, and Quick Select 'Y') from hour `23` to `18.5` (18:30 dusk), directing the camera straight at the visible comet.
  3. **Regression Tests & Performance Assertion (`src/tests/QWorldCelestial.test.ts`)**:
     - Added assertions confirming diurnal/sidereal rate consistency (15.038°/hr) in Year 1 vs Year 3.
     - Added test verifying Year 3 Day 55 comet is visible in evening twilight (18:30) and subterranean by 23:00.
     - Added performance benchmark asserting `computeCelestialSnapshot` executes in `< 0.5 ms` (< 15 ms across 100 iterations), well within the 60 FPS budget.
- **Affected Files**:
  - [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)
  - [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1452-fix-sky-map-movement-sync-and-comet-geometry.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1452-fix-sky-map-movement-sync-and-comet-geometry.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): clean pass (code 0).
  - `pnpm test` (`vitest run`): all 12 test suites and 67 tests passing.
  - `pnpm run build`: production bundle successfully built in 2.94s.
- **Commit Message Line**:
  - `- [2026-11-14 14:52] Fix Sky Map Movement Sync & Comet Geometry: Eliminated BroadcastChannel ping-pong feedback loop between Map and Sky tabs, guarded playback clock, and adjusted comet apparition jump hour to 18:30 dusk`
