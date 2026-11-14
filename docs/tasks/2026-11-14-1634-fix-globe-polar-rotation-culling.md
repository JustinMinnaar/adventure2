# TASK-20261114-1634: Fix Globe Polar Rotation Cut-Off & Far-Side Culling

- **Date / Time Reference**: `2026-11-14 16:34:00`
- **Status**: `Pending Commit`

## Summary
Fixed the 3D globe rendering, hemisphere culling, L0 anti-meridian chunk wrapping, and ray-picking so rotating/panning toward the North or South Pole preserves a continuous closed sphere without slicing off the polar cap.

## Key Changes & Decisions
- **Core Tilted-Globe Math ([`QWorldGlobeMath.ts`](file:///f:/Dev/adventure2/src/core/QWorldGlobeMath.ts), [`QWorldGlobeMath.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldGlobeMath.test.ts))**:
  - Created `projectWorldToGlobe`, `computeGlobeBlend` (reaching `1.0` across all of L0 at `distance >= 700,000`), `computeGlobeFrontCos` / `isGlobePointVisible` (true 3D dot product against the tilted camera sub-point), and `intersectGlobeEllipsoid` (analytical ray-ellipsoid inversion).
  - Verified with TDD unit and performance tests (`< 15 ms` for 100,000 visibility checks + visible projections) confirming all longitudes at `wz = 0` and `wz = WORLD_SPAN_Z` converge directly onto the spin-axis pole exit points and far-side polar regions remain visible.
- **Shaders, Culling, Wrapping & Picking ([`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx))**:
  - Updated `terrainMat` (`terrain-grid-lambert-v15`) and `applyGlobeWarp` vertex/fragment shaders to map latitude over `[-PI/2, +PI/2]` around the equator, apply the 3D pitch rotation by `targetLat`, unclamp `lon` so anti-meridian chunks join seamlessly around the poles, discard back-hemisphere fragments (`vGlobeFacing < -0.03` / `frontCos < -0.02` or redundant wrap copies `abs(rawLon) > 3.18`), and disable flat-space CPU `frustumCulled` on GPU-warped vector lines, ribbons, pins, and pole sprites.
  - Kept L0 chunk `mesh.position.x` wrapped around `cam.targetX` every frame (`wrapL0ChunkPositions`), in `flushPendingTerrainUploads()`, and in `rebuildTerrain()`.
  - Updated `getHitPoint` to seed from `intersectGlobeEllipsoid` with `maxHalfSpan = PLANET_RADIUS_YARDS * Math.PI`, updated `onWheel` camera sync to use `computeGlobeBlend(cam.distance)`, and replaced `|dLon| > PI/2 || |dLat| > PI/2` marker/stop/brush checks with `isGlobePointVisible`.
- **Issue Playbook ([`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md))**:
  - Logged `ISSUE-006` documenting symptoms, root causes, solution, and verification.

## Affected Files
- [`src/core/QWorldGlobeMath.ts`](file:///f:/Dev/adventure2/src/core/QWorldGlobeMath.ts)
- [`src/tests/QWorldGlobeMath.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldGlobeMath.test.ts)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)
- [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)
- [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)

## Validation & Verification
- `pnpm run typecheck`: Passed (0 errors)
- `pnpm test`: Passed (`Test Files 13 passed (13)`, `Tests 79 passed (79)`)
- `pnpm run build`: Passed (`tsc && vite build` succeeded in 2.71s)

## Commit Message Line
- [2026-11-14 16:34] Fix Globe Polar Rotation & Culling: Apply 3D tilted-globe spherical projection, polar visibility culling, per-frame L0 wrapping, and ray-ellipsoid picking so northern/southern polar caps never slice off
