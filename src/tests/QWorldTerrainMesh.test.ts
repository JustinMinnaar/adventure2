import { describe, it, expect } from 'vitest';
import { QWorldChunkTree } from '../core/QWorldChunkTree';
import { QWorldTerrainMesh } from '../core/QWorldTerrainMesh';

describe('QWorldTerrainMesh', () => {
  it('builds BufferGeometry for 9 visible 81x81 chunks in under 45 ms', () => {
    const tree = new QWorldChunkTree();
    const meshBuilder = new QWorldTerrainMesh(tree);
    const lod = 2;

    // Paint a few chunks
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const c = tree.getOrCreateChunk(lod, cx, cz);
        c.heights.fill(100);
        c.biomes.fill(2);
      }
    }

    const start = performance.now();
    const meshes = [];
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        meshes.push(meshBuilder.buildChunkGeometry(lod, cx, cz, 'biome'));
      }
    }
    const duration = performance.now() - start;

    expect(meshes.length).toBe(9);
    expect(meshes[0].getAttribute('position').count).toBe(81 * 81);
    expect(meshes[0].getAttribute('color').count).toBe(81 * 81);
    expect(duration).toBeLessThan(45);

    meshes.forEach((g) => g.dispose());
  });

  it('switches LOD from L0 to L9 and rebuilds 9 visible chunks in under 35 ms', () => {
    const tree = new QWorldChunkTree();
    const meshBuilder = new QWorldTerrainMesh(tree);

    tree.setSampleAt(0, 0, 0, { height: 400, biome: 3 });

    const start = performance.now();
    const geometries = meshBuilder.buildVisibleRing(9, 0, 0, 1, 'heatmap');
    const duration = performance.now() - start;

    expect(geometries.length).toBe(9);
    expect(duration).toBeLessThan(35);

    geometries.forEach((g) => g.dispose());
  });

  it('culls and updates 5,000 instanced props at L7..L9 in under 4 ms', () => {
    const tree = new QWorldChunkTree();
    const meshBuilder = new QWorldTerrainMesh(tree);
    const spacing = tree.getSampleSpacing(7);

    // Paint a forest chunk at L7
    const chunk = tree.getOrCreateChunk(7, 0, 0);
    chunk.heights.fill(40);
    chunk.biomes.fill(2); // Forest

    const start = performance.now();
    const transforms = meshBuilder.collectVisiblePropTransforms(7, {
      minX: 0,
      maxX: 81 * spacing,
      minZ: 0,
      maxZ: 81 * spacing,
    }, 5_000);
    const duration = performance.now() - start;

    expect(transforms.length).toBeGreaterThan(0);
    expect(transforms.length).toBeLessThanOrEqual(5_000);
    expect(duration).toBeLessThan(4);
  });
});
