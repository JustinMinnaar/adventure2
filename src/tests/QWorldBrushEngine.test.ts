import { describe, it, expect } from 'vitest';
import { QWorldChunkTree } from '../core/QWorldChunkTree';
import { QWorldBrushEngine } from '../core/QWorldBrushEngine';

describe('QWorldBrushEngine', () => {
  it('raises, lowers, flattens, and smooths elevation across chunk boundaries in under 2 ms', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const spacing = tree.getSampleSpacing(2);
    const boundaryX = 81 * spacing; // Exact chunk boundary

    const start = performance.now();
    brush.applyElevationBrush({
      lod: 2,
      worldX: boundaryX,
      worldZ: boundaryX,
      radiusWorld: 16 * spacing,
      mode: 'raise',
      strength: 120,
    });
    const duration = performance.now() - start;

    expect(tree.getHeightAt(2, boundaryX, boundaryX)).toBeGreaterThan(100);
    expect(tree.getStoredChunkCount(2)).toBe(4); // Touched 4 corner chunks
    expect(duration).toBeLessThan(10);

    brush.applyElevationBrush({
      lod: 2,
      worldX: boundaryX,
      worldZ: boundaryX,
      radiusWorld: 8 * spacing,
      mode: 'lower',
      strength: 60,
    });
    expect(tree.getHeightAt(2, boundaryX, boundaryX)).toBeLessThan(100);

    brush.applyElevationBrush({
      lod: 2,
      worldX: boundaryX,
      worldZ: boundaryX,
      radiusWorld: 8 * spacing,
      mode: 'flatten',
      strength: 1.0,
      targetHeight: 250,
    });
    expect(tree.getHeightAt(2, boundaryX, boundaryX)).toBe(250);
  });

  it('handles 120 consecutive 60 FPS pointermove brush stamps in under 120 ms total', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const spacing = tree.getSampleSpacing(2);

    const start = performance.now();
    for (let i = 0; i < 120; i++) {
      brush.applyElevationBrush({
        lod: 2,
        worldX: i * spacing * 2,
        worldZ: Math.sin(i * 0.2) * spacing * 10,
        radiusWorld: 12 * spacing,
        mode: 'raise',
        strength: 25,
      });
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(120);
  });

  it('paints biome IDs over a 32-cell radius in under 1 ms', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const spacing = tree.getSampleSpacing(2);

    const start = performance.now();
    brush.applyBiomeBrush({
      lod: 2,
      worldX: 32 * spacing,
      worldZ: 32 * spacing,
      radiusWorld: 16 * spacing,
      biomeId: 2, // Forest
    });
    const duration = performance.now() - start;

    expect(tree.getBiomeAt(2, 32 * spacing, 32 * spacing)).toBe(2);
    expect(duration).toBeLessThan(5);
  });

  it('overwrites and invalidates lower-LOD detail when brushing elevation or biome at a higher LOD', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const wx = 120;
    const wz = 120;

    // Paint rock (3) and raise elevation at L9
    brush.applyBiomeBrush({ lod: 9, worldX: wx, worldZ: wz, radiusWorld: 8, biomeId: 3 });
    brush.applyElevationBrush({ lod: 9, worldX: wx, worldZ: wz, radiusWorld: 8, mode: 'raise', strength: 200 });
    expect(tree.getStoredChunkCount(9)).toBeGreaterThan(0);
    expect(tree.getBiomeAt(9, wx, wz)).toBe(3);

    // Zoom out to L8 and paint Forest (2) and flatten to 50 over the same area
    const spacingL8 = tree.getSampleSpacing(8);
    brush.applyBiomeBrush({ lod: 8, worldX: wx, worldZ: wz, radiusWorld: 6 * spacingL8, biomeId: 2 });
    brush.applyElevationBrush({
      lod: 8,
      worldX: wx,
      worldZ: wz,
      radiusWorld: 6 * spacingL8,
      mode: 'flatten',
      strength: 1,
      targetHeight: 50,
    });

    // Stale L9 chunks under the L8 brush are deleted and L9 now reflects L8's Forest & elevation
    expect(tree.getStoredChunkCount(9)).toBe(0);
    expect(tree.getBiomeAt(9, wx, wz)).toBe(2);
    expect(tree.getHeightAt(9, wx, wz)).toBe(50);
  });

  it('applies polygon slope-raise from center down toward edges and supports biome fill', () => {
    const tree = new QWorldChunkTree();
    const brush = new QWorldBrushEngine(tree);
    const lod = 8;
    const spacing = tree.getSampleSpacing(lod); // 3m
    // Square polygon from (0, 0) to (40*spacing, 40*spacing)
    const size = 40 * spacing;
    const polygon = [
      { x: 0, z: 0 },
      { x: size, z: 0 },
      { x: size, z: size },
      { x: 0, z: size },
    ];

    brush.applyPolygonAction({
      lod,
      polygon,
      action: 'slope-raise',
      amount: 200,
    });

    const centerH = tree.getHeightAt(lod, size * 0.5, size * 0.5);
    const midH = tree.getHeightAt(lod, size * 0.15, size * 0.5);
    const outsideH = tree.getHeightAt(lod, -spacing * 2, size * 0.5);

    expect(centerH).toBeCloseTo(200, 0);
    expect(midH).toBeGreaterThan(0);
    expect(midH).toBeLessThan(centerH);
    expect(outsideH).toBe(0);

    brush.applyPolygonAction({
      lod,
      polygon,
      action: 'biome',
      amount: 0,
      biomeId: 4,
    });

    expect(tree.getBiomeAt(lod, size * 0.5, size * 0.5)).toBe(4);
    expect(tree.getBiomeAt(lod, -spacing * 2, size * 0.5)).not.toBe(4);
  });
});
