# TASK-20261114-1411: Fix Premature Bottom-of-Globe Frustum Culling

- **Date / Time Reference**: `2026-11-14 14:11:32`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`

## Summary
Fixed premature CPU-side frustum culling of the southern hemisphere (`cz = 3`) in whole-planet globe view where the vertex shader warps flat-space chunks onto the sphere.

## Key Changes & Decisions
- **Root Cause & Fix ([`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L817-L820))**:
  - Terrain chunk meshes (`new THREE.Mesh(geo, terrainMat)`) used Three.js's default `frustumCulled = true`, which tested the *unwarped* flat-space bounding box (`y = 0`, `z = 4.78M..6.38M`) against the camera frustum, culling the southern row (`cz = 3`) even though the vertex shader warps it onto the visible sphere.
  - Set `mesh.frustumCulled = false` on terrain chunk meshes (the visible ring is already bounded by `rebuildTerrain`).

## Affected Files
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)

## Validation & Verification
- `pnpm test --exclude src/tests/QWorldAtmosphere.test.ts`: Passed (11 test files, 54 tests).

## Commit Message Line
- [2026-11-14 14:11] Fix Globe Frustum Culling: Disabled flat-space CPU frustum culling on GPU-warped terrain chunk meshes so the southern hemisphere is never cut off
