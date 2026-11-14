# Adventure2 Known Issues, Root Causes & Debugging Playbook

This document is the **Master System Index** and central registry for all bugs, runtime anomalies, performance regressions, Three.js/WebGL quirks, and architectural lessons across **Adventure2**.

> [!IMPORTANT]
> **Mandatory AI Pre-Flight Inspection**:
> All developers and AI coding assistants MUST inspect this registry before investigating bugs, troubleshooting failures, or diagnosing spatial/rendering/storage inconsistencies. When discovering or resolving new edge cases, append a documented entry below with symptoms, root cause, solution/workaround, and verification.

---

## Master Issue Catalog Index

| ID | Area / Module | Summary / Symptom | Root Cause | Status |
|---|---|---|---|---|
| `ISSUE-001` | `QWorldAtmosphere` / `QWorldVolcanicFallout` | Volcanic ash leaked south of East–West mountain ranges and full-planet fallout exceeded 50 ms budget | Overly wide initial vent Gaussian (`rad = 12` cells) injected ash across mountain walls on tick 0, and `Math.exp` inside inner 38-step cellular loops caused CPU overhead | `Resolved` |
| `ISSUE-002` | `QWorldSkyPreview` / `App.tsx` | Sky map simulation stuttered/froze during playback with two tabs open; jumping to Year 3 comet pointed camera down into dark ground polygon | 1) BroadcastChannel ping-pong loop between Map tab and Sky Preview tab repeatedly overrode `worldHours` with throttled background timestamps. 2) Preset comet jump hour was set to 23:00 when the comet had already set and was 40° underground (visibility window is 18:30 dusk at +15° altitude). | `Resolved` |
| `ISSUE-003` | `QWorldChunkTree` / `QWorldTerrainWorker` / `App.tsx` | Painting a circle area of rocks (or other biome/elevation/polygon edits) at `L2` failed to appear when zooming out to `L1` and `L0` | 1) Main thread only synced touched `lod` chunks to the Web Worker, omitting rolled-up ancestors and descendant invalidation. 2) `rollupToParent` used unweighted `3x3` biome voting instead of center-weighted `3/2/1` weights. 3) `sampleChunkGrid` selected `ancLod` via `levels[l].size > 0` instead of checking whether the covering chunk existed. 4) Viewport discarded or overwrote edited/refined chunks on stale `requestSeq` or worker completion. | `Resolved` |
| `ISSUE-004` | `QWorldSkyPreview` / `QWorldSkyMistTextures` / `QWorldCelestial` / `App.tsx` / `QWorldCalendarView` | Night-time sky playback flickered, stalled at midnight, jumped backwards, concentric fallback strokes showed hard lines, and `+2h` globe clicks snapped back | 1) Night-only Canvas2D `ctx.filter = blur(...)` caused ~70 offscreen blur passes/frame; removing blur with flat `ctx.stroke()` ribbon tiers caused hard parallel lines, while horizon-clipped `run` indexing (`i += 3`), whole-run chord tangents, and tight `-4°`/edge clips popped caps and shifted patches backwards. 2) `scanUpcomingOmens` searched 140 days when the Year 3 comet was out of window and ran the 90-shard Trojan loop on every scan/eclipse step. 3) Multi-tab sync mixed periodic map state with passive `[worldHours, playing]` broadcasts and channel teardown loops, causing tabs to overwrite explicit `+2h`/calendar edits. | `Resolved` |
| `ISSUE-005` | `QWorldCelestial` / `QWorldSkyPreview` / `QWorldSkyMistTextures` | `Tears of Vaelis` shard cluster collapsed to a 1D line at orbital nodes and sheared diagonally; galaxy mist & stars appeared too bright | 1) `getDeterministicShards` reused `u2` for both radial elongation and `latScatterDeg`, tilting the cluster diagonally, while `computeCelestialSnapshot` added `latScatterDeg` to `pm.inclinationDeg` (causing `sin(sArgLat) * latScatterDeg` to collapse to `0.59°` at orbital nodes and flip halves), and `_scratchEcl`/`_scratchEq` aliased `tcCoreEcl`. 2) `drawGalaxyMistRun` spine/core/patch stamp opacities (`0.22`/`0.46`/`1.15`) and linear star luminance floor made the Milky Way and faint stars overly bright. | `Resolved` |
| `ISSUE-006` | `QWorld3DViewport` / `QWorldGlobeMath` | Rotating/panning the globe toward the northern (or southern) pole sliced off the top/bottom of the globe along a flat line at the spin axis and culled far-side markers/rays | 1) Vertex shaders (`terrainMat`, `applyGlobeWarp`) and CPU projection shifted `lat` by `(wz - uCamTarget.y) / R` without applying a 3D spherical pitch rotation around the camera target latitude $\phi_0$, turning `wz = 0` into a non-zero circle cut flat where the North Pole exited. 2) `lon` clamping to `[-PI, PI]`, ramping `globeBlend` to `1.8M` instead of `700k`, and stale per-frame L0 chunk wrapping tore the anti-meridian seam. 3) `|dLon| > PI/2` checks and flat-space vector `frustumCulled` culled far-side polar pins/markers/ribbons and blocked polar raypicking. | `Resolved` |

