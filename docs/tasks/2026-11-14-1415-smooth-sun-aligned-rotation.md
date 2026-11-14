# TASK-20261114-1415: Smooth Sun-Aligned Rotation & Eliminated L0 Wrap Pause

- **Date / Time Reference**: `2026-11-14 14:15:11`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`

## Summary
Fixed both rotation issues in `Sun-Aligned` globe view: eliminated the sudden left/right tilt pivot when rotating past the subsolar meridian, and eliminated the periodic pause when crossing L0 chunk boundaries.

## Key Changes & Decisions
- **Constant Seasonal Sun-Aligned Tilt ([`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L2307-L2311))**:
  - Set `targetRollRad = -(propsRef.current.solarDeclinationDeg * Math.PI) / 180` directly, so the planet's `N–S` display tilt remains constant across the day/night cycle and camera rotation, changing only over the orbital year relative to the Sun.
- **Zero-Stall L0 Chunk Wrapping ([`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L2347-L2362))**:
  - When `lod === 0` and all 32 L0 globe chunks are already loaded in `chunkMeshMap`, crossing a chunk boundary now repositions wrapped `mesh.position.x` in-place instead of triggering `rebuildTerrain()`, worker cancellation, and prop/stale-mesh cleanup every 45° of rotation.

## Affected Files
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)

## Validation & Verification
- `pnpm test --exclude src/tests/QWorldAtmosphere.test.ts`: Passed (11 test files, 54 tests).

## Commit Message Line
- [2026-11-14 14:15] Smooth Sun-Aligned Rotation & L0 Wrap: Removed discontinuous tilt flip and in-place wrapped L0 globe chunks to prevent rotation pauses
