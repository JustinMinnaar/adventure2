import { describe, it, expect } from 'vitest';
import {
  QWorldChunkTree,
  CHUNK_SIZE,
  WORLD_L0_CHUNKS_X,
  WORLD_L0_CHUNKS_Z,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from '../core/QWorldChunkTree';
import { WATER_OCEAN } from '../core/QWorldWaterFlood';
import {
  ATMOS_NX,
  ATMOS_NZ,
  computeAtmosphereField,
  sampleAtmosByteAtWorld,
  sampleAtmosFloatAtWorld,
  applyAtmosphereToWorldChunks,
} from '../core/QWorldAtmosphere';
import {
  VolcanoSource,
  computeVolcanicFallout,
  sampleVolcanicSkyAtLatLon,
  packSkyVeilSyncGrid,
  sampleSyncedVolcanicSky,
} from '../core/QWorldVolcanicFallout';
import { generateStarterWorld } from '../core/QWorldStarterGenerator';
import { computeFoliagePropAppearance, QWorldTerrainMesh } from '../core/QWorldTerrainMesh';

function createOceanPlanet(seaLevel = 1000): QWorldChunkTree {
  const tree = new QWorldChunkTree();
  for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
      const chunk = tree.getOrCreateChunk(0, cx, cz);
      chunk.heights.fill(seaLevel - 300);
      chunk.waterFlags.fill(WATER_OCEAN);
      chunk.biomes.fill(4);
      chunk.rainfall.fill(128);
    }
  }
  return tree;
}

function addContinentalLandWithOptionalWall(
  tree: QWorldChunkTree,
  seaLevel: number,
  includeMountainWall: boolean
): void {
  const spacing = tree.getSampleSpacing(0);
  for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
      const chunk = tree.getOrCreateChunk(0, cx, cz);
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = (cz * CHUNK_SIZE + lz) * spacing;
        const latDeg = 90 - (wz / WORLD_SPAN_Z) * 180;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = (cx * CHUNK_SIZE + lx) * spacing;
          const lonDeg = (wx / WORLD_SPAN_X) * 360 - 180;
          const idx = lz * CHUNK_SIZE + lx;

          // Broad supercontinent spanning -80°..+80° lon and -55°S..+65°N lat
          if (lonDeg >= -80 && lonDeg <= 80 && latDeg >= -55 && latDeg <= 65) {
            let h = seaLevel + 180;
            // East-west mountain barrier between North and South around +4°N..+10°N
            if (includeMountainWall && latDeg >= 4 && latDeg <= 10) {
              h = seaLevel + 3200;
              chunk.biomes[idx] = 3;
            } else {
              chunk.biomes[idx] = 2; // Forest
            }
            chunk.heights[idx] = h;
            chunk.waterFlags[idx] = 0;
          }
        }
      }
    }
  }
}

function latLonToWorld(latDeg: number, lonDeg: number): { x: number; z: number } {
  const x = ((lonDeg + 180) / 360) * WORLD_SPAN_X;
  const z = ((90 - latDeg) / 180) * WORLD_SPAN_Z;
  return { x, z };
}

