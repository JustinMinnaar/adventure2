# TASK-20261114-2119: Continuous Comet Visibility Across Daytime, Sunset, Dawn & Night

- **Date / Time Reference**: `2026-11-14 21:19:54`
- **Status**: `Pending Commit`

## Summary
Implemented continuous comet sky visibility across daytime, dawn/sunset twilight, and full night so The Red Harbinger remains faintly visible when above the horizon during daylight, brightens smoothly as sunset finishes, and dims smoothly as the sun rises.

## Key Changes & Decisions
1. **Continuous Diurnal Visibility Curve (`computeCometSkyVisibility`)**:
   - Exported `computeCometSkyVisibility` from [`QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts) mapping effective solar altitude (adjusted for solar eclipse dimming) to continuous opacity: `1.0` at full night (`<= -12°`), smooth Hermite brightening/dimming across twilight (`-12°` to `+6°`, `~0.42` at `0°` horizon sunset/sunrise), and a faint daytime floor (`0.22` at `+6°` tapering to `0.14` at high sun `>= 50°`), attenuated cleanly by volcanic overhead veil.
2. **Decoupled Comet Rendering from Night-Only `starVisibility` Gate**:
   - Moved `drawComet` out of the `if (starVisibility > 0.02)` block in both `renderGroundCharacterView` and `renderSurroundPanoramaView` in [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx), passing `cometVisibility` instead of `starVisibility`.
   - Clamped solar/lunar glare attenuation inside `drawComet` (`Math.max(0.35, rawGlare)`) so proximity to the daytime/twilight sun does not erase the faint daytime comet.
3. **TDD Coverage**:
   - Added unit test in [`QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts) verifying daytime faintness bounds, sunset/sunrise twilight progression, full night maximum (`1.0`), and strict monotonicity across rising and setting sun altitudes.

## Affected Files
- [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
- [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)

## Validation & Verification
- `pnpm run typecheck` (`tsc --noEmit`): passed with 0 errors.
- `pnpm test` (`vitest run`): 14/14 test files passed, 84/84 tests passed.

## Commit Message Line
- [2026-11-14 21:19] Continuous Comet Visibility Across Day, Dawn & Sunset: Added `computeCometSkyVisibility` and decoupled `drawComet` from night-only star gating so the comet stays faintly visible by day and brightens/dims smoothly through sunset and sunrise
