import {
  QWorldChunkTree,
  CHUNK_SIZE,
  WORLD_L0_CHUNKS_X,
  WORLD_L0_CHUNKS_Z,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from './QWorldChunkTree';
import { WATER_OCEAN } from './QWorldWaterFlood';
import type { VolcanicFalloutResult } from './QWorldVolcanicFallout';

export const ATMOS_NX = 216; // Exact 1/3 of 648 L0 x-samples (1.667° lon per cell)
export const ATMOS_NZ = 108; // Exact 1/3 of 324 L0 z-samples (1.667° lat per cell)
export const ATMOS_AREA = ATMOS_NX * ATMOS_NZ;

const DEG_TO_RAD = Math.PI / 180;

export interface AtmosphereOptions {
  seaLevel: number;
  solarDeclinationDeg: number;
  baseTempC: number;
}

export interface AtmosphereField {
  nx: number;
  nz: number;
  seaLevel: number;
  solarDeclinationDeg: number;
  baseTempC: number;
  ridgeHeights: Float32Array;
  meanHeights: Float32Array;
  oceanMask: Uint8Array;
  highWindU: Float32Array;
  highWindV: Float32Array;
  lowWindU: Float32Array;
  lowWindV: Float32Array;
  airTempAnomaly: Float32Array;
  effectiveWarmth: Float32Array;
  hurricaneRisk: Uint8Array;
  stormRisk: Uint8Array;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function wrapAtmosX(ax: number): number {
  return ((ax % ATMOS_NX) + ATMOS_NX) % ATMOS_NX;
}

function extractTerrainSummary(
  tree: QWorldChunkTree,
  seaLevel: number,
  ridgeHeights: Float32Array,
  meanHeights: Float32Array,
  oceanMask: Uint8Array
): void {
  for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
      const chunk = tree.getChunk(0, cx, cz);
      for (let bz = 0; bz < CHUNK_SIZE / 3; bz++) {
        const az = cz * (CHUNK_SIZE / 3) + bz;
        for (let bx = 0; bx < CHUNK_SIZE / 3; bx++) {
          const ax = cx * (CHUNK_SIZE / 3) + bx;
          const idx = az * ATMOS_NX + ax;
          if (!chunk) {
            ridgeHeights[idx] = 0;
            meanHeights[idx] = 0;
            oceanMask[idx] = 1;
            continue;
          }
          let maxAbove = 0;
          let sumAbove = 0;
          let oceanCount = 0;
          for (let dz = 0; dz < 3; dz++) {
            const rowOff = (bz * 3 + dz) * CHUNK_SIZE + bx * 3;
            for (let dx = 0; dx < 3; dx++) {
              const sIdx = rowOff + dx;
              const above = chunk.heights[sIdx] - seaLevel;
              if (above > maxAbove) maxAbove = above;
              sumAbove += above;
              if (chunk.waterFlags[sIdx] === WATER_OCEAN) oceanCount++;
            }
          }
          ridgeHeights[idx] = maxAbove;
          meanHeights[idx] = sumAbove / 9;
          oceanMask[idx] = oceanCount >= 5 ? 1 : 0;
        }
      }
    }
  }
}

function computeBaseZonalWinds(
  relLatDeg: number
): { highU: number; highV: number; lowU: number; lowV: number } {
  const absLat = Math.abs(relLatDeg);
  const eqSign = relLatDeg >= 0 ? 1 : -1; // +Z is Southward (equatorward when in North)
  let highU = 0;
  if (absLat < 23) {
    highU = -11.5 * Math.sin((absLat / 23) * Math.PI * 0.88) - 1.5;
  } else if (absLat < 62) {
    highU = 28.0 * Math.sin(((absLat - 23) / 39) * Math.PI);
  } else {
    highU = -9.5 * Math.sin(((absLat - 62) / 28) * Math.PI * 0.9) - 1.5;
  }

  let lowU = 0;
  let lowV = 0;
  if (absLat < 30) {
    const s = Math.sin((absLat / 30) * Math.PI);
    lowU = -9.5 * s;
    lowV = 5.2 * eqSign * s;
  } else if (absLat < 60) {
    const s = Math.sin(((absLat - 30) / 30) * Math.PI);
    lowU = 11.5 * s;
    lowV = -3.0 * eqSign * s;
  } else {
    const s = Math.sin(((absLat - 60) / 30) * Math.PI * 0.92);
    lowU = -6.8 * s - 1.0;
    lowV = 4.4 * eqSign * s;
  }
  const highV = absLat > 24 && absLat < 64 ? -1.4 * eqSign : 0.6 * eqSign;
  return { highU, highV, lowU, lowV };
}