describe('QWorldAtmosphere & QWorldVolcanicFallout', () => {
  it('computes realistic high-altitude planetary wind bands (trades, westerly jets, polar easterlies)', () => {
    const tree = createOceanPlanet(1000);
    const atmos = computeAtmosphereField(tree, {
      seaLevel: 1000,
      solarDeclinationDeg: 0,
      baseTempC: 15,
    });

    expect(atmos.nx).toBe(ATMOS_NX);
    expect(atmos.nz).toBe(ATMOS_NZ);

    // Sample Trade Winds at 15°N (should blow westward: u < 0, and equatorward/southward: v > 0)
    const tradeN = latLonToWorld(15, 0);
    const tradeU = sampleAtmosFloatAtWorld(atmos.highWindU, tradeN.x, tradeN.z);
    const tradeV = sampleAtmosFloatAtWorld(atmos.lowWindV, tradeN.x, tradeN.z);
    expect(tradeU).toBeLessThan(-3);
    expect(tradeV).toBeGreaterThan(0.5);

    // Sample Northern Jet Stream at 45°N (strong eastward westerlies: u > 12)
    const jetN = latLonToWorld(45, 0);
    const jetU = sampleAtmosFloatAtWorld(atmos.highWindU, jetN.x, jetN.z);
    expect(jetU).toBeGreaterThan(12);

    // Sample Polar Easterlies at 75°N (blow westward: u < 0, pushing cold air southward: v > 0)
    const polarN = latLonToWorld(75, 0);
    const polarU = sampleAtmosFloatAtWorld(atmos.highWindU, polarN.x, polarN.z);
    const polarLowV = sampleAtmosFloatAtWorld(atmos.lowWindV, polarN.x, polarN.z);
    expect(polarU).toBeLessThan(-2);
    expect(polarLowV).toBeGreaterThan(0.5);
  });

  it('deflects low-altitude wind against high mountain ranges', () => {
    const seaLevel = 1000;
    const flatTree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(flatTree, seaLevel, false);

    const walledTree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(walledTree, seaLevel, true);

    const flatAtmos = computeAtmosphereField(flatTree, {
      seaLevel,
      solarDeclinationDeg: 0,
      baseTempC: 14,
    });
    const walledAtmos = computeAtmosphereField(walledTree, {
      seaLevel,
      solarDeclinationDeg: 0,
      baseTempC: 14,
    });

    // At the mountain crest (+7°N, 0°E), southward cross-ridge flow (lowWindV) must be strongly attenuated
    const crest = latLonToWorld(7, 0);
    const flatV = Math.abs(sampleAtmosFloatAtWorld(flatAtmos.lowWindV, crest.x, crest.z));
    const walledV = Math.abs(sampleAtmosFloatAtWorld(walledAtmos.lowWindV, crest.x, crest.z));
    expect(walledV).toBeLessThan(flatV * 0.45);
  });

  it('concentrates hurricane risk over warm tropical oceans (8°–24° lat) rather than equator or poles', () => {
    const tree = createOceanPlanet(1000);
    const atmos = computeAtmosphereField(tree, {
      seaLevel: 1000,
      solarDeclinationDeg: 15, // Northern summer warms northern subtropics
      baseTempC: 18,
    });

    const tropicOcean = latLonToWorld(16, -30);
    const equatorOcean = latLonToWorld(0, -30);
    const polarOcean = latLonToWorld(75, -30);

    const tropicHurricane = sampleAtmosByteAtWorld(atmos.hurricaneRisk, tropicOcean.x, tropicOcean.z);
    const equatorHurricane = sampleAtmosByteAtWorld(atmos.hurricaneRisk, equatorOcean.x, equatorOcean.z);
    const polarHurricane = sampleAtmosByteAtWorld(atmos.hurricaneRisk, polarOcean.x, polarOcean.z);

    expect(tropicHurricane).toBeGreaterThan(100);
    expect(equatorHurricane).toBeLessThan(35); // Zero Coriolis spin on the equator
    expect(polarHurricane).toBeLessThan(15); // Too cold for tropical cyclogenesis
  });

  it('blocks Northern volcanic fallout at an East-West mountain range, piling ash on north slopes and sparing the South', () => {
    const seaLevel = 1000;
    const unblockedTree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(unblockedTree, seaLevel, false);

    const blockedTree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(blockedTree, seaLevel, true);

    const volcanoPos = latLonToWorld(22, -15);
    const volcanoes: VolcanoSource[] = [
      {
        id: 'volcano-north-1',
        name: 'Mount Doomfire',
        x: volcanoPos.x,
        z: volcanoPos.z,
        magnitude: 8,
        active: true,
      },
    ];

    const unblockedAtmos = computeAtmosphereField(unblockedTree, {
      seaLevel,
      solarDeclinationDeg: 0,
      baseTempC: 12,
    });
    const unblockedFallout = computeVolcanicFallout(unblockedAtmos, volcanoes);

    const blockedAtmos = computeAtmosphereField(blockedTree, {
      seaLevel,
      solarDeclinationDeg: 0,
      baseTempC: 12,
    });
    const blockedFallout = computeVolcanicFallout(blockedAtmos, volcanoes);

    // 1. Heavy fallout in the Northern Hemisphere near and downwind of the volcano
    const northHeartland = latLonToWorld(24, 5);
    const northAsh = sampleAtmosByteAtWorld(blockedFallout.ashFallout, northHeartland.x, northHeartland.z);
    expect(northAsh).toBeGreaterThan(90);

    // 2. Heavy orographic pile-up right on the northern windward face of the mountains (+11°N)
    const northSlope = latLonToWorld(11, -10);
    const northSlopeAsh = sampleAtmosByteAtWorld(blockedFallout.ashFallout, northSlope.x, northSlope.z);
    expect(northSlopeAsh).toBeGreaterThan(70);

    // 3. Southern sanctuary (-8°S and -22°S) has dramatically less ash with the mountain wall than without, and stays clean
    const southNear = latLonToWorld(-2, -10);
    const southSanctuary = latLonToWorld(-18, -10);
    const unblockedSouthNear = sampleAtmosByteAtWorld(unblockedFallout.ashFallout, southNear.x, southNear.z);
    const blockedSouthNear = sampleAtmosByteAtWorld(blockedFallout.ashFallout, southNear.x, southNear.z);
    const blockedSouthSanctuary = sampleAtmosByteAtWorld(
      blockedFallout.ashFallout,
      southSanctuary.x,
      southSanctuary.z
    );

    expect(blockedSouthNear).toBeLessThan(unblockedSouthNear * 0.35);
    expect(blockedSouthSanctuary).toBeLessThan(10);
  });

  it('computes sky-preview volcanic haze in the North and clear southern skies with northern horizon glow', () => {
    const seaLevel = 1000;
    const tree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(tree, seaLevel, true);

    const volcanoPos = latLonToWorld(24, 0);
    const volcanoes: VolcanoSource[] = [
      {
        id: 'v1',
        name: 'Cataclysm Peak',
        x: volcanoPos.x,
        z: volcanoPos.z,
        magnitude: 8,
        active: true,
      },
    ];

    const atmos = computeAtmosphereField(tree, { seaLevel, solarDeclinationDeg: 0, baseTempC: 12 });
    const fallout = computeVolcanicFallout(atmos, volcanoes);

    const northSky = sampleVolcanicSkyAtLatLon(fallout, volcanoes, 24, 10);
    const southNearWallSky = sampleVolcanicSkyAtLatLon(fallout, volcanoes, -4, 0);

    expect(northSky.overheadVeil).toBeGreaterThan(0.45);
    expect(southNearWallSky.overheadVeil).toBeLessThan(0.15);
    expect(southNearWallSky.horizonGlowStrength).toBeGreaterThan(0.12);
    // From (-4°S, 0°E), looking toward volcano at (+24°N, 0°E) is due North (~0° / 360° azimuth)
    const azDistFromNorth = Math.min(
      southNearWallSky.horizonGlowAzimuthDeg,
      360 - southNearWallSky.horizonGlowAzimuthDeg
    );
    expect(azDistFromNorth).toBeLessThan(25);
  });

  it('applies atmospheric moisture, rain shadow, and heavy ash devastation to world chunks', () => {
    const seaLevel = 1000;
    const tree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(tree, seaLevel, true);

    const volcanoPos = latLonToWorld(22, 0);
    const volcanoes: VolcanoSource[] = [
      {
        id: 'v1',
        name: 'Mount Cinder',
        x: volcanoPos.x,
        z: volcanoPos.z,
        magnitude: 8,
        active: true,
      },
    ];

    const atmos = computeAtmosphereField(tree, { seaLevel, solarDeclinationDeg: 0, baseTempC: 12 });
    const fallout = computeVolcanicFallout(atmos, volcanoes);

    applyAtmosphereToWorldChunks(tree, atmos, fallout, {
      seaLevel,
      baseTempC: 12,
      applyAshBiomeDevastation: true,
    });

    // Near the erupting northern volcano, forest biome (2) should be devastated into barren rock/ash (3)
    const devastatedBiome = tree.getBiomeAt(0, volcanoPos.x, volcanoPos.z);
    expect(devastatedBiome).toBe(3);

    // Sheltered southern land (-20°S, 0°E) remains living vegetation (not devastated rock)
    const southPt = latLonToWorld(-20, 0);
    const southBiome = tree.getBiomeAt(0, southPt.x, southPt.z);
    expect([1, 2, 5, 6]).toContain(southBiome);
  });

  it('meets real-time performance budget (< 50 ms for full planet wind + storm + volcanic fallout)', () => {
    const seaLevel = 1000;
    const tree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(tree, seaLevel, true);
    const volcanoPos = latLonToWorld(25, -10);
    const volcanoes: VolcanoSource[] = [
      { id: 'v1', name: 'Peak 1', x: volcanoPos.x, z: volcanoPos.z, magnitude: 8, active: true },
    ];

    // Warm-up JIT
    const warmAtmos = computeAtmosphereField(tree, { seaLevel, solarDeclinationDeg: 0, baseTempC: 12 });
    computeVolcanicFallout(warmAtmos, volcanoes);

    const t0 = performance.now();
    const atmos = computeAtmosphereField(tree, { seaLevel, solarDeclinationDeg: 8, baseTempC: 12 });
    const fallout = computeVolcanicFallout(atmos, volcanoes);
    const durationMs = performance.now() - t0;

    expect(fallout.ashFallout.length).toBe(ATMOS_NX * ATMOS_NZ);
    expect(durationMs).toBeLessThan(50);
  });

  it('generates configured volcano markers along raised mountain faults during world generation', () => {
    const worldZero = generateStarterWorld('VOLCANO_SEED_A', { volcanoCount: 0 });
    const zeroVolcanoes = worldZero.vectorTree
      .getAllMarkers()
      .filter((m) => m.category === 'volcano');
    expect(zeroVolcanoes.length).toBe(0);

    const worldFour = generateStarterWorld('VOLCANO_SEED_A', {
      volcanoCount: 4,
      mountainIntensity: 70,
    });
    const volcanoes = worldFour.vectorTree
      .getAllMarkers()
      .filter((m) => m.category === 'volcano');
    expect(volcanoes.length).toBe(4);
    for (const v of volcanoes) {
      const h = worldFour.chunkTree.getHeightAt(0, v.x, v.z);
      expect(h).toBeGreaterThan(worldFour.seaLevel + 200);
      expect(v.eruptionMagnitude).toBeGreaterThanOrEqual(5);
    }
  });

  it('shades ash-covered terrain & chars people-scale 3D foliage under heavy volcanic fallout', () => {
    const healthyTree = computeFoliagePropAppearance(2, WORLD_SPAN_Z * 0.7, 100, 0, 12, 0);
    const ashChokedTree = computeFoliagePropAppearance(2, WORLD_SPAN_Z * 0.3, 100, 0, 12, 0.85);

    expect(healthyTree.g).toBeGreaterThan(healthyTree.r * 2);
    // Heavy ash desaturates green canopy into charred ash-grey and shrinks foliage scale
    expect(Math.abs(ashChokedTree.g - ashChokedTree.r)).toBeLessThan(0.06);
    expect(ashChokedTree.scaleMul).toBeLessThan(healthyTree.scaleMul * 0.8);

    const seaLevel = 1000;
    const tree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(tree, seaLevel, false);
    const meshBuilder = new QWorldTerrainMesh(tree);

    const cleanBuf = meshBuilder.buildChunkBuffers(0, 4, 1, 'normal', false, 0, seaLevel, 12);
    const ashGrid = new Uint8Array(ATMOS_NX * ATMOS_NZ);
    ashGrid.fill(230);
    meshBuilder.setAtmosphereOverlays(ashGrid, ashGrid);
    const ashBuf = meshBuilder.buildChunkBuffers(0, 4, 1, 'normal', false, 0, seaLevel, 12);

    // Pick center vertex of chunk (4, 1) which is continental forest in Northern Hemisphere
    const centerIdx = (40 * 82 + 40) * 3;
    expect(cleanBuf.colors[centerIdx + 1]).toBeGreaterThan(cleanBuf.colors[centerIdx] * 1.4);
    expect(ashBuf.colors[centerIdx + 1]).toBeLessThan(cleanBuf.colors[centerIdx + 1] * 0.75);
  });

  it('packs and samples synced volcanic sky veil & northern horizon glow for Sky Preview', () => {
    const seaLevel = 1000;
    const tree = createOceanPlanet(seaLevel);
    addContinentalLandWithOptionalWall(tree, seaLevel, true);

    const volcanoPos = latLonToWorld(24, 0);
    const volcanoes: VolcanoSource[] = [
      { id: 'v1', name: 'Ash Crown', x: volcanoPos.x, z: volcanoPos.z, magnitude: 8, active: true },
    ];
    const atmos = computeAtmosphereField(tree, { seaLevel, solarDeclinationDeg: 0, baseTempC: 12 });
    const fallout = computeVolcanicFallout(atmos, volcanoes);
    const packed = packSkyVeilSyncGrid(fallout.skyVeil);

    const syncPayload = {
      veilGrid36x18: packed,
      activeVolcanoes: [{ name: 'Ash Crown', magnitude: 8, latitudeDeg: 24, longitudeDeg: 0 }],
    };

    const northSynced = sampleSyncedVolcanicSky(syncPayload, 24, 10);
    const southSynced = sampleSyncedVolcanicSky(syncPayload, -6, 0);

    expect(northSynced.overheadVeil).toBeGreaterThan(0.4);
    expect(southSynced.overheadVeil).toBeLessThan(0.15);
    expect(southSynced.horizonGlowStrength).toBeGreaterThan(0.12);
    expect(Math.min(southSynced.horizonGlowAzimuthDeg, 360 - southSynced.horizonGlowAzimuthDeg)).toBeLessThan(25);
  });
});
