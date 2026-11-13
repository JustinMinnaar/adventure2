import { describe, it, expect } from 'vitest';
import { QWorldChunkTree } from '../core/QWorldChunkTree';
import { QWorldVectorTree } from '../core/QWorldVectorTree';
import { QWorldStorage } from '../core/QWorldStorage';

describe('QWorldStorage', () => {
  it('serializes and restores 500 delta chunks and 2,000 vectors in under 50 ms each', () => {
    const chunkTree = new QWorldChunkTree();
    const vectorTree = new QWorldVectorTree({ minX: -100_000, maxX: 100_000, minZ: -100_000, maxZ: 100_000 });

    for (let i = 0; i < 500; i++) {
      const c = chunkTree.getOrCreateChunk(2, i % 25, Math.floor(i / 25));
      c.heights.fill((i % 10) * 50);
      c.biomes.fill((i % 5) + 1);
    }

    for (let i = 0; i < 2_000; i++) {
      vectorTree.addMarker({
        id: `m-${i}`,
        name: `Place ${i}`,
        category: 'settlement',
        x: i * 10,
        z: i * 10,
        minLod: 0,
        maxLod: 5,
      });
    }

    const startExport = performance.now();
    const json = QWorldStorage.serializeToJson(chunkTree, vectorTree, 'Test Continent');
    const exportDuration = performance.now() - startExport;

    expect(json.length).toBeGreaterThan(1000);
    expect(exportDuration).toBeLessThan(50);

    const startImport = performance.now();
    const restored = QWorldStorage.deserializeFromJson(json);
    const importDuration = performance.now() - startImport;

    expect(restored.chunkTree.getStoredChunkCount()).toBe(500);
    expect(restored.vectorTree.getMarkerCount()).toBe(2_000);
    expect(importDuration).toBeLessThan(50);
  });
});
