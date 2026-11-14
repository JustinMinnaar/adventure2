# TASK-20261114-1626: Fainter Galaxy Mist & Stars, `1 s/s` Star Twinkling & `Tears of Vaelis` 3D Orbital Fix

- **Date / Time Reference**: 2026-11-14 16:26:22
- **Status**: `Committed (10c851e — 2026-11-14 21:33)`
- **Summary**: Made the host galaxy mist (`The Astral River`) and drawn stars substantially fainter and more natural across Ground, Surround, and Zenith Dome views, added real-time atmospheric star twinkling at `1 s/s` (and subtle twinkle at `1 m/s`), and resolved `Tears of Vaelis` (`trojanCluster`) 3D orbital node collapse, correlated diagonal shear, and scratch vector aliasing while enhancing the top-down `Orbital Plane` panel.
- **Key Changes & Decisions**:
  1. **`Tears of Vaelis` 3D Orbital Geometry & Vector Purity ([`QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts))**:
     - Replaced shared aliased `_scratchEcl` / `_scratchEq` singletons with dedicated per-body scratch vectors (`_pmEcl`, `_tcCoreEcl`, `_shardEcl`, `_bmEcl`, `_sunEq`, `_pmEq`, `_tcCoreEq`, `_shardEq`, `_bmEq`, `_cometEq`, `_riseSetEcl`, `_riseSetEq`) to guarantee zero in-place corruption while keeping hot loops zero-allocation.
     - Added `orbitalWithLatOffsetToEclipticVecInto` to displace each shard perpendicularly along the Moon's orbital normal (`cos(b)*r0 + sin(b)*n`), preventing the cluster from collapsing into a 1D line (`0.586°`) at orbital nodes or inverting across hemispheres.
     - Introduced an independent 4th quasi-random sequence (`u4`) in `getDeterministicShards` so `latScatterDeg` is completely decorrelated from `radialWeight` (`u2`).
  2. **Fainter Galaxy Mist & Stars + `1 s/s` Atmospheric Twinkling ([`QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts), [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Softened inner ridge weights in `computeGalaxySpinePixel` while maintaining normalized center density (`sum = 1.00`), and reduced `drawGalaxyMistRun` / `renderZenithDome` mist alphas ~3.5×–4× (`0.055` spine, `0.13` core bulge, `0.14` dark rift, `0.28` patches, `0.55` Zenith Dome).
     - Lowered star luminance floor to `0.08 + 0.54 * Math.pow(1 - s.mag, 1.45)` and tightened star disc radii (`0.62 + (1 - s.mag) * 1.18`) across `renderGroundCharacterView`, `renderSurroundPanoramaView`, and `renderZenithDome`.
     - Added exported `computeStarTwinkleFactor` in `QWorldCelestial.ts` using dual incommensurate frequencies and altitude-based airmass scintillation; enabled full twinkle when `speedHoursPerSec <= 1 / 1800` (`1 s/s`), gentle shimmer at `1 m/s`, and identity `1.0` at faster timelapse speeds, including a 45ms idle `twinkleTick` interval when paused at slow speed.
  3. **Orbital Plane Diagram Correspondence ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Added `drawOrbitChevron` and `drawOrbitalTrojanSwarm` helpers rendered in `renderOrbitalPlane`, showing individual Trojan shard tadpole particles along the inner orbit ring, prograde (CCW) vs retrograde (CW) orbit direction chevrons, and the observer's East–West camera sightline vector from the green surface marker.
  4. **Unit Tests ([`QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts))**:
     - Added `tracks Tears of Vaelis shards across the sky at the same rate as Vaelis and preserves 3D thickness at orbital nodes` and `computes realistic atmospheric star twinkling at 1 s/s and identity at fast timelapse speeds`.
- **Affected Files**:
  - [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
  - [`src/core/QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts)
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)
  - [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1626-galaxy-mist-star-twinkle-and-trojan-orbit-fix.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1626-galaxy-mist-star-twinkle-and-trojan-orbit-fix.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 12 passed (12)`, `Tests 74 passed (74)` (including `QWorldCelestial.test.ts` 18/18).
  - `pnpm run build` (`tsc && vite build`): exited with code `0` (`dist/` built in `2.74s`).
- **Commit Message Line**:
  - `- [2026-11-14 16:26] Fainter Galaxy Mist & Stars, 1s/s Twinkling & Tears of Vaelis Orbital Fix: Softened galaxy/star brightness, added 1s/s atmospheric star scintillation, fixed Trojan shard node collapse/aliasing, and improved Orbital Plane visual cues`
