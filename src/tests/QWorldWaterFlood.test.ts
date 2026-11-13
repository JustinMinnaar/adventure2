import { describe, it, expect } from 'vitest';
import { QWorldChunkTree, CHUNK_SIZE } from '../core/QWorldChunkTree';
import { QWorldWaterFlood, WATER_OCEAN } from '../core/QWorldWaterFlood';

describe('QWorldWaterFlood', () => {
  it('floods lowered coastal land connected to ocean but leaves enclosed basins dry', () => {
    const tree = new QWorldChunkTree();
    const flood = new QWorldWaterFlood(tree, 0);
    const lod = 2;
    const chunk = tree.getOrCreateChunk(lod, 0, 0);

    // Raise entire chunk to +50 (dry land)
    chunk.heights.fill(50);

    // Seed ocean at (0, 0) with height -20
    chunk.heights[0] = -20;
    chunk.waterFlags[0] = WATER_OCEAN;

    // 1. Lower a connected coastal channel from (1,0) to (10,0) below sea level
    for (let x = 1; x <= 10; x++) {
      chunk.heights[x] = -10;
    }

    // 2. Lower an enclosed crater at (30..34, 30..34) surrounded by +50 ridge
    for (let z = 30; z <= 34; z++) {
      for (let x = 30; x <= 34; x++) {
        chunk.heights[z * CHUNK_SIZE + x] = -30;
      }
    }

    const start = performance.now();
    flood.propagateFromSeeds(lod, [{ cx: 0, cz: 0, lx: 0, lz: 0 }]);
    const duration = performance.now() - start;

    // Connected channel flooded
    expect(chunk.waterFlags[10]).toBe(WATER_OCEAN);
    // Enclosed basin stayed dry!
    expect(chunk.waterFlags[32 * CHUNK_SIZE + 32]).toBe(0);
    expect(duration).toBeLessThan(3);
  });

  it('drains a cut-off bay when a barrier is raised above sea level', () => {
    const tree = new QWorldChunkTree();
    const flood = new QWorldWaterFlood(tree, 0);
    const lod = 2;
    const chunk = tree.getOrCreateChunk(lod, 0, 0);
    chunk.heights.fill(50);

    // Create a channel (0,0)..(10,0) flooded with ocean
    for (let x = 0; x <= 10; x++) {
      chunk.heights[x] = -10;
    }
    flood.propagateFromSeeds(lod, [{ cx: 0, cz: 0, lx: 0, lz: 0 }]);
    expect(chunk.waterFlags[10]).toBe(WATER_OCEAN);

    // Raise barrier at x=5 above sea level
    chunk.heights[5] = 20;
    flood.recomputeArea(lod, { minCx: 0, maxCx: 0, minCz: 0, maxCz: 0 }, [{ cx: 0, cz: 0, lx: 0, lz: 0 }]);

    expect(chunk.waterFlags[3]).toBe(WATER_OCEAN); // Ocean side stays wet
    expect(chunk.waterFlags[5]).toBe(0);           // Barrier is dry
    expect(chunk.waterFlags[10]).toBe(0);          // Cut-off bay drains dry
  });

  it('flood-fills 164,025 connected sea-level cells in under 35 ms', () => {
    const tree = new QWorldChunkTree();
    const flood = new QWorldWaterFlood(tree, 0);
    const lod = 2;

    // 5x5 grid of 81x81 chunks = 25 * 6561 = 164,025 cells all at -5 (dry before flood)
    for (let cz = 0; cz < 5; cz++) {
      for (let cx = 0; cx < 5; cx++) {
        const c = tree.getOrCreateChunk(lod, cx, cz);
        c.heights.fill(-5);
        c.waterFlags.fill(0);
      }
    }

    const start = performance.now();
    const floodedCount = flood.propagateFromSeeds(lod, [{ cx: 0, cz: 0, lx: 0, lz: 0 }]);
    const duration = performance.now() - start;

    expect(floodedCount).toBe(164_025);
    expect(duration).toBeLessThan(35);
  });
});