function populateWindGrids(
  ridgeHeights: Float32Array,
  solarDeclinationDeg: number,
  highWindU: Float32Array,
  highWindV: Float32Array,
  lowWindU: Float32Array,
  lowWindV: Float32Array
): void {
  const itczLat = solarDeclinationDeg * 0.45;
  const rossbyLon = new Float32Array(ATMOS_NX);
  for (let ax = 0; ax < ATMOS_NX; ax++) {
    const lonRad = ((ax + 0.5) / ATMOS_NX) * Math.PI * 2;
    rossbyLon[ax] = Math.sin(lonRad * 3 + solarDeclinationDeg * 0.05);
  }

  for (let az = 0; az < ATMOS_NZ; az++) {
    const latDeg = 90 - ((az + 0.5) / ATMOS_NZ) * 180;
    const base = computeBaseZonalWinds(latDeg - itczLat);
    const waveAmp = Math.abs(latDeg) > 22 && Math.abs(latDeg) < 68 ? 2.6 : 0.7;
    const zUp = Math.max(0, az - 1);
    const zDn = Math.min(ATMOS_NZ - 1, az + 1);
    const rowOff = az * ATMOS_NX;

    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = rowOff + ax;
      const rossby = rossbyLon[ax] * waveAmp;
      highWindU[idx] = base.highU;
      highWindV[idx] = base.highV + rossby;

      const xL = ax > 0 ? ax - 1 : ATMOS_NX - 1;
      const xR = ax < ATMOS_NX - 1 ? ax + 1 : 0;
      const dhdx = (ridgeHeights[rowOff + xR] - ridgeHeights[rowOff + xL]) * 0.5;
      const dhdz = (ridgeHeights[zDn * ATMOS_NX + ax] - ridgeHeights[zUp * ATMOS_NX + ax]) * 0.5;

      let u = base.lowU;
      let v = base.lowV + rossby * 0.45;
      const ridge = ridgeHeights[idx];
      const gradSq = dhdx * dhdx + dhdz * dhdz;
      if (gradSq > 625) {
        const gradLen = Math.sqrt(gradSq);
        const nx = dhdx / gradLen;
        const nz = dhdz / gradLen;
        const uphill = u * nx + v * nz;
        if (uphill > 0) {
          const deflect = clamp01(Math.max(ridge, gradLen * 2) / 1800) * 0.82;
          u -= uphill * nx * deflect;
          v -= uphill * nz * deflect;
          const tangentSign = u * -nz + v * nx >= 0 ? 1 : -1;
          u += -nz * uphill * deflect * 0.55 * tangentSign;
          v += nx * uphill * deflect * 0.55 * tangentSign;
        }
      }
      const barrierBlock = clamp01(ridge / 2100);
      const atten = 1 / (1 + 4.8 * barrierBlock * barrierBlock);
      lowWindU[idx] = u * (0.45 + 0.55 * atten);
      lowWindV[idx] = v * atten;
    }
  }
}