---

### ISSUE-001: Mountain Barrier Leakage & Inner-Loop `Math.exp` Cost in Volcanic Fallout
- **Date Logged**: 2026-11-14
- **Area / Module**: `QWorldAtmosphere` / `QWorldVolcanicFallout`
- **Status**: `Resolved`
- **Symptom**: During initial TDD runs of `QWorldAtmosphere.test.ts`, southern fallout near an East–West mountain range (`+4°N..+10°N`) reached `63.15` (exceeding `< 26.77` barrier threshold), and full-planet wind + storm + fallout took `53.3 ms` (budget `< 50 ms`).
- **Root Cause**:
  1. Downsampling `648 × 324` L0 chunks to a `216 × 108` atmospheric grid via mean elevation alone would smooth narrow mountain crests, and an overly wide initial eruption umbrella (`sigma` spanning `20°`) injected ash directly past the mountain barrier before transport began.
  2. Computing `Math.exp` per cell inside 38 advection/diffusion iterations multiplied transcendental calls across `23,328 × 38` cells.
- **Solution / Workaround**:
  1. Preserved `ridgeHeights` as the maximum crest height across each `3 × 3` L0 sample block in `QWorldAtmosphere.ts`.
  2. Scoped initial vent injection to `sigma = 0.7 + mag * 0.2` and gated both advection and eddy dispersion through precomputed `tropoPass` and `stratoPass` barrier transmission tables, depositing blocked ash on windward northern slopes.
  3. Hoisted `tropoPass` / `stratoPass` outside the 38-step loop and skipped `Math.exp` on zero-ash cells during buffer finalization.
- **Verification**: `pnpm test src/tests/QWorldAtmosphere.test.ts` (10/10 tests passing, full planet wind + storm + fallout well under `< 50 ms`) and `pnpm run typecheck`.

---

