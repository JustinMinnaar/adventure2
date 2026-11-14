# TASK-20261114-1319: Climate Latitude Bands, Orbital Seasons & Planetary Day/Night Shadow

- **Date / Time Reference**: `2026-11-14 13:19:45`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`

## Summary
Reviewed and overhauled temperature, rainfall, and biome generation to establish realistic latitude climate bands (warm equatorial `|lat| <= 15°`, temperate `15°..55°`, cool/cold polar `> 55°` with significantly reduced green vegetation), linked planetary seasons to the solar calendar's orbital axial tilt (`23.4°`), added four Northern Hemisphere season quick-jump buttons + time-of-day controls in the toolbar, and added a real-time day/night shadow terminator on the 3D planet.

## Key Changes & Decisions
- **Climate Bands & Biome Generation ([`QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts))**:
  - Replaced `1 - |sin(lat)| + noise` temperature with `Math.pow(cos(geoLatRad), 1.35) - elevCool`.
  - Added `coldDryness` so cold polar air holds less moisture.
  - Removed the `|| temperature <= 0.5` Forest fallback that forced cold wet latitudes into green forest; restricted polar zones (`> 55°`) to snow/ice and tundra rock with only sparse sheltered boreal forest.
- **Orbital Seasons & Solar Calendar ([`QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts))**:
  - Added `computeSolarDeclinationDeg`, `computeSubsolarLatLon`, `getNorthernSeasonWorldHours`, and `getNorthernSeasonFromWorldHours` driven by `axialTiltDeg` (`23.4°`) and `daysPerYear` (`365`).
- **Hemispheric Seasonal Rendering & Workers ([`QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts), [`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts), [`QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts), [`QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts))**:
  - Replaced uniform `planetTemp` with `solarDeclinationDeg` and `computeSeasonalWarmth(worldZ, height, solarDeclinationDeg)` so Northern and Southern hemispheres experience opposite winter/summer snowlines, foliage dormancy, and heat maps.
- **Toolbar, Day/Night Shadow & Sky Sync ([`QWorldToolbar.tsx`](file:///f:/Dev/adventure2/src/components/QWorldToolbar.tsx), [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx), [`App.tsx`](file:///f:/Dev/adventure2/src/App.tsx), [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
  - Added four Northern Hemisphere season icon-buttons (`Spr`, `Sum`, `Aut`, `Win`) and `−2h` / `HH:00 • D<day>` / `+2h` solar time controls synced with the Sky Preview via `localStorage` and `BroadcastChannel('adventure2_sky_sync')`.
  - Added `uSunDir` and `uWorldSpan` shader uniforms in `QWorld3DViewport.tsx` to render the day/night shadow terminator across the planet.
- **Tests ([`QWorldClimateSeason.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldClimateSeason.test.ts))**:
  - Added unit tests covering solar declination, subsolar longitude, opposite-hemisphere seasonal warmth, and polar vegetation restriction.

## Affected Files
- [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
- [`src/core/QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts)
- [`src/core/QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts)
- [`src/workers/QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts)
- [`src/workers/QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts)
- [`src/workers/QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts)
- [`src/components/QWorldToolbar.tsx`](file:///f:/Dev/adventure2/src/components/QWorldToolbar.tsx)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
- [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
- [`src/tests/QWorldClimateSeason.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldClimateSeason.test.ts)

## Validation & Verification
- `pnpm run typecheck`: Passed (0 errors)
- `pnpm test`: Passed (10 test files, 45 tests)

## Commit Message Line
- [2026-11-14 13:19] Climate Bands, Orbital Seasons & Day/Night Shadow: Added latitude climate bands, axial-tilt winter/summer cycle synced to solar calendar, 4 season buttons, and planetary day/night shading
