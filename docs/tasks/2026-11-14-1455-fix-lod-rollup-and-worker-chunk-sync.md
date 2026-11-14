# TASK-20261114-1455: Fix LOD Rollup & Terrain Worker Chunk Sync

- **Date / Time Reference**: `2026-11-14 14:55:00`
- **Status**: `Pending Commit`

## Summary

Fixed the zoom-out LOD rollup and terrain Web Worker synchronization bugs where painting terrain, biomes (e.g. a Radius-8 circle of Rock at `L2 • Kingdom`), ocean flood-fill, or polygon fills failed to propagate cleanly into coarser LODs (`L1 • Continent`, `L0 • World`) or were dropped/overwritten when zooming out and back in.

## Key Changes & Decisions

- **Weighted Multi-Level Rollup & Sparse Ancestor Sampling ([`QWorldChunkTree.ts`](file:///f:/Dev/adventure2/src/core/QWorldChunkTree.ts))**:
  - Updated `rollupToParent` (via `lookupChildChunk` and `writeRolledUpParentSample`) to apply `3/2/1` center-weighted voting for biomes (matching height weighting, with `centerBiome` tie-breaker) and weighted `rainfall` averaging, wrapped horizontal `ccx` lookup, a fast interior lookup path, and scratch buffers (`scratchRollupBiomeIds`, `scratchRollupBiomeCounts`, `scratchRollupHeights`, `scratchRollupWeights`).
  - Updated `sampleChunkGrid` (via `findCoveringAncestorLod`, `loadAncestorCorner`, and `readFallbackAncestorSample`) to select the finest ancestor level whose covering chunk actually exists rather than checking `this.levels[l].size > 0`, and to fall back cleanly on unallocated chunk borders without leaving phantom sea-level defaults.
  - Added `collectChunksInGridHierarchy(lod, minGx, maxGx, minGz, maxGz)` to collect all unique stored chunks from `lod` up through `L0`, and updated `invalidateDescendants` to wrap `cx` across the horizontal world seam.
- **Worker Chunk Sync & Descendant Invalidation ([`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts), [`QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts), [`QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts))**:
  - Added `DescendantInvalidationRange` and optional `invalidateRange?: DescendantInvalidationRange` to `PATCH_CHUNKS`.
  - Updated `QWorldTerrainWorkerClient.patchChunks` (both worker and synchronous fallback paths) and the `PATCH_CHUNKS` handler in `QWorldTerrainWorker.ts` to invalidate stale descendants in worker memory alongside patching modified hierarchy chunks.
- **Editor & Viewport Integration ([`App.tsx`](file:///f:/Dev/adventure2/src/App.tsx), [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx))**:
  - Updated `handleBrushStroke`, `recomputeAndRollupOcean`, and `handleApplyPolygonAction` to roll up modified `L1..L9` ocean/brush/polygon edits and sync the full `collectChunksInGridHierarchy` chunk set plus `invalidateRange` to the terrain worker client.
  - Updated `QWorld3DViewport.tsx` (`onChunkMesh`, `onRefinedChunks`) so `msg.refinedChunks` is applied before stale `requestSeq` early return and already-allocated main-thread chunks are not overwritten by worker refinements.
- **Unit & Integration Tests ([`QWorldLODRollup.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldLODRollup.test.ts))**:
  - Added tests verifying that painting a Radius-8 Rock circle at `L2` rolls up into `L1` and `L0` and synchronizes cleanly via `QWorldTerrainWorkerClient.patchChunks`, and that `sampleChunkGrid` falls back to `L0` when `L1` only contains chunks in another region or across an unallocated border.

## Affected Files

- [`src/core/QWorldChunkTree.ts`](file:///f:/Dev/adventure2/src/core/QWorldChunkTree.ts)
- [`src/workers/QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts)
- [`src/workers/QWorldTerrainWorkerClient.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerClient.ts)
- [`src/workers/QWorldTerrainWorker.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorker.ts)
- [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)
- [`src/tests/QWorldLODRollup.test.ts`](file:///f:/Dev/adventure2/src/tests/QWorldLODRollup.test.ts)
- [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)

## Validation & Verification

- `pnpm test` (`vitest run`): `Test Files 12 passed (12)`, `Tests 69 passed (69)` (including all 5 tests in `src/tests/QWorldLODRollup.test.ts`).
- `pnpm run typecheck` (`tsc --noEmit`): exited cleanly with code `0`.
- `pnpm run build` (`tsc && vite build`): exited cleanly with code `0` (`64 modules transformed`, built `dist/`).

## Commit Message Line

- [2026-11-14 14:55] Fix LOD Rollup & Worker Chunk Sync: Weighted biome/rainfall LOD rollup, sparse ancestor sampling fallback, and hierarchy worker chunk patching
