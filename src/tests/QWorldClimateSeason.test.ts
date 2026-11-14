import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CELESTIAL_CONFIG,
  computeSolarDeclinationDeg,
  computeSubsolarLatLon,
  getNorthernSeasonWorldHours,
  computeCelestialSnapshot,
} from '../core/QWorldCelestial';
import { DEFAULT_WORLD_GEN_OPTIONS, generateStarterWorld } from '../core/QWorldStarterGenerator';
import { CHUNK_SIZE, WORLD_L0_CHUNKS_X, WORLD_L0_CHUNKS_Z } from '../core/QWorldChunkTree';
import { computeSeasonalWarmth, applyClimateBiomeColor } from '../core/QWorldTerrainMesh';

describe('QWorldClimateSeason', () => {
  it('computes solar declination across equinoxes and solstices from axial tilt', () => {
    const cfg = DEFAULT_CELESTIAL_CONFIG;
    const springH = getNorthernSeasonWorldHours('spring', 0, cfg);
    const summerH = getNorthernSeasonWorldHours('summer', 0, cfg);
    const autumnH = getNorthernSeasonWorldHours('autumn', 0, cfg);
    const winterH = getNorthernSeasonWorldHours('winter', 0, cfg);

    expect(Math.abs(computeSolarDeclinationDeg(springH, cfg))).toBeLessThan(1.0);
    expect(computeSolarDeclinationDeg(summerH, cfg)).toBeCloseTo(cfg.axialTiltDeg, 0);
    expect(Math.abs(computeSolarDeclinationDeg(autumnH, cfg))).toBeLessThan(1.0);
    expect(computeSolarDeclinationDeg(winterH, cfg)).toBeCloseTo(-cfg.axialTiltDeg, 0);

    expect(computeCelestialSnapshot(springH, 45, 0, cfg, false).seasonName).toBe('Spring');
    expect(computeCelestialSnapshot(summerH, 45, 0, cfg, false).seasonName).toBe('Summer');
    expect(computeCelestialSnapshot(autumnH, 45, 0, cfg, false).seasonName).toBe('Autumn');
    expect(computeCelestialSnapshot(winterH, 45, 0, cfg, false).seasonName).toBe('Winter');
  });

  it('computes subsolar longitude moving westward with time of day', () => {
    const cfg = DEFAULT_CELESTIAL_CONFIG;
    const noon = getNorthernSeasonWorldHours('spring', 12, cfg);
    const evening = getNorthernSeasonWorldHours('spring', 18, cfg);
    const morning = getNorthernSeasonWorldHours('spring', 6, cfg);

    expect(computeSubsolarLatLon(noon, cfg).longitudeDeg).toBeCloseTo(0, 1);
    expect(computeSubsolarLatLon(evening, cfg).longitudeDeg).toBeCloseTo(-90, 1);
    expect(computeSubsolarLatLon(morning, cfg).longitudeDeg).toBeCloseTo(90, 1);
  });

  it('produces opposite seasonal warmth in Northern vs Southern hemispheres', () => {
    // 45°N is at Z = 0.25 * WORLD_SPAN_Z; 45°S is at Z = 0.75 * WORLD_SPAN_Z
    const spanZ = WORLD_L0_CHUNKS_Z * CHUNK_SIZE * 19683;
    const north45Z = spanZ * 0.25;
    const south45Z = spanZ * 0.75;

    const northSummerWarmth = computeSeasonalWarmth(north45Z, 100, 23.4);
    const southWinterWarmth = computeSeasonalWarmth(south45Z, 100, 23.4);
    expect(northSummerWarmth).toBeGreaterThan(southWinterWarmth + 0.3);

    const northWinterWarmth = computeSeasonalWarmth(north45Z, 100, -23.4);
    const southSummerWarmth = computeSeasonalWarmth(south45Z, 100, -23.4);
    expect(southSummerWarmth).toBeGreaterThan(northWinterWarmth + 0.3);

    // Winter snow should brighten forest/grass toward snow/dormant in Northern Winter
    const outNorthWinter: [number, number, number] = [0, 0, 0];
    const outNorthSummer: [number, number, number] = [0, 0, 0];
    applyClimateBiomeColor(2, north45Z, 200, -23.4, outNorthWinter);
    applyClimateBiomeColor(2, north45Z, 200, 23.4, outNorthSummer);
    expect(outNorthWinter[0]).toBeGreaterThan(outNorthSummer[0]);
  });

  it('restricts green vegetation in polar zones while keeping temperate and warm equatorial belts', () => {
    const t0 = performance.now();
    const { chunkTree } = generateStarterWorld('CLIMATE-BAND-TEST', {
      waterAmount: 50,
      greenery: 75,
    });
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(3000);

    // Count land biomes in Polar (|lat| > 55°) vs Temperate (15° < |lat| <= 55°)
    let polarLand = 0;
    let polarGreen = 0;
    let tempLand = 0;
    let tempGreen = 0;
    const totalCellsZ = WORLD_L0_CHUNKS_Z * CHUNK_SIZE;

    for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
      for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
        const chunk = chunkTree.getChunk(0, cx, cz);
        if (!chunk) continue;
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const latDeg = Math.abs(90 - ((cz * CHUNK_SIZE + lz) / totalCellsZ) * 180);
          const isPolarBand = latDeg > 55;
          const isTempBand = latDeg > 15 && latDeg <= 55;
          if (!isPolarBand && !isTempBand) continue;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const i = lz * CHUNK_SIZE + lx;
            if (chunk.heights[i] <= 1000) continue; // above sea level
            const b = chunk.biomes[i];
            const isGreen = b === 1 || b === 2 || b === 5 || b === 6;
            if (isPolarBand) {
              polarLand++;
              if (isGreen) polarGreen++;
            } else {
              tempLand++;
              if (isGreen) tempGreen++;
            }
          }
        }
      }
    }

    expect(polarLand).toBeGreaterThan(100);
    expect(tempLand).toBeGreaterThan(100);
    const polarGreenRatio = polarGreen / polarLand;
    const tempGreenRatio = tempGreen / tempLand;
    // Polar regions should have significantly less green vegetation than temperate regions (< 15%)
    expect(polarGreenRatio).toBeLessThan(0.15);
    expect(tempGreenRatio).toBeGreaterThan(polarGreenRatio * 2);
  });

  it('adjusts temperature, rainfall, and foliage biomes from baseTempC (0°C ice to 50°C extreme, default 10°C)', () => {
    expect(DEFAULT_WORLD_GEN_OPTIONS.baseTempC).toBe(10);

    const spanZ = WORLD_L0_CHUNKS_Z * CHUNK_SIZE * 19683;
    const eqZ = spanZ * 0.5;
    expect(computeSeasonalWarmth(eqZ, 0, 0, 0)).toBeLessThan(computeSeasonalWarmth(eqZ, 0, 0, 10));
    expect(computeSeasonalWarmth(eqZ, 0, 0, 50)).toBeGreaterThan(computeSeasonalWarmth(eqZ, 0, 0, 10));

    const iceWorld = generateStarterWorld('BASE-TEMP-TEST', { waterAmount: 50, greenery: 75, baseTempC: 0 });
    const defaultWorld = generateStarterWorld('BASE-TEMP-TEST', { waterAmount: 50, greenery: 75, baseTempC: 10 });
    const extremeWorld = generateStarterWorld('BASE-TEMP-TEST', { waterAmount: 50, greenery: 75, baseTempC: 50 });

    const countStats = (tree: typeof iceWorld.chunkTree) => {
      let land = 0;
      let snow = 0;
      let green = 0;
      let desert = 0;
      let rainSum = 0;
      for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
        for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
          const c = tree.getChunk(0, cx, cz);
          if (!c) continue;
          for (let i = 0; i < c.biomes.length; i++) {
            if (c.heights[i] <= 1000) continue;
            land++;
            rainSum += c.rainfall[i];
            const b = c.biomes[i];
            if (b === 7) snow++;
            else if (b === 1 || b === 2 || b === 5 || b === 6) green++;
            else if (b === 4) desert++;
          }
        }
      }
      return { land, snowRatio: snow / land, greenRatio: green / land, desertRatio: desert / land, avgRain: rainSum / land };
    };

    const iceStats = countStats(iceWorld.chunkTree);
    const defStats = countStats(defaultWorld.chunkTree);
    const extStats = countStats(extremeWorld.chunkTree);

    expect(iceStats.snowRatio).toBeGreaterThan(defStats.snowRatio);
    expect(iceStats.greenRatio).toBeLessThan(defStats.greenRatio);
    expect(iceStats.avgRain).toBeLessThan(defStats.avgRain);
    expect(extStats.snowRatio).toBeLessThan(defStats.snowRatio);
    expect(extStats.desertRatio).toBeGreaterThan(defStats.desertRatio);
  });
});