### ISSUE-002: BroadcastChannel Desynchronization Loop and Underground Comet Jump Hour
- **Date Logged**: 2026-11-14
- **Area / Module**: `src/components/QWorldSkyPreview.tsx`, `src/App.tsx`, `src/core/QWorldCelestial.ts`
- **Status**: `Resolved`
- **Symptom**: Sky map simulation stuttered or froze when both the 3D Map tab and Sky Preview tab were open simultaneously in the browser. In addition, jumping to Year 3 Day 55 or selecting the 12-year comet in Quick Select ('Y') turned the camera directly downward into the ground (-40° pitch) where nothing in the sky was visible.
- **Root Cause**:
  1. **BroadcastChannel Ping-Pong Echo Loop**: When `QWorldSkyPreview` played at 60 FPS, it sent 60 unthrottled messages/sec, spawning a new BroadcastChannel on every frame. `App.tsx` received this and triggered `pushSync()` on a 600 ms interval without `source: 'map'`. Because Chromium/Edge aggressively throttles background tabs, `App.tsx` processed events late and transmitted stale timestamps back to `QWorldSkyPreview`. `applySync` blindly accepted incoming `worldHours` even during active playback, snapping the simulation backwards and creating an infinite desync loop.
  2. **Comet Day 55 Visibility Window**: The apparition presets jumped to `hour = 23` (11:00 PM). Around Day 55 perihelion, the comet sets at ~19:30 and is 40° below the horizon at 23:00. The camera in Ground View was pitched down to `-40°` into the subterranean polygon. The true night visibility window for Day 55 is at 18:30 (dusk, Sun at -9.6°, comet at +14.3° to +25° altitude in the western sky).
- **Solution / Workaround**:
  1. In `QWorldSkyPreview.tsx`, guarded `applySync` to reject external `worldHours` whenever `playing` is active or if the user modified time locally within 2000 ms (`lastLocalEditRef`). Reused a single persistent `BroadcastChannel` and throttled outgoing time broadcasts to at most 4 updates/sec (250 ms) during playback.
  2. In `App.tsx`, tagged payloads with `source: 'map'` and only broadcast `worldHours` when the user actively interacts with the map toolbar time slider (`userEditedMapHoursRef`).
  3. Changed all comet apparition jump targets (Year 3, Year 15, and Quick Select) from `23` to `18.5` (18:30 dusk), pointing the camera directly toward the western sky at +14° to +20° altitude.
- **Verification**: `pnpm test src/tests/QWorldCelestial.test.ts` (13/13 passing, including diurnal consistency across years, dusk apparition assertions, and <0.5 ms performance assertions), `pnpm run typecheck`, and `pnpm run build`.

---

### ISSUE-003: Zoom-Out LOD Rollup Loss, Sparse Ancestor Sampling & Worker Sync Desynchronization
- **Date Logged**: 2026-11-14
- **Area / Module**: `QWorldChunkTree` / `QWorldTerrainWorker` / `QWorld3DViewport` / `App.tsx`
- **Status**: `Resolved`
- **Symptom**: Painting a Radius-8 circle of Rock at `L2 • Kingdom` (or applying elevation, biome, ocean flood-fill, or polygon edits at finer LODs) displayed correctly at `L2`, but zooming out to `L1 • Continent` or `L0 • World` caused the painted feature to disappear or revert to unedited terrain.
- **Root Cause**:
  1. **Incomplete Worker Sync (`App.tsx`, `QWorldTerrainWorker*`)**: `handleBrushStroke`, `recomputeAndRollupOcean`, and `handleApplyPolygonAction` only sent `lod` chunks to `terrainWorkerClientRef.current?.patchChunks(...)`, leaving stale pre-edit `L1`/`L0` ancestor chunks and finer descendant chunks in Web Worker memory; switching zoom levels then remeshed from the worker's stale chunks.
  2. **Unweighted Biome Rollup (`QWorldChunkTree.rollupToParent`)**: Elevation used center-weighted (`3/2/1`) median filtering, whereas biome mode used flat unweighted `3x3` counts (`+1`), causing a painted quadrant covering the parent center `(1,1)` (`4` painted samples vs `5` background samples) to be erased on zoom-out (`4 < 5` unweighted vs `8 > 7` center-weighted). Missing wrapped child lookup and unweighted `rainfall` exacerbated seam and climate rollups.
  3. **Sparse Intermediate Ancestor Sampling (`QWorldChunkTree.sampleChunkGrid`)**: `ancLod` checked `this.levels[l].size > 0` instead of verifying whether `this.levels[l]` actually held a chunk covering the target world region, stopping at an unrelated coarse chunk and defaulting missing borders to sea-level ocean (`DEFAULT_SEA_LEVEL`).
  4. **Viewport Stale Sequence & Overwrite Ordering (`QWorld3DViewport.tsx`)**: `onChunkMesh` returned early on `msg.requestSeq !== activeRequestSeq` before applying `msg.refinedChunks`, and `onChunkMesh`/`onRefinedChunks` could overwrite already-edited main-thread chunks.
