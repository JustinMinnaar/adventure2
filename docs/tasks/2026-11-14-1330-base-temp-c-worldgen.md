# TASK-20261114-1330: Base Planet Temperature Slider (0°C Ice to 50°C Extreme)

- **Date / Time Reference**: `2026-11-14 13:30:36`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`

## Summary
Added a `Base Temp` (`0°C` ice to `50°C` extreme, default `10°C`) slider to the Generate World panel and wired it through temperature, rainfall, and foliage/biome generation as well as the `Temp`, `Rain`, and seasonal `Normal` terrain views.

## Key Changes & Decisions
- **World Generation ([`QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts))**:
  - Added `baseTempC` (`0..50`, default `10`) to `WorldGenOptions` and `DEFAULT_WORLD_GEN_OPTIONS`.
  - Applied `baseTempOffset = (opts.baseTempC - 10) * 0.025` to `temperature`, which in turn drives `coldDryness`, `heatAridity`, `rainByte`, and biome assignment (ice/snow expansion at `0°C`, desert/extreme-heat expansion at `50°C`).
- **Terrain Mesh & Workers ([`QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts), [`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts), [`QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts), [`QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts))**:
  - Added `baseTempC` parameter (default `10`) to `computeSeasonalWarmth`, `applyClimateBiomeColor`, `computeFoliagePropAppearance`, and chunk mesh/worker requests so `Temp` and `Rain` views reflect `baseTempC` live.
- **UI & Wiring ([`QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx), [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx), [`App.tsx`](file:///f:/Dev/adventure2/src/App.tsx))**:
  - Added the `Base Temp` (`0°C`–`50°C`) slider in the Generate World panel and passed `worldGenOptions.baseTempC` to `QWorld3DViewport`.
- **Tests ([`QWorldClimateSeason.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldClimateSeason.test.ts))**:
  - Added test verifying `DEFAULT_WORLD_GEN_OPTIONS.baseTempC === 10`, `computeSeasonalWarmth` ordering across `0°C` / `10°C` / `50°C`, and snow/foliage/rainfall/desert shifts.

## Affected Files
- [`src/core/QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts)
- [`src/core/QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts)
- [`src/workers/QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts)
- [`src/workers/QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts)
- [`src/workers/QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts)
- [`src/components/QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)
- [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
- [`src/tests/QWorldClimateSeason.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldClimateSeason.test.ts)

## Validation & Verification
- `pnpm run typecheck`: Passed (0 errors)
- `pnpm test`: Passed (10 test files, 47 tests)

## Commit Message Line
- [2026-11-14 13:30] Base Planet Temp Slider: Added 0°C–50°C (default 10°C) Base Temp slider driving temperature, rainfall, foliage biomes, and climate views
