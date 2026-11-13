import { describe, it, expect } from 'vitest';
import { QWorldChunkTree, CHUNK_SIZE, DEFAULT_SEA_LEVEL } from '../core/QWorldChunkTree';

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
    expect(duration).toBeLessThan(5);
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

    const start = performance.now();
    tree.sampleChunkGrid(5, 0, 0, outHeights, outBiomes);
    const duration = performance.now() - start;

    expect(spacingL5).toBeGreaterThan(0);
    expect(outHeights[0]).toBeGreaterThanOrEqual(0);
    expect(outBiomes[40 * CHUNK_SIZE + 40]).toBe(2);
    expect(tree.getStoredChunkCount(5)).toBe(0); // Still 0 stored L5 delta chunks!
    expect(duration).toBeLessThan(3);
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
});