- **Solution / Workaround**:
  1. Updated `QWorldChunkTree.rollupToParent` (via `lookupChildChunk` and `writeRolledUpParentSample`) to apply `3/2/1` center-weighted biome voting (tie-breaker `centerBiome`), weighted `rainfall` averaging, wrapped horizontal `ccx` lookup, a fast interior lookup path, and scratch typed buffers.
  2. Updated `QWorldChunkTree.sampleChunkGrid` (via `findCoveringAncestorLod`, `loadAncestorCorner`, and `readFallbackAncestorSample`) to resolve the finest covering ancestor chunk and fall back cleanly on unallocated chunk borders while short-circuiting polar out-of-bounds rows (`wz < 0 || wz >= WORLD_SPAN_Z`).
  3. Added `collectChunksInGridHierarchy` and wrapped `cx` handling in `invalidateDescendants`, added `DescendantInvalidationRange` (`invalidateRange`) to `PATCH_CHUNKS` across `QWorldTerrainWorkerProtocol.ts`, `QWorldTerrainWorkerClient.ts`, and `QWorldTerrainWorker.ts`, and updated `App.tsx` handlers (`handleBrushStroke`, `recomputeAndRollupOcean`, `handleApplyPolygonAction`) to roll up and sync full hierarchy chunks plus descendant invalidation.
  4. Updated `QWorld3DViewport.tsx` (`onChunkMesh`, `onRefinedChunks`) to apply `msg.refinedChunks` before stale `requestSeq` checks and guard against overwriting existing main-thread chunks (`!chunkTree.getChunk(...)`).
- **Verification**: `pnpm test` (`Test Files 12 passed (12)`, `Tests 69 passed (69)`, including all 5 tests in `src/tests/QWorldLODRollup.test.ts`), `pnpm run typecheck`, and `pnpm run build`.

---

### ISSUE-004: Night-Time Sky Flicker, Backwards Patch Jumping, Midnight Omen Stalls & Multi-Tab `+2h` Snap-Back
- **Date Logged**: 2026-11-14
- **Area / Module**: `QWorldSkyPreview` / `QWorldSkyMistTextures` / `QWorldCelestial` / `QWorldCalendarView` / `QWorldToolbar` / `App.tsx`
- **Status**: `Resolved`
- **Symptom**: During night-time simulation playback (`starVisibility > 0.02`), the Sky Preview flickered, stalled at midnight (`00:00`), and showed Galaxy Cloud patches and elliptical bulge rotation visually jumping backwards; removing `ctx.filter = blur(...)` in favor of concentric `ctx.stroke()` ribbons also introduced hard parallel lines instead of soft cosmic mist. Simultaneously, clicking `+2h` on the main globe toolbar (`QWorldToolbar.tsx`) often failed to advance world time when Sky or Calendar tabs were open.
- **Root Cause**:
  1. **Night-Only Canvas2D `ctx.filter = blur(...)`, Hard Stroke Edges & Horizon Clip Artifacts (`QWorldSkyPreview.tsx`)**: Both `drawGalaxyCloud` and `drawColouredNebula` enabled Canvas2D `ctx.filter = blur(...)` exclusively when `starVisibility > 0.02`, causing heavy per-frame offscreen Gaussian passes across Ground and Zenith Dome canvases; replacing blur with unblurred concentric `ctx.stroke()` bands produced flat sharp borders at `±lineWidth / 2`. In addition, star-cloud patches indexed the horizon-clipped subarray (`i += 3`), core bulge/patch rotation used the global endpoint chord (`run[0]` -> `run[run.length - 1]`), and `-4°`/`60px` clipping popped wide round stroke caps.
  2. **Omen Scan & Per-Step Trojan Shard Overhead (`QWorldCelestial.ts` & `QWorldSkyPreview.tsx`)**: `scanUpcomingOmens` required `'comet-apparition'` (Year 3) and analytically-seeded solar eclipses in `loopTargetTypes`, scanning all 140 days (`102.04ms` before optimization), while `computeCelestialSnapshot(..., false)` still projected and allocated all 90 Trojan shards on every coarse scan and `refineEclipseCandidate` step (causing `73.70ms–76.59ms` under parallel `vitest run` contention and `34ms` eclipse warnings). Missing `omenAnchorRef` playback caching also triggered scans on every midnight (`dayFloor`) boundary.
  3. **Multi-Tab Time Sync Ping-Pong (`App.tsx`, `QWorldSkyPreview.tsx`, `QWorldCalendarView.tsx`)**: `QWorldSkyPreview` ran a passive `useEffect([worldHours, playing])` broadcaster while `App.tsx` rebuilt its `BroadcastChannel` listener when `buildSkySyncPayload` changed and sent periodic state syncs carrying stale `worldHours`, overwriting manual `+2h` globe clicks or paused tab state.
