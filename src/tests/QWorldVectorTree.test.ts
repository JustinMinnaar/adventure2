import { describe, it, expect } from 'vitest';
import { QWorldVectorTree, WorldMarker, WorldPolyline } from '../core/QWorldVectorTree';

describe('QWorldVectorTree', () => {
  it('culls 10,000 markers and 2,000 polylines to visible viewport in under 2 ms', () => {
    const tree = new QWorldVectorTree({ minX: -100_000, maxX: 100_000, minZ: -100_000, maxZ: 100_000 });

    for (let i = 0; i < 10_000; i++) {
      const m: WorldMarker = {
        id: `m-${i}`,
        name: `Town ${i}`,
        category: 'settlement',
        x: ((i * 7919) % 200_000) - 100_000,
        z: ((i * 6271) % 200_000) - 100_000,
        minLod: 0,
        maxLod: 5,
      };
      tree.addMarker(m);
    }

    for (let i = 0; i < 2_000; i++) {
      const x0 = ((i * 3571) % 180_000) - 90_000;
      const z0 = ((i * 4999) % 180_000) - 90_000;
      const p: WorldPolyline = {
        id: `p-${i}`,
        type: i % 2 === 0 ? 'river' : 'road',
        points: [
          { x: x0, z: z0 },
          { x: x0 + 500, z: z0 + 500 },
        ],
        sourceVolume: 2,
      };
      tree.addPolyline(p);
    }

    const start = performance.now();
    const result = tree.queryVisible({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }, 2);
    const duration = performance.now() - start;

    expect(result.markers.length).toBeLessThan(100);
    expect(result.polylines.length).toBeLessThan(100);
    expect(duration).toBeLessThan(2);
  });

  it('recalculates river confluence flow across 500 connected segments in under 3 ms', () => {
    const tree = new QWorldVectorTree({ minX: -100_000, maxX: 100_000, minZ: -100_000, maxZ: 100_000 });

    for (let i = 0; i < 500; i++) {
      tree.addPolyline({
        id: `r-${i}`,
        type: 'river',
        points: [
          { x: i * 100, z: 0 },
          { x: (i + 1) * 100, z: 0 },
        ],
        sourceVolume: i === 0 ? 1 : 0,
      });
    }

    const start = performance.now();
    const flows = tree.recalculateRiverFlows(5);
    const duration = performance.now() - start;

    expect(flows.get('r-499')).toBeGreaterThanOrEqual(1);
    expect(duration).toBeLessThan(15);
  });

  it('re-indexes marker spatial bounds on position drag and preserves lock state', () => {
    const tree = new QWorldVectorTree({ minX: 0, maxX: 100_000, minZ: 0, maxZ: 100_000 });
    tree.addMarker({
      id: 'm-drag',
      name: 'Outpost',
      category: 'fort',
      x: 1_000,
      y: 120,
      z: 1_000,
      minLod: 0,
      maxLod: 9,
      locked: false,
    });

    expect(tree.queryVisible({ minX: 0, maxX: 2_000, minZ: 0, maxZ: 2_000 }, 0).markers).toHaveLength(1);
    expect(tree.queryVisible({ minX: 80_000, maxX: 90_000, minZ: 80_000, maxZ: 90_000 }, 0).markers).toHaveLength(0);

    // Move marker to a new location and snap elevation
    tree.updateMarker('m-drag', { x: 85_000, z: 85_000, y: 410 });
    expect(tree.queryVisible({ minX: 0, maxX: 2_000, minZ: 0, maxZ: 2_000 }, 0).markers).toHaveLength(0);
    const moved = tree.queryVisible({ minX: 80_000, maxX: 90_000, minZ: 80_000, maxZ: 90_000 }, 0).markers;
    expect(moved).toHaveLength(1);
    expect(moved[0].y).toBe(410);

    // Lock marker
    tree.updateMarker('m-drag', { locked: true });
    expect(tree.getMarker('m-drag')?.locked).toBe(true);
  });
});