function computeThermalAndStorms(
  meanHeights: Float32Array,
  ridgeHeights: Float32Array,
  oceanMask: Uint8Array,
  lowWindU: Float32Array,
  lowWindV: Float32Array,
  opts: AtmosphereOptions,
  airTempAnomaly: Float32Array,
  effectiveWarmth: Float32Array,
  hurricaneRisk: Uint8Array,
  stormRisk: Uint8Array
): void {
  const localWarmth = new Float32Array(ATMOS_AREA);
  const declRad = opts.solarDeclinationDeg * DEG_TO_RAD;
  const tempOffset = (opts.baseTempC - 10) * 0.025;

  for (let az = 0; az < ATMOS_NZ; az++) {
    const latRad = (0.5 - (az + 0.5) / ATMOS_NZ) * Math.PI;
    const solar = Math.pow(Math.max(0, Math.cos(latRad - declRad)), 1.35);
    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = az * ATMOS_NX + ax;
      const elevCool = Math.max(0, meanHeights[idx]) * 0.00035;
      localWarmth[idx] = solar + tempOffset - elevCool;
    }
  }

  for (let az = 0; az < ATMOS_NZ; az++) {
    const latDeg = 90 - ((az + 0.5) / ATMOS_NZ) * 180;
    const absLat = Math.abs(latDeg);
    const coriolis = clamp01((absLat - 4.5) / 6.5) * clamp01((31 - absLat) / 9);
    const zUp = Math.max(0, az - 1);
    const zDn = Math.min(ATMOS_NZ - 1, az + 1);

    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = az * ATMOS_NX + ax;
      const upX = wrapAtmosX(Math.round(ax - lowWindU[idx] * 0.35));
      const upZ = clamp(Math.round(az - lowWindV[idx] * 0.35), 0, ATMOS_NZ - 1);
      const advected = localWarmth[upZ * ATMOS_NX + upX] - localWarmth[idx];
      const anomaly = clamp(advected * 2.2, -1, 1);
      airTempAnomaly[idx] = anomaly;
      const warmth = localWarmth[idx] + advected * 0.45;
      effectiveWarmth[idx] = warmth;

      const xL = wrapAtmosX(ax - 1);
      const xR = wrapAtmosX(ax + 1);
      const nearOcean =
        oceanMask[idx] || oceanMask[az * ATMOS_NX + xL] || oceanMask[az * ATMOS_NX + xR];
      const seaFactor = oceanMask[idx] ? 1.0 : nearOcean && ridgeHeights[idx] < 450 ? 0.65 : 0;
      const warmSea = clamp01((warmth - 0.64) / 0.28);
      const hRisk = clamp01(seaFactor * coriolis * warmSea * 1.15);
      hurricaneRisk[idx] = Math.round(hRisk * 255);

      const dWarmZ = Math.abs(localWarmth[zDn * ATMOS_NX + ax] - localWarmth[zUp * ATMOS_NX + ax]);
      const frontRisk = clamp01((dWarmZ * 6.5 + Math.abs(anomaly) * 0.45) * (nearOcean ? 1.0 : 0.68));
      stormRisk[idx] = Math.round(Math.max(hRisk, frontRisk * 0.88) * 255);
    }
  }
}

export function computeAtmosphereField(
  tree: QWorldChunkTree,
  options: AtmosphereOptions
): AtmosphereField {
  const ridgeHeights = new Float32Array(ATMOS_AREA);
  const meanHeights = new Float32Array(ATMOS_AREA);
  const oceanMask = new Uint8Array(ATMOS_AREA);
  const highWindU = new Float32Array(ATMOS_AREA);
  const highWindV = new Float32Array(ATMOS_AREA);
  const lowWindU = new Float32Array(ATMOS_AREA);
  const lowWindV = new Float32Array(ATMOS_AREA);
  const airTempAnomaly = new Float32Array(ATMOS_AREA);
  const effectiveWarmth = new Float32Array(ATMOS_AREA);
  const hurricaneRisk = new Uint8Array(ATMOS_AREA);
  const stormRisk = new Uint8Array(ATMOS_AREA);

  extractTerrainSummary(tree, options.seaLevel, ridgeHeights, meanHeights, oceanMask);
  populateWindGrids(ridgeHeights, options.solarDeclinationDeg, highWindU, highWindV, lowWindU, lowWindV);
  computeThermalAndStorms(
    meanHeights,
    ridgeHeights,
    oceanMask,
    lowWindU,
    lowWindV,
    options,
    airTempAnomaly,
    effectiveWarmth,
    hurricaneRisk,
    stormRisk
  );

  return {
    nx: ATMOS_NX,
    nz: ATMOS_NZ,
    seaLevel: options.seaLevel,
    solarDeclinationDeg: options.solarDeclinationDeg,
    baseTempC: options.baseTempC,
    ridgeHeights,
    meanHeights,
    oceanMask,
    highWindU,
    highWindV,
    lowWindU,
    lowWindV,
    airTempAnomaly,
    effectiveWarmth,
    hurricaneRisk,
    stormRisk,
  };
}