- **Solution / Workaround**:
  1. Created [`QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts) to precompute reusable transparent `HTMLCanvasElement` overlays (`galaxySpine`, `galaxyCore`, `galaxyPatchBlue`, `galaxyPatchLavender`, `galaxyDarkRift`, `chrysalisNebula`) from $C^\infty$ 2D analytical Gaussian + $\cos^2$ Hann window profiles with sub-LSB dithering, and rendered them via hardware-accelerated `ctx.drawImage(...)` with zero `ctx.filter` calls. Widened projection margins (`projectUnitVec` `marginPx`, `projectSurroundCloud`, `projectDomeSky`, `altitudeDeg > -20` / `> -16`, scaled `seamJumpThresholdPx`), anchored patches by catalog node index (`curr.idx % 3 !== 0`), and computed local tangents/steps via `runTangentAt` and `runStepPxAt`.
  2. Updated `scanUpcomingOmens` to mathematically check comet window overlap, exclude out-of-window comet and seeded eclipses from `loopTargetTypes`, use `stepHours = 2.0`, raised `solveRiseSetForDay` LRU cache to 64 with 3-decimal lat/lon + `config.comet` keys, added `includeShards = includeRiseSet` in `computeCelestialSnapshot` with analytic `visibleFraction` when `false`, and cached `upcomingOmens` over a 30-day anchor during playback.
  3. Separated explicit `'time-sync'` messages from periodic `'map-state'` broadcasts, removed passive `[worldHours, playing]` and listener-teardown effects, updated `applyManualWorldHours` / `handleToolbarWorldHoursChange` / `handleUpdateWorldHours` to emit `'time-sync'`, paused hidden background playback on incoming `'time-sync'`, replaced empty `catch {}` blocks with `console.warn`, and standardized named window targets (`adventure2_main_map`, `adventure2_sky_preview`, `adventure2_calendar`).
- **Verification**: `pnpm run typecheck`, `pnpm test` (`Test Files 12 passed (12)`, `Tests 72 passed (72)`), and `pnpm run build` (`vite build` succeeded in 2.71s).

---

### ISSUE-005: `Tears of Vaelis` Orbital Node Collapse, Correlated Scatter & Over-Bright Galaxy Mist/Stars
- **Date Logged**: 2026-11-14
- **Area / Module**: `src/core/QWorldCelestial.ts`, `src/core/QWorldSkyMistTextures.ts`, `src/components/QWorldSkyPreview.tsx`
- **Status**: `Resolved`
- **Symptom**: During sky simulation, the `Tears of Vaelis` (`trojanCluster`) shard swarm collapsed horizontally into a thin line twice a month when passing the orbital nodes (`18°` / `198°`), appeared sheared diagonally, and lacked matching particle swarm + orbital motion cues on the top-down `Orbital Plane` panel. Additionally, the galaxy mist band and faint background stars rendered too bright against the dark sky, and real-time `1 s/s` playback lacked star scintillation (twinkling).
- **Root Cause**:
  1. **Node Collapse, Diagonal Shear & Scratch Vector Aliasing (`QWorldCelestial.ts`)**: `computeCelestialSnapshot` added `tpl.latScatterDeg` to `pm.inclinationDeg`, which only displaces ecliptic latitude by `sin(sArgLat) * latScatterDeg` — collapsing perpendicular thickness to `0.586°` at the orbital nodes (`sArgLat = 0, pi`) and inverting vertical sign across the two orbital halves. `getDeterministicShards` also reused `u2` for both `radialWeight` and `latScatterDeg`, correlating longitudinal spread with vertical offset, and `orbitalToEclipticVec` / `eclipticToEquatorialVec` returned shared `_scratchEcl` / `_scratchEq` singletons aliased by `tcCoreEcl`.
  2. **Over-Bright Galaxy Mist & Linear Star Luminance (`QWorldSkyMistTextures.ts`, `QWorldSkyPreview.tsx`)**: Overlapping spine stamps (`0.22`), core bulge (`0.46`), patches (`1.15`), and Dome galaxy alpha (`0.92`) plus a high linear star floor (`0.24 + 0.76 * (1 - s.mag)`) washed out darker sky contrast.
- **Solution / Workaround**:
  1. Replaced shared aliased `_scratchEcl` / `_scratchEq` helpers with dedicated non-aliasing scratch vectors (`_pmEcl`, `_tcCoreEcl`, `_shardEcl`, `_sunEq`, etc.), added `orbitalWithLatOffsetToEclipticVecInto` to rotate each shard perpendicularly along the true orbital-plane normal at all longitudes, and added an independent 4th quasi-random sequence (`u4`) for `latScatterDeg`.
  2. Softened `computeGalaxySpinePixel` inner weights while keeping `(0, 0)` normalized (`sum = 1.00`), cut galaxy mist draw alphas by ~3.5×–4× (`0.055` spine, `0.13` bulge, `0.14` dark rift, `0.28` patches, `0.55` zenith dome), and updated star rendering across Ground, Surround, and Zenith Dome views to use `0.08 + 0.54 * (1 - s.mag)^1.45` luminance with finer radii (`0.62..1.80` px).
  3. Implemented deterministic `computeStarTwinkleFactor` (stronger at low-altitude airmass) driven at `1 s/s` (and softly at `1 m/s`, active even before pressing Play via a 45ms `twinkleTick` interval), and updated `renderOrbitalPlane` with individual shard swarm points, prograde/retrograde orbital direction chevrons, and an East–West camera sightline indicator.
- **Verification**: `pnpm run typecheck` (exit 0), `pnpm test` (`Test Files 12 passed (12)`, `Tests 74 passed (74)` including node-invariant shard thickness and twinkle tests), and `pnpm run build` (exit 0).

---

### ISSUE-006: Polar Cap Cut-Off & Far-Side Culling When Rotating the Globe to Northern/Southern Areas
- **Date Logged**: 2026-11-14
- **Area / Module**: `src/core/QWorldGlobeMath.ts`, `src/components/QWorld3DViewport.tsx`
- **Status**: `Resolved`
- **Symptom**: Rotating/panning the 3D globe toward the North Pole (`cam.targetZ < WORLD_SPAN_Z * 0.5`, e.g. `Z = 751060`) or South Pole sliced off the upper/lower cap of the globe along a flat diagonal/horizontal boundary right through the `N` pole spin-axis exit, hiding the far-side polar hemisphere and markers/lines beyond `|dLon| > 90°`.
- **Root Cause**:
  1. **Unrotated Latitude Offset (`terrainMat`, `applyGlobeWarp`, `projectWorldToRendered`)**: Latitude was computed as `(wz - uCamTarget.y) / R` and fed directly into an un-tilted sphere formula rather than mapping latitude to `[-PI/2, +PI/2]` around the equator and applying a 3D spherical pitch rotation by `targetLat = (uCamTarget.y - 0.5 * WORLD_SPAN_Z) / R`. At `wz = 0`, `r * cos(lat)` stayed non-zero, cutting off the polar cap instead of closing at the spin-axis pole `(targetX, -0.65 * R * sin(targetLat) - R, targetZ - R * cos(targetLat))`.
  2. **Anti-Meridian Clamping & Delayed `globeBlend`**: Clamping `lon` to `[-PI, +PI]`, ramping `globeBlend` up to `1,800,000` instead of `700,000` (leaving default L0 `950,000` partially blended), and only wrapping L0 chunk `mesh.position.x` across chunk boundaries tore the far-side anti-meridian seam around the tilted pole.
  3. **Hemisphere Culling & Polar Raycasting**: `cosLat * cos(lon) < -0.02`, `|dLon| > PI/2 || |dLat| > PI/2` checks, CPU frustum culling on GPU-warped vector lines/ribbons/pins/sprites, and Newton-Raphson `getHitPoint` clamped to `±0.495 * PI * R` culled visible far-side polar geometry/markers and broke wheel/ray picking past the pole.
- **Solution / Workaround**:
  1. Extracted pure 3D tilted-globe projection, `computeGlobeBlend` (`20,000..700,000` smoothstep), `isGlobePointVisible` (`cos(phi)*cos(lon)*cos(phi0) + sin(phi)*sin(phi0) >= -0.02`), and `intersectGlobeEllipsoid` ray inversion into [`QWorldGlobeMath.ts`](file:///f:/Dev/adventure2/src/core/QWorldGlobeMath.ts).
  2. Updated `terrainMat` (`terrain-grid-lambert-v15`) and `applyGlobeWarp` shaders in [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx) to apply the exact 3D pitch rotation with unclamped `lon` (`terrainMat` discarding fragments at `uGlobeBlend > 0.25 && vGlobeFacing < -0.03`, `applyGlobeWarp` discarding redundant `±WORLD_SPAN_X` copies at `abs(rawLon) > 3.18 || frontCos < -0.02`), and set `frustumCulled = false` on GPU-warped lines, ribbons, pins, and pole sprites.
  3. Wrapped L0 chunk X-positions around `cam.targetX` every frame (`wrapL0ChunkPositions`), seeded `getHitPoint` with `intersectGlobeEllipsoid` (`maxHalfSpan = PLANET_RADIUS_YARDS * Math.PI`), updated `onWheel` to use `computeGlobeBlend`, and replaced equatorial `|dLon| > PI/2` marker/brush checks with `isGlobePointVisible`.
- **Verification**: `pnpm run typecheck` (exit 0), `pnpm test` (`Test Files 13 passed (13)`, `Tests 79 passed (79)`, including all 5 unit/performance tests in `src/tests/QWorldGlobeMath.test.ts`), and `pnpm run build` (exit 0).

---

## Issue Entry Template

When logging a new issue, add a row to the **Master Issue Catalog Index** above and append a detailed section below using this format:

```markdown
### ISSUE-XXX: <Concise Issue Title>
- **Date Logged**: YYYY-MM-DD
- **Area / Module**: e.g. `QWorldChunkTree` / `QWorld3DViewport` / `QWorldCelestial`
- **Status**: `Open` | `Investigating` | `Resolved`
- **Symptom**: What failed or looked wrong (including exact error messages or metrics).
- **Root Cause**: Why it happened.
- **Solution / Workaround**: How it was fixed (or current workaround if `Open`).
- **Verification**: Tests (`pnpm test`), `pnpm run typecheck`, or manual checks confirming the fix.
```
