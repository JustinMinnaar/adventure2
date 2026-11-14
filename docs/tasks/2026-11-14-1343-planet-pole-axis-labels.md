# TASK-20261114-1343: Planetary Spin-Axis Pole Line & N/S Pole Labels

- **Date / Time Reference**: `2026-11-14 13:43:50`
- **Status**: `Pending Commit`

## Summary
Added a 3D spin-axis pole line passing through the planet with `N` and `S` pole exit sprites, visible only when zoomed out to the whole-planet view.

## Key Changes & Decisions
- **3D Pole Axis & Sprites ([`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L494-L532), [L2227-L2273](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L2227-L2273))**:
  - Added a depth-tested `THREE.Line` (`poleLine`) passing through the planet and exiting at the North (`wz = 0`) and South (`wz = WORLD_SPAN_Z`) poles, plus `N` and `S` `THREE.Sprite` badges (`northPoleBadge`, `southPoleBadge`) rendered from 64×64 canvas textures.
  - Visibility is gated on `globeBlend > 0.95 && cam.distance >= 2200000` so the axis and `N`/`S` labels appear only when zoomed out enough to view the whole planet.
  - Updated positions in-place inside the render loop with zero per-frame allocations and disposed all geometries, textures, and materials on unmount.

## Affected Files
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)

## Validation & Verification
- `pnpm run typecheck`: Passed (0 errors)
- `pnpm test`: Passed (10 test files, 47 tests)

## Commit Message Line
- [2026-11-14 13:43] Planetary Pole Axis & N/S Labels: Added depth-tested spin-axis line through planet with N and S pole badges when zoomed out to whole-planet view
