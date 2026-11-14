# TASK-20261114-1441: Planetary Winds, Extreme Storm Risk & Mountain-Blocked Volcanic Fallout

- **Date / Time Reference**: `2026-11-14 14:41:21`
- **Status**: `Pending Commit`

## Summary
Implemented a full-planet atmospheric circulation, hurricane/extreme storm risk, and mountain-blocked volcanic fallout simulation with independent map overlays across any view mode, fault-line volcano generation, dedicated Weather & Fallout sidebar controls, 3D world ash & charred foliage rendering, and Sky Preview volcanic haze & northern horizon glow.

## Key Changes & Decisions
- **Planetary Wind & Storm Engine ([`QWorldAtmosphere.ts`](file:///f:/Dev/adventure2/src/core/QWorldAtmosphere.ts))**:
  - Built a `216 × 108` planetary atmospheric solver (`1/3` L0 resolution with max-crest `ridgeHeights` preservation) computing high-altitude winds & jet streams (`highWindU`, `highWindV`), terrain-deflected hot & cold lower air flow (`lowWindU`, `lowWindV`, `airTempAnomaly`), moisture transport, and tropical cyclone / frontal storm risk (`stormRisk`, `hurricanePotential`) honoring equatorial Coriolis vanishing and warm ocean genesis (`8°–26°` latitude).
  - Added `applyAtmosphereToWorldChunks` to apply wind/storm rainfall, leeward rain shadows, and heavy volcanic ash devastation directly to chunk `rainfall` and `biomes` maps.
- **Mountain-Blocked Volcanic Fallout & Sky Sync ([`QWorldVolcanicFallout.ts`](file:///f:/Dev/adventure2/src/core/QWorldVolcanicFallout.ts))**:
  - Modeled coupled stratospheric ash-veil dispersion (`skyVeil`) and tropospheric fallout (`ashFallout`) with northern volcanic-winter cold-dome outflow, precomputed mountain barrier transmission (`tropoPass` / `stratoPass`), and windward orographic ash pileup so an East–West mountain range shields the Southern Hemisphere while devastating northern slopes.
  - Added `packSkyVeilSyncGrid` (`36 × 18`) and `sampleSyncedVolcanicSky` for real-time Sky Preview synchronization.
- **Fault Volcano Generation & Volcano Markers ([`QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts), [`QWorldEditorTypes.ts`](file:///f:/Dev/adventure2/src/core/QWorldEditorTypes.ts), [`QWorldVectorTree.ts`](file:///f:/Dev/adventure2/src/core/QWorldVectorTree.ts))**:
  - Added `volcanoCount` (`0..12`, default `3`) to `WorldGenOptions` and `placeFaultVolcanoes` to seed volcanoes along raised convergent red faults, plus manual `🌋 Volcano` marker placement with `eruptionActive` and `eruptionMagnitude` (`1..8`).
- **3D Map Overlays, World Ash Terrain & Charred Foliage ([`QWorldWeatherOverlays.ts`](file:///f:/Dev/adventure2/src/core/QWorldWeatherOverlays.ts), [`QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts), [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx), [`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts), [`QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts), [`QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts))**:
  - Built globe-warped 3D meshes for High-Altitude Winds, Hot & Cold Air Flow, Hurricanes & Storms, Fallout Contours, and glowing 3D eruption plumes & ash umbrellas.
  - Synced `ashFallout` and `skyVeil` to the terrain Web Worker (`SYNC_ATMOS`) to render ash-blanketed land, pumice-darkened waters, volcanic-winter cooling in `Temp` view, and charred leafless grey trunks at people-scale `L7–L9` in heavy ash zones while preserving lush green forests south of mountain barriers.
- **Weather & Fallout Sidebar & Celestial Sky Preview ([`QWorldWeatherPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldWeatherPanel.tsx), [`QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx), [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx), [`App.tsx`](file:///f:/Dev/adventure2/src/App.tsx))**:
  - Added the `🌪️ Weather & Fallout` sidebar tab allowing independent layer toggles on any map mode, northern vs. southern hemisphere land ash readouts, volcano eruption controls, and `🌿 Apply Wind & Ash to Foliage`.
  - Updated `QWorldSkyPreview.tsx` (Ground, Surround, and Zenith Dome) to render overhead volcanic ash haze, star/nebula dimming, copper/crimson sun tinting, and distant northern horizon eruption glow visible across the mountain wall.

## Affected Files
- [`src/core/QWorldAtmosphere.ts`](file:///f:/Dev/adventure2/src/core/QWorldAtmosphere.ts)
- [`src/core/QWorldVolcanicFallout.ts`](file:///f:/Dev/adventure2/src/core/QWorldVolcanicFallout.ts)
- [`src/core/QWorldWeatherOverlays.ts`](file:///f:/Dev/adventure2/src/core/QWorldWeatherOverlays.ts)
- [`src/core/QWorldEditorTypes.ts`](file:///f:/Dev/adventure2/src/core/QWorldEditorTypes.ts)
- [`src/core/QWorldVectorTree.ts`](file:///f:/Dev/adventure2/src/core/QWorldVectorTree.ts)
- [`src/core/QWorldStarterGenerator.ts`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts)
- [`src/core/QWorldTerrainMesh.ts`](file:///f:/Dev/adventure2/src/core/QWorldTerrainMesh.ts)
- [`src/workers/QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts)
- [`src/workers/QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts)
- [`src/workers/QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts)
- [`src/components/QWorldWeatherPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldWeatherPanel.tsx)
- [`src/components/QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
- [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
- [`src/tests/QWorldAtmosphere.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldAtmosphere.test.ts)
- [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)
- [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)

## Validation & Verification
- `pnpm run typecheck`: Passed (`0` errors).
- `pnpm test`: Passed (`17` test files, `69` tests, including `10/10` unit & `< 50 ms` performance assertions in [`QWorldAtmosphere.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldAtmosphere.test.ts)).

## Commit Message Line
- [2026-11-14 14:41] Planetary Winds, Storms & Volcanic Fallout: Added upper/surface wind solver, storm/hurricane risk, mountain-blocked volcanic ash simulation, fault volcanoes, weather sidebar overlays, charred 3D foliage, and Sky Preview volcanic haze/glow