export function sampleAtmosFloatAtWorld(
  grid: Float32Array,
  worldX: number,
  worldZ: number
): number {
  const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
  const clampedZ = clamp(worldZ, 0, WORLD_SPAN_Z - 1);
  const gx = (wrappedX / WORLD_SPAN_X) * ATMOS_NX - 0.5;
  const gz = (clampedZ / WORLD_SPAN_Z) * ATMOS_NZ - 0.5;
  const x0 = Math.floor(gx);
  const z0 = clamp(Math.floor(gz), 0, ATMOS_NZ - 1);
  const z1 = clamp(z0 + 1, 0, ATMOS_NZ - 1);
  const fx = gx - x0;
  const fz = clamp01(gz - Math.floor(gz));
  const wx0 = wrapAtmosX(x0);
  const wx1 = wrapAtmosX(x0 + 1);

  const v00 = grid[z0 * ATMOS_NX + wx0];
  const v10 = grid[z0 * ATMOS_NX + wx1];
  const v01 = grid[z1 * ATMOS_NX + wx0];
  const v11 = grid[z1 * ATMOS_NX + wx1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fz;
}

export function sampleAtmosByteAtWorld(
  grid: Uint8Array,
  worldX: number,
  worldZ: number
): number {
  const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
  const clampedZ = clamp(worldZ, 0, WORLD_SPAN_Z - 1);
  const gx = (wrappedX / WORLD_SPAN_X) * ATMOS_NX - 0.5;
  const gz = (clampedZ / WORLD_SPAN_Z) * ATMOS_NZ - 0.5;
  const x0 = Math.floor(gx);
  const z0 = clamp(Math.floor(gz), 0, ATMOS_NZ - 1);
  const z1 = clamp(z0 + 1, 0, ATMOS_NZ - 1);
  const fx = gx - x0;
  const fz = clamp01(gz - Math.floor(gz));
  const wx0 = wrapAtmosX(x0);
  const wx1 = wrapAtmosX(x0 + 1);

  const v00 = grid[z0 * ATMOS_NX + wx0];
  const v10 = grid[z0 * ATMOS_NX + wx1];
  const v01 = grid[z1 * ATMOS_NX + wx0];
  const v11 = grid[z1 * ATMOS_NX + wx1];
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fz;
}

function classifyBiomeFromClimate(
  aboveSea: number,
  temperature: number,
  rainByte: number,
  ashByte: number,
  applyAshDevastation: boolean
): number {
  if (aboveSea <= 0) return aboveSea < -220 ? 3 : 4;
  if (applyAshDevastation && ashByte >= 115) return 3; // Heavy volcanic ash buries vegetation into barren rock/ash
  if (temperature < 0.22 && aboveSea > 15) return 7;
  if (aboveSea <= 22) return 4;
  if (aboveSea > 920) return 7;
  if (aboveSea > 420) return 3;
  if (applyAshDevastation && ashByte >= 65) return 1; // Moderate ash degrades forest into sparse scrub grass
  if (temperature < 0.38) return rainByte >= 180 && temperature > 0.32 ? 2 : 3;
  if ((rainByte < 78 && temperature > 0.50) || (rainByte < 120 && temperature > 0.95)) return 4;
  if (rainByte < 78) return temperature < 0.44 ? 3 : 1;
  if (rainByte < 135) return 1;
  if (rainByte < 195 || temperature <= 0.78) return 2;
  return aboveSea < 75 ? 5 : 6;
}

export function applyAtmosphereToWorldChunks(
  tree: QWorldChunkTree,
  atmos: AtmosphereField,
  fallout: VolcanicFalloutResult | null,
  options: { seaLevel: number; baseTempC: number; applyAshBiomeDevastation: boolean }
): void {
  const spacing = tree.getSampleSpacing(0);
  for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
      const chunk = tree.getChunk(0, cx, cz);
      if (!chunk) continue;
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = (cz * CHUNK_SIZE + lz) * spacing;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = (cx * CHUNK_SIZE + lx) * spacing;
          const idx = lz * CHUNK_SIZE + lx;
          const aboveSea = chunk.heights[idx] - options.seaLevel;
          const storm = sampleAtmosByteAtWorld(atmos.stormRisk, wx, wz) / 255;
          const warmth = sampleAtmosFloatAtWorld(atmos.effectiveWarmth, wx, wz);
          const veilNorm = fallout ? sampleAtmosByteAtWorld(fallout.skyVeil, wx, wz) / 255 : 0;
          const ashByte = fallout ? sampleAtmosByteAtWorld(fallout.ashFallout, wx, wz) : 0;
          const cooledTemp = warmth - veilNorm * 0.28;

          // Blend existing terrain rainfall with wind/storm moisture advection
          const nextRain = clamp(Math.round(chunk.rainfall[idx] * 0.62 + storm * 115), 0, 255);
          chunk.rainfall[idx] = nextRain;
          if (chunk.biomes[idx] !== 8) {
            chunk.biomes[idx] = classifyBiomeFromClimate(
              aboveSea,
              cooledTemp,
              nextRain,
              ashByte,
              options.applyAshBiomeDevastation
            );
          }
        }
      }
    }
  }
}
