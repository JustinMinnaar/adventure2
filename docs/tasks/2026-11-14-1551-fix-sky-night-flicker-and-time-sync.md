# TASK-20261114-1551: Fix Night Sky Flicker, Backwards Patch Jumps & Multi-Tab Time Sync

- **Date / Time Reference**: 2026-11-14 15:51:54
- **Status**: `Pending Commit`
- **Summary**: Eliminated night-time sky simulation stalls, flickering, and backwards-jumping galaxy star patches, fixed midnight (`00:00`) omen-scan performance bottlenecks across `QWorldCelestial` and `QWorldSkyPreview`, and isolated explicit multi-tab `'time-sync'` events from periodic `'map-state'` broadcasts so globe `+2h` / `-2h` / calendar time changes never snap back.
- **Key Changes & Decisions**:
  1. **60 FPS Prerendered Mist Overlays & Stable Projection (`src/core/QWorldSkyMistTextures.ts` & `src/components/QWorldSkyPreview.tsx`)**:
     - Created [`QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts) to precompute 6 cached transparent `HTMLCanvasElement` Gaussian mist textures (`galaxySpine`, `galaxyCore`, `galaxyPatchBlue`, `galaxyPatchLavender`, `galaxyDarkRift`, `chrysalisNebula`) via $C^\infty$ 2D analytical Gaussian + Hann-window profiles with sub-LSB dithering.
     - Updated `drawGalaxyCloud` and `drawColouredNebula` to composite the prerendered transparent mist textures via `ctx.drawImage(...)` (`collectVisibleGalaxyRuns`, `drawGalaxyMistStamp`, `drawGalaxyMistRun`), eliminating both Canvas2D `ctx.filter` stalls and hard concentric stroke lines.
     - Anchored Galaxy Cloud star patches to fixed catalog node indices (`curr.idx % 3 !== 0`) instead of filtered array offsets (`i += 3`), replaced chord tangents with local per-node `runTangentAt` / `runStepPxAt`, scaled `seamJumpThresholdPx` (`Math.max(280, 14 * degToPx)`), and widened Ground (`projectUnitVec` `marginPx`), Surround (`projectSurroundCloud`), and Zenith Dome (`projectDomeSky`) altitude/edge bounds (`-20°` / `-16°`) to prevent horizon cap popping.
  2. **Omen Scan, Rise/Set Cache & Snapshot Fast Path (`src/core/QWorldCelestial.ts` & `src/components/QWorldSkyPreview.tsx`)**:
     - Added mathematical comet apparition window overlap detection in `scanUpcomingOmens`, excluded out-of-window `'comet-apparition'` and analytically-seeded solar eclipses from `loopTargetTypes`, and stepped at `stepHours = 2.0`.
     - Upgraded `solveRiseSetForDay` `riseSetCache` key to 3-decimal lat/lon + `config.comet` fields with cap 64.
     - Added optional `includeShards = includeRiseSet` parameter to `computeCelestialSnapshot`, skipping the 90-shard projection loop when `includeShards === false` (using analytic `visibleFraction`) for fast `scanUpcomingOmens`, `refineEclipseCandidate`, and `computeDailySkyArc`.
     - Added a 30-day `omenAnchorRef` cache in `QWorldSkyPreview.tsx` during active playback so midnight boundaries no longer trigger omen scans every frame.
  3. **Multi-Tab Time Sync Separation (`src/App.tsx`, `src/components/QWorldToolbar.tsx`, `src/components/QWorldCalendarView.tsx`, `src/components/QWorldSkyPreview.tsx`)**:
     - Replaced `App.tsx` `[buildSkySyncPayload]` listener teardown with persistent `skySyncChannelRef` + `worldHoursRef`, switched periodic broadcasts to `type: 'map-state'`, emitted explicit `{ type: 'time-sync', source: 'map', worldHours }` from `handleToolbarWorldHoursChange`, and replaced empty `catch {}` blocks with `console.warn`.
     - Removed passive `useEffect([worldHours, playing])` broadcasts in `QWorldSkyPreview.tsx`; separated `applyManualWorldHours` / `broadcastSkyTime`, throttled rAF broadcasts to `250ms` only when `!document.hidden`, paused hidden playback when `'time-sync'` arrives from another tab, and ignored `'map-state'` in `QWorldSkyPreview.tsx` and `QWorldCalendarView.tsx`.
     - Unified named window targets (`adventure2_main_map`, `adventure2_sky_preview`, `adventure2_calendar`) across `App.tsx`, `QWorldToolbar.tsx`, `QWorldSkyPreview.tsx`, and `QWorldCalendarView.tsx`.
  4. **Unit & Performance Tests (`src/tests/QWorldCelestial.test.ts`)**:
     - Added `reuses cached daily rise/set data across 60 animation frames within the same day (<15ms total)`, `completes scanUpcomingOmens in Year 1 within 50ms without stalling on Year 3 comet`, and `generates C-infinity Gaussian mist textures with smooth border falloff and constant spine overlap`.
- **Affected Files**:
  - [`src/core/QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts)
  - [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
  - [`src/components/QWorldToolbar.tsx`](file:///f:/Dev/adventure2/src/components/QWorldToolbar.tsx)
  - [`src/components/QWorldCalendarView.tsx`](file:///f:/Dev/adventure2/src/components/QWorldCalendarView.tsx)
  - [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)
  - [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1551-fix-sky-night-flicker-and-time-sync.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1551-fix-sky-night-flicker-and-time-sync.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 12 passed (12)`, `Tests 72 passed (72)` (including `QWorldCelestial.test.ts` 16/16).
  - `pnpm run build` (`tsc && vite build`): exited with code `0` (`dist/` built in `2.71s`).
- **Commit Message Line**:
  - `- [2026-11-14 15:51] Fix Night Sky Flicker, Soft Mist Overlays & Multi-Tab Time Sync: Added cached C-infinity Gaussian mist textures, eliminated galaxy patch jumping, optimized omen/eclipse scanning, and isolated explicit 'time-sync' events across Map, Sky, and Calendar tabs`
