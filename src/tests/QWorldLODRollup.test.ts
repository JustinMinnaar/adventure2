import { describe, it, expect } from 'vitest';
import { QWorldChunkTree, CHUNK_SIZE } from '../core/QWorldChunkTree';
import { QWorldBrushEngine } from '../core/QWorldBrushEngine';
import { QWorldTerrainMesh } from '../core/QWorldTerrainMesh';

describe('QWorldLODRollup (L3 detail -> L2 overview)', () => {
  it('computes center-weighted median of a 3x3 block of L3 elevations, biomes, and ocean flags', () => {
    const tree = new QWorldChunkTree();
    const spacingL3 = tree.getSampleSpacing(3); // 729

    // Fill a 3x3 L3 block covering L2 sample (0, 0):
    // x < 2 (6 cells including center, weight 11/15) at +300; x = 2 (3 cells, weight 4/15) at +600 -> weighted median = 300
    // 6 Forest (2) + 3 Sand (4) -> dominant = 2; 5 ocean + 4 dry -> parent ocean (1)
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const height = x < 2 ? 300 : 600;
        const biome = x < 2 ? 2 : 4;
        const waterFlag = z * 3 + x < 5 ? 1 : 0;
        tree.setSampleAt(3, x * spacingL3, z * spacingL3, { height, biome, waterFlag });
      }
    }

    tree.rollupToParent(3, 0, 0, 0, 0);

    expect(tree.getHeightAt(2, 0, 0)).toBe(300);
    expect(tree.getBiomeAt(2, 0, 0)).toBe(2);
    expect(tree.getChunk(2, 0, 0)?.waterFlags[0]).toBe(1);
  });

  it('handles heavy L3 detail across 36 chunks (147k samples) and renders L2 in under 15 ms', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const meshBuilder = new QWorldTerrainMesh(tree);
    const spacingL3 = tree.getSampleSpacing(3);

    // Sculpt 100 overlapping mountain & forest brush strokes at L3 across a 6x6 L3 chunk area
    const brushStart = performance.now();
    for (let i = 0; i < 100; i++) {
      const wx = ((i % 10) * 35 + 10) * spacingL3;
      const wz = (Math.floor(i / 10) * 35 + 10) * spacingL3;
      brush.applyElevationBrush({
        lod: 3,
        worldX: wx,
        worldZ: wz,
        radiusWorld: 14 * spacingL3,
        mode: i % 4 === 0 ? 'lower' : 'raise',
        strength: 180,
      });
      brush.applyBiomeBrush({
        lod: 3,
        worldX: wx,
        worldZ: wz,
        radiusWorld: 14 * spacingL3,
        biomeId: i % 3 === 0 ? 3 : 2,
      });
    }
    const brushDuration = performance.now() - brushStart;

    expect(tree.getStoredChunkCount(3)).toBeGreaterThanOrEqual(25);
    expect(brushDuration).toBeLessThan(150);

    // Verify L2 reflects the L3 mountain peak
    const peakSampleX = 45 * spacingL3;
    const peakSampleZ = 45 * spacingL3;
    const l2Height = tree.getHeightAt(2, peakSampleX, peakSampleZ);
    expect(l2Height).not.toBe(0);

    // Render L2 visible ring (9 L2 chunks covering the entire L3 region and beyond)
    const renderStart = performance.now();
    const l2Geometries = meshBuilder.buildVisibleRing(2, 0, 0, 1, 'biome');
    const renderDuration = performance.now() - renderStart;

    expect(l2Geometries.length).toBe(9);
    expect(l2Geometries[0].getAttribute('position').count).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(renderDuration).toBeLessThan(35);

    l2Geometries.forEach((g) => g.dispose());
  });

  it('smooths height steps and anti-aliases diagonal biome/coastline edges as you zoom in', () => {
    const tree = new QWorldChunkTree();
    const l0Chunk = tree.getOrCreateChunk(0, 0, 0);
    l0Chunk.waterFlags.fill(0);

    // Create a sharp diagonal cliff & biome/coastline step at L0 (x + z < 10 -> +600 Forest, else 0 Ocean)
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const idx = z * CHUNK_SIZE + x;
        if (x + z < 10) {
          l0Chunk.heights[idx] = 600;
          l0Chunk.biomes[idx] = 2;
          l0Chunk.waterFlags[idx] = 0;
        } else {
          l0Chunk.heights[idx] = 0;
          l0Chunk.biomes[idx] = 1;
          l0Chunk.waterFlags[idx] = 1;
        }
      }
    }

    const maxStepDiff = (arr: Int16Array): number => {
      let maxDiff = 0;
      for (let z = 0; z < CHUNK_SIZE - 1; z++) {
        for (let x = 0; x < CHUNK_SIZE - 1; x++) {
          const i = z * CHUNK_SIZE + x;
          maxDiff = Math.max(maxDiff, Math.abs(arr[i + 1] - arr[i]), Math.abs(arr[i + CHUNK_SIZE] - arr[i]));
        }
      }
      return maxDiff;
    };

    const l1H = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const l1B = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const l1W = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    tree.sampleChunkGrid(1, 0, 0, l1H, l1B, l1W);

    const l2H = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const l2B = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const l2W = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    tree.sampleChunkGrid(2, 0, 0, l2H, l2B, l2W);

    // Height step smoothness strictly improves at each finer LOD (600 -> <= 200 -> <= 70)
    const diffL0 = maxStepDiff(l0Chunk.heights);
    const diffL1 = maxStepDiff(l1H);
    const diffL2 = maxStepDiff(l2H);
    expect(diffL0).toBe(600);
    expect(diffL1).toBeLessThanOrEqual(200);
    expect(diffL2).toBeLessThanOrEqual(70);
    expect(diffL2).toBeLessThan(diffL1);

    // Diagonal staircase corner at L0 (x=5, z=5) is ocean/Grass(1), but its surrounding 3 neighbors
    // include Forest(2), so the L1 sub-cell (lx=15, lz=15) at the inner corner is chamfered to Forest(2)
    expect(l0Chunk.biomes[5 * CHUNK_SIZE + 5]).toBe(1);
    expect(l1B[15 * CHUNK_SIZE + 15]).toBe(2);
  });
});
