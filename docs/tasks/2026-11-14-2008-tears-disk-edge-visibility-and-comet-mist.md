# TASK-20261114-2008: Remove Tears Glow Disk, Fix Extended Sky Object Edge Visibility, and Soften & Double Comet Width

- **Date / Time Reference**: `2026-11-14 20:08:37`
- **Status**: `Committed (10c851e — 2026-11-14 21:33)`

## Summary
Removed the artificial circular background glow behind the Tears of Vaelis (`L4` Trojan shards), fixed sudden viewport/horizon edge pop-in/out for extended sky objects (sun dawn/dusk horizon glow, volcanic horizon glow, constellation drawings/stick lines, and the comet tail), replaced the hard-edged comet polygon/needle with a soft fading Gaussian mist plume (`cometTailMist`), and adjusted the periodic comet apparition closer so it spreads across double its previous width (`8×` moon width arc = `~4.48°`).

## Key Changes & Decisions
1. **Removed Glowing Disk Behind Tears of Vaelis**:
   - Removed the radial `veilGrad` disk (`64px` in Ground View, `48px` in Surround View) behind the `L4` Trojan shard cluster core in [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx), leaving only the crisp individual drifting crystal shards (and meteor streaks).
2. **Smooth Edge & Horizon Entry for Extended Sky Objects**:
   - Added configurable `marginPx` bounds to `projectAzAlt` in Ground View (`zCam <= 0.04`) and Surround View (`marginDeg = max(fovDeg * 0.06, (marginPx / w) * fovDeg)`), as well as `drawVolcanicSkyVeilAndGlow`.
   - Passed wide projection margins (`w * 0.45` / `w * 0.4`) for Solar Dawn/Dusk and Volcanic horizon glows so atmospheric glow enters smoothly before the sun azimuth reaches the viewport center.
   - Updated `drawConstellationsOverlay` and its Ground/Surround View callers to evaluate stars and artwork vertices down to `-28°` altitude with wide `Math.max(320, w * 0.65)` screen margins, drawing artwork paths and stick-figure edges whenever any vertex enters the viewport or rises above the horizon.
   - Updated `drawComet` to project spine samples along the antisolar tail (head, midpoint, tip) down to `-40°` head altitude with wide `Math.max(w, h) * 0.9` margins, reconstructing the comet tail anchor when the head itself is outside the screen edge or below the horizon so the tail sweeps seamlessly across borders and horizons.
3. **Soft Gaussian Mist Comet Tail & Doubled Angular Width**:
   - Added `computeCometTailMistPixel` and `cometTailMist` (`320×160` offscreen canvas) in [`QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts), combining a straight antisolar ion mist plume and a gently curved broad dust mist fan with smooth longitudinal decay and zero border hard edges.
   - Replaced the solid polygon and stroke needle in `drawComet` with soft dual-pass compositing of `cometTailMist` plus a scaled coma mist gradient.
   - Updated [`DEFAULT_CELESTIAL_CONFIG.comet`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts) to `tailWidthMultiplier: 8` (`8×` moon width = `~4.48°`), `tailLengthDeg: 36`, and `0.26 AU` minimum close-passage distance while preserving `perihelionDistanceAU: 0.52` for consistent Year 3/Year 15 evening twilight Keplerian geometry.
4. **Tests Added & Updated**:
   - Added [`QWorldSkyMistTextures.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldSkyMistTextures.test.ts) asserting zero border alpha, monotonic longitudinal tail fade, and smooth transverse falloff for `computeCometTailMistPixel`.
   - Updated [`QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts) to validate `8×` moon width (`~4.48°`), `tailLengthDeg > 30`, and `distanceAU < 0.36`.

## Affected Files
- [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
- [`src/core/QWorldSkyMistTextures.ts`](file:///f:/Dev/adventure2/src/core/QWorldSkyMistTextures.ts)
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
- [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)
- [`src/tests/QWorldSkyMistTextures.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldSkyMistTextures.test.ts)

## Validation & Verification
- `pnpm run typecheck` (`tsc --noEmit`): passed with 0 errors.
- `pnpm test` (`vitest run`): 14/14 test files passed, 83/83 tests passed.

## Commit Message Line
- [2026-11-14 20:08] Remove Tears Glow Disk, Edge Pop-In & Hard Comet Tail: Removed Trojan shard glow disk, extended projection margins so sun glow, constellations, and comet tails enter smoothly before their centers cross viewport/horizon edges, and replaced the hard comet tail with a doubled-width (`8×` moon width) soft Gaussian mist plume
