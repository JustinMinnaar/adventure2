# TASK-20261114-1931: Single-Pixel Pinpoint Stars & Steep Luminance Grading

- **Date / Time Reference**: 2026-11-14 19:31:32
- **Status**: `Committed (10c851e — 2026-11-14 21:33)`
- **Summary**: Changed all fixed and constellation stars across Ground View, Surround Panorama, and Zenith Star Dome from scaled circles (`arc`) and bright cross-flared anchor discs to strict `1×1` pixel pinpoints, using a steep magnitude-to-luminance curve (`computeStarPinpointLuminance`) so only the brightest stars shine brightly while dimmer and catalog stars fade gracefully into the night sky.
- **Key Changes & Decisions**:
  1. **Pinpoint Luminance Curve & Fixed 1px Twinkle ([`QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts))**:
     - Added exported helper `computeStarPinpointLuminance(mag)` (`0.06 + 0.89 * Math.pow(clamp((0.76 - mag) / 0.72, 0, 1), 2.8)`) so 1st-magnitude stars render bright while mid-range and fainter catalog stars scale smoothly downward without ever increasing pixel footprint.
     - Locked `computeStarTwinkleFactor` `radiusMul` to `1` so twinkling modulates star brightness only and never swells a star past 1 pixel.
  2. **1×1 Pixel Star Rendering Across All Sky Views ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Updated star rendering loops in `renderGroundCharacterView`, `renderSurroundPanoramaView`, and `renderZenithDome` to use `computeStarPinpointLuminance(s.mag)` and draw integer-aligned single pixels (`ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1)`).
     - Added an early return (`if (linesAlpha <= 0.005 && artAlpha <= 0.005) return`) and removed section `// 3. Bright Anchor Stars` from `drawConstellationsOverlay` so constellation anchor stars no longer overdraw large discs (`1.2px–3.4px` radius) or cross-flares on top of the 1px pinpoint catalog stars.
  3. **TDD Unit Verification ([`QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts))**:
     - Added unit test verifying `computeStarPinpointLuminance` monotonicity across magnitudes (`0.05` bright `> 0.85`, `0.30` dimmer `< 0.40`, `0.65` faint `< 0.12`) and confirming `computeStarTwinkleFactor` always returns `radiusMul === 1`.
- **Affected Files**:
  - [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts)
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`src/tests/QWorldCelestial.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldCelestial.test.ts)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1931-single-pixel-pinpoint-stars.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1931-single-pixel-pinpoint-stars.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 13 passed (13)`, `Tests 80 passed (80)`.
- **Commit Message Line**:
  - `- [2026-11-14 19:31] Single-Pixel Pinpoint Stars & Steep Luminance Grading: Rendered all catalog and constellation stars as 1x1 pixel pinpoints with magnitude luminance curve and removed oversized constellation discs and cross-flares`
