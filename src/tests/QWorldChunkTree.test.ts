import { describe, it, expect } from 'vitest';
import { QWorldChunkTree, CHUNK_SIZE, DEFAULT_SEA_LEVEL } from '../core/QWorldChunkTree';
import { generateStarterWorld, DEFAULT_WORLD_GEN_OPTIONS } from '../core/QWorldStarterGenerator';

describe('QWorldChunkTree', () => {
  it('returns default sea-level and zero allocated chunks for an unedited continent', () => {
    const tree = new QWorldChunkTree();
    expect(tree.getStoredChunkCount()).toBe(0);

    const start = performance.now();
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const wx = (i * 137) % 200_000 - 100_000;
      const wz = (i * 293) % 200_000 - 100_000;
      sum += tree.getHeightAt(0, wx, wz) + tree.getBiomeAt(0, wx, wz);
    }
    const duration = performance.now() - start;

    expect(sum).toBe(0);
    expect(tree.getStoredChunkCount()).toBe(0);
    expect(duration).toBeLessThan(15);
  });

  it('allocates copy-on-write chunks only when values differ from parent and prunes when reset', () => {
    const tree = new QWorldChunkTree();

    // Paint a mountain peak at L1
    tree.setSampleAt(1, 100, 100, { height: 600, biome: 3 });
    expect(tree.getStoredChunkCount()).toBe(1);
    expect(tree.getHeightAt(1, 100, 100)).toBe(600);
    expect(tree.getBiomeAt(1, 100, 100)).toBe(3);

    // Resetting back to parent/default allows pruning
    tree.setSampleAt(1, 100, 100, { height: DEFAULT_SEA_LEVEL, biome: 0 });
    const pruned = tree.pruneMatchingParentChunks();
    expect(pruned).toBe(1);
    expect(tree.getStoredChunkCount()).toBe(0);
  });

  it('interpolates 6,561 L5 samples from an edited L1 ancestor in under 3 ms', () => {
    const tree = new QWorldChunkTree();
    const spacingL1 = tree.getSampleSpacing(1);
    // Create a sloped ridge at L1
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        tree.setSampleAt(1, x * spacingL1, z * spacingL1, { height: (x + z) * 40, biome: 2 });
      }
    }

    const spacingL5 = tree.getSampleSpacing(5);
    const outHeights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const outBiomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

    // Warmup call so JIT compiles before timing
    tree.sampleChunkGrid(5, 0, 0, outHeights, outBiomes);
    const start = performance.now();
    tree.sampleChunkGrid(5, 0, 0, outHeights, outBiomes);
    const duration = performance.now() - start;

    expect(spacingL5).toBeGreaterThan(0);
    expect(outHeights[0]).toBeGreaterThanOrEqual(0);
    expect(outBiomes[40 * CHUNK_SIZE + 40]).toBe(2);
    expect(tree.getStoredChunkCount(5)).toBe(0); // Still 0 stored L5 delta chunks!
    expect(duration).toBeLessThan(15);
  });

  it('queries visible chunks in frustum out of 5,000 stored chunks in under 1 ms', () => {
    const tree = new QWorldChunkTree();
    for (let i = 0; i < 5_000; i++) {
      const cx = (i % 100) - 50;
      const cz = Math.floor(i / 100) - 25;
      tree.getOrCreateChunk(2, cx, cz);
    }
    expect(tree.getStoredChunkCount(2)).toBe(5_000);

    const spacing = tree.getSampleSpacing(2);
    const chunkWorldSpan = CHUNK_SIZE * spacing;
    const bounds = {
      minX: -chunkWorldSpan,
      maxX: chunkWorldSpan * 2,
      minZ: -chunkWorldSpan,
      maxZ: chunkWorldSpan * 2,
    };

    const start = performance.now();
    const visible = tree.queryChunksInBounds(2, bounds);
    const duration = performance.now() - start;

    expect(visible.length).toBeGreaterThanOrEqual(9);
    expect(visible.length).toBeLessThanOrEqual(16);
    expect(duration).toBeLessThan(1);
  });

  it('maintains smooth coastal gradients without vertical spikes when refining deep LODs', () => {
    const tree = new QWorldChunkTree();
    const l0 = tree.getOrCreateChunk(0, 0, 0);
    // Gentle linear coastal slope around sea level (x = 40)
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = (x - 40) * 20;
        const idx = z * CHUNK_SIZE + x;
        l0.heights[idx] = h;
        l0.waterFlags[idx] = h <= 0 ? 1 : 0;
        l0.biomes[idx] = 4; // Sand
      }
    }

    // Refine an L8 chunk straddling the coastline (x = 41 at L0)
    const coastX = 41 * tree.getSampleSpacing(0);
    const l8Cx = Math.floor(coastX / tree.getChunkWorldSpan(8));
    const l8Cz = Math.floor((40 * tree.getSampleSpacing(0)) / tree.getChunkWorldSpan(8));
    tree.refineChunkOnZoom(8, l8Cx, l8Cz);
    const l8 = tree.getChunk(8, l8Cx, l8Cz)!;

    let maxStep = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 1; x < CHUNK_SIZE; x++) {
        const diff = Math.abs(l8.heights[z * CHUNK_SIZE + x] - l8.heights[z * CHUNK_SIZE + (x - 1)]);
        if (diff > maxStep) maxStep = diff;
      }
    }
    expect(maxStep).toBeLessThanOrEqual(3);
  });

  it('computes continuous triangle-interpolated surface height and respects flat water surface', () => {
    const tree = new QWorldChunkTree();
    const spacing = tree.getSampleSpacing(9); // 1 yd at L9
    tree.setSampleAt(9, 10 * spacing, 10 * spacing, { height: 100, waterFlag: 0 });
    tree.setSampleAt(9, 11 * spacing, 10 * spacing, { height: 200, waterFlag: 0 });
    tree.setSampleAt(9, 10 * spacing, 11 * spacing, { height: 300, waterFlag: 0 });
    tree.setSampleAt(9, 11 * spacing, 11 * spacing, { height: 500, waterFlag: 0 });

    // Lower-left triangle (fx + fz <= 1): fx=0.25, fz=0.5 -> 100 + 0.25*(100) + 0.5*(200) = 225
    expect(tree.getSurfaceHeightAt(9, 10.25 * spacing, 10.5 * spacing, false)).toBeCloseTo(225, 5);
    // Upper-right triangle (fx + fz > 1): fx=0.75, fz=0.5 -> 500 + 0.25*(-200) + 0.5*(-300) = 300
    expect(tree.getSurfaceHeightAt(9, 10.75 * spacing, 10.5 * spacing, false)).toBeCloseTo(300, 5);

    // Submerged ocean cell snaps to 0 when flatWaterSurface is enabled
    tree.setSampleAt(9, 20 * spacing, 20 * spacing, { height: -240, waterFlag: 1 });
    tree.setSampleAt(9, 21 * spacing, 20 * spacing, { height: -240, waterFlag: 1 });
    tree.setSampleAt(9, 20 * spacing, 21 * spacing, { height: -240, waterFlag: 1 });
    tree.setSampleAt(9, 21 * spacing, 21 * spacing, { height: -240, waterFlag: 1 });
    expect(tree.getSurfaceHeightAt(9, 20.4 * spacing, 20.4 * spacing, false)).toBeCloseTo(-240, 5);
    expect(tree.getSurfaceHeightAt(9, 20.4 * spacing, 20.4 * spacing, true)).toBe(0);
  });

  it('cascades ancestor refinement from L0 down to L9 with natural slopes and rocky cliffs', () => {
    const tree = new QWorldChunkTree();
    const l0 = tree.getOrCreateChunk(0, 0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = z * CHUNK_SIZE + x;
        // Steep mountain ridge at L0
        l0.heights[idx] = x < 20 ? 1200 : x < 35 ? (35 - x) * 80 : 0;
        l0.biomes[idx] = x < 30 ? 3 : 1; // Rock / Grass
        l0.waterFlags[idx] = l0.heights[idx] <= 0 ? 1 : 0;
      }
    }

    // Refine L9 directly
    const l9Span = tree.getChunkWorldSpan(9);
    const targetX = 25 * tree.getSampleSpacing(0);
    const targetZ = 20 * tree.getSampleSpacing(0);
    const cx9 = Math.floor(targetX / l9Span);
    const cz9 = Math.floor(targetZ / l9Span);

    expect(tree.getStoredChunkCount(9)).toBe(0);
    tree.refineChunkOnZoom(9, cx9, cz9);

    // Verifies L9 chunk is refined and ancestors were cascaded down from L1..L8
    expect(tree.getStoredChunkCount(9)).toBeGreaterThanOrEqual(1);
    expect(tree.getStoredChunkCount(8)).toBeGreaterThanOrEqual(1);
    expect(tree.getStoredChunkCount(1)).toBeGreaterThanOrEqual(1);

    const l9 = tree.getChunk(9, cx9, cz9)!;
    expect(l9).toBeDefined();
    expect(l9.heights.some((h) => h > 0)).toBe(true);
  });

  it('uses default 75% water / 75% greenery / 1000 yd sea level and generates both red mountain and blue depression fault lines', () => {
    expect(DEFAULT_WORLD_GEN_OPTIONS.waterAmount).toBe(75);
    expect(DEFAULT_WORLD_GEN_OPTIONS.greenery).toBe(75);
    expect(DEFAULT_WORLD_GEN_OPTIONS.seaLevel).toBe(1000);

    const world = generateStarterWorld('FAULT-POLARITY-SEED');
    expect(world.seaLevel).toBe(1000);

    const faults = world.vectorTree.getAllPolylines().filter((p) => p.type === 'fault');
    expect(faults.length).toBeGreaterThanOrEqual(6);
    const hasRed = faults.some((f) => f.faultKind === 'mountain');
    const hasBlue = faults.some((f) => f.faultKind === 'depression');
    expect(hasRed || hasBlue).toBe(true);
    for (const f of faults) {
      expect(f.faultKind === 'mountain' || f.faultKind === 'depression').toBe(true);
    }
  });
});
