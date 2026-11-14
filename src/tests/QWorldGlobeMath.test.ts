import { describe, it, expect } from 'vitest';
import {
  PLANET_RADIUS_YARDS,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from '../core/QWorldChunkTree';
import {
  computeGlobeBlend,
  computeGlobeFrontCos,
  computeGlobeTargetLatRad,
  intersectGlobeEllipsoid,
  isGlobePointVisible,
  projectWorldToGlobe,
} from '../core/QWorldGlobeMath';

describe('QWorldGlobeMath', () => {
  it('reaches full globeBlend across all of L0 (distance >= 700,000)', () => {
    expect(computeGlobeBlend(20000)).toBe(0);
    expect(computeGlobeBlend(5000)).toBe(0);
    const mid = computeGlobeBlend(360000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(computeGlobeBlend(700000)).toBe(1);
    expect(computeGlobeBlend(950000)).toBe(1);
    expect(computeGlobeBlend(3200000)).toBe(1);
  });

  it('converges all longitudes at North Pole (wz = 0) and South Pole (wz = WORLD_SPAN_Z) to the spin-axis exit points', () => {
    const out = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
    const cases = [
      { targetX: 4785434, targetZ: 750000 },
      { targetX: WORLD_SPAN_X * 0.5, targetZ: WORLD_SPAN_Z * 0.5 },
      { targetX: 1200000, targetZ: 5600000 },
    ];
    const longitudes = [0, WORLD_SPAN_X * 0.25, WORLD_SPAN_X * 0.5, WORLD_SPAN_X * 0.75, WORLD_SPAN_X];

    for (const { targetX, targetZ } of cases) {
      const targetLat = computeGlobeTargetLatRad(targetZ);
      const expectedNorthX = targetX;
      const expectedNorthY = -0.65 * PLANET_RADIUS_YARDS * Math.sin(targetLat) - PLANET_RADIUS_YARDS;
      const expectedNorthZ = targetZ - PLANET_RADIUS_YARDS * Math.cos(targetLat);

      const expectedSouthX = targetX;
      const expectedSouthY = 0.65 * PLANET_RADIUS_YARDS * Math.sin(targetLat) - PLANET_RADIUS_YARDS;
      const expectedSouthZ = targetZ + PLANET_RADIUS_YARDS * Math.cos(targetLat);

      for (const wx of longitudes) {
        projectWorldToGlobe(wx, 0, 0, targetX, targetZ, 1.0, out);
        expect(out.x).toBeCloseTo(expectedNorthX, 3);
        expect(out.y).toBeCloseTo(expectedNorthY, 3);
        expect(out.z).toBeCloseTo(expectedNorthZ, 3);

        projectWorldToGlobe(wx, 0, WORLD_SPAN_Z, targetX, targetZ, 1.0, out);
        expect(out.x).toBeCloseTo(expectedSouthX, 3);
        expect(out.y).toBeCloseTo(expectedSouthY, 3);
        expect(out.z).toBeCloseTo(expectedSouthZ, 3);
      }
    }
  });

  it('keeps the far-side northern polar cap visible and fills between the North Pole and northern limb', () => {
    const targetX = 4785434;
    const targetZ = 750000;
    const targetLat = computeGlobeTargetLatRad(targetZ);
    const northPoleZ = targetZ - PLANET_RADIUS_YARDS * Math.cos(targetLat);
    const northLimbZ = targetZ - PLANET_RADIUS_YARDS;

    const farSideWx = (targetX + WORLD_SPAN_X * 0.5) % WORLD_SPAN_X;
    const farSideWz = 500000;

    expect(computeGlobeFrontCos(farSideWx, farSideWz, targetX, targetZ)).toBeGreaterThan(0.5);
    expect(isGlobePointVisible(farSideWx, farSideWz, targetX, targetZ, 1.0)).toBe(true);

    const out = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
    projectWorldToGlobe(farSideWx, 0, farSideWz, targetX, targetZ, 1.0, out);
    expect(out.z).toBeLessThan(northPoleZ);
    expect(out.z).toBeGreaterThanOrEqual(northLimbZ);
    expect(out.y).toBeGreaterThan(-PLANET_RADIUS_YARDS);

    // Opposite southern hemisphere back-side should be culled
    expect(isGlobePointVisible(farSideWx, WORLD_SPAN_Z * 0.8, targetX, targetZ, 1.0)).toBe(false);
  });

  it('inverts rays accurately on both the near hemisphere and across the North Pole', () => {
    const targetX = 4785434;
    const targetZ = 750000;
    const camPos = { x: targetX, y: 3000000, z: targetZ + 200000 };
    const projected = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
    const recovered = { wx: 0, wz: 0 };

    const samples = [
      { wx: targetX + 400000, wz: targetZ + 300000 },
      { wx: targetX + WORLD_SPAN_X * 0.45, wz: 400000 },
    ];

    for (const s of samples) {
      projectWorldToGlobe(s.wx, 0, s.wz, targetX, targetZ, 1.0, projected);
      const dx = projected.x - camPos.x;
      const dy = projected.y - camPos.y;
      const dz = projected.z - camPos.z;
      const len = Math.hypot(dx, dy, dz);

      const hit = intersectGlobeEllipsoid(
        camPos.x,
        camPos.y,
        camPos.z,
        dx / len,
        dy / len,
        dz / len,
        targetX,
        targetZ,
        recovered
      );
      expect(hit).toBe(true);
      expect(recovered.wz).toBeCloseTo(s.wz, 2);

      // Compare wrapped longitude difference
      const diffX = Math.abs((((recovered.wx - s.wx + WORLD_SPAN_X * 0.5) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X - WORLD_SPAN_X * 0.5);
      expect(diffX).toBeLessThan(1e-2);
    }

    // Ray pointing into empty space misses the globe
    const miss = intersectGlobeEllipsoid(
      camPos.x,
      camPos.y,
      camPos.z,
      1,
      0,
      0,
      targetX,
      targetZ,
      recovered
    );
    expect(miss).toBe(false);
  });

  it('projects and visibility-tests 100,000 globe points in under 15 ms', () => {
    const out = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
    const targetX = 4785434;
    const targetZ = 750000;
    let acc = 0;

    // Warm up JIT
    for (let i = 0; i < 10_000; i++) {
      const wx = (i * 127) % WORLD_SPAN_X;
      const wz = (i * 63) % WORLD_SPAN_Z;
      if (isGlobePointVisible(wx, wz, targetX, targetZ, 1.0)) {
        projectWorldToGlobe(wx, 100, wz, targetX, targetZ, 1.0, out);
        acc += out.x;
      }
    }

    let visibleCount = 0;
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      const wx = (i * 127) % WORLD_SPAN_X;
      const wz = (i * 63) % WORLD_SPAN_Z;
      if (isGlobePointVisible(wx, wz, targetX, targetZ, 1.0)) {
        projectWorldToGlobe(wx, 100, wz, targetX, targetZ, 1.0, out);
        acc += out.x;
        visibleCount++;
      }
    }
    const durationMs = performance.now() - start;

    expect(acc).not.toBe(0);
    expect(visibleCount).toBeGreaterThan(40_000);
    expect(durationMs).toBeLessThan(15);
  });
});
