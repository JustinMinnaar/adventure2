import * as THREE from 'three';
import { QWorldChunkTree, CHUNK_SIZE, CHUNK_AREA, WorldBounds, WORLD_SPAN_Z, WORLD_L0_CHUNKS_X } from './QWorldChunkTree';
import { WATER_OCEAN } from './QWorldWaterFlood';
import { sampleAtmosByteAtWorld } from './QWorldAtmosphere';

export type TerrainRenderMode = 'normal' | 'temp' | 'rain' | 'biomes' | 'biome' | 'heatmap';

export const ELEVATION_SCALE = 1.0; // 1 world unit = 1 yard vertically (matches X/Z yard scale)

export interface PropTransform {
  x: number;
  y: number;
  z: number;
  biomeId: number;
  scale: number;
}

const BIOME_COLORS: Record<number, [number, number, number]> = {
  0: [0.35, 0.55, 0.25], // Default plains/grass
  1: [0.42, 0.68, 0.28], // Grass
  2: [0.13, 0.42, 0.18], // Forest
  3: [0.48, 0.49, 0.52], // Rock / Mountain
  4: [0.85, 0.76, 0.52], // Sand / Desert
  5: [0.22, 0.36, 0.24], // Swamp / Marsh
  6: [0.08, 0.38, 0.15], // Jungle
  7: [0.92, 0.95, 0.98], // Snow
  8: [0.72, 0.65, 0.22], // Farmland
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  out: [number, number, number]
): void {
  const k = clamp01(t);
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

const DEG_TO_RAD = Math.PI / 180;

export function computePolarFactor(worldZ: number): number {
  const lat = ((worldZ / WORLD_SPAN_Z) - 0.5) * Math.PI;
  return Math.min(1, Math.abs(Math.sin(lat)));
}

/**
 * Computes seasonal solar warmth [~0..1] at `worldZ` and `height` for a given solar declination (-axialTilt..+axialTilt).
 * Positive declination (Northern Summer) shifts peak sunlight north; negative declination (Northern Winter) shifts it south.
 */
export function computeSeasonalWarmth(
  worldZ: number,
  height: number,
  solarDeclinationDeg: number = 0,
  baseTempC: number = 10
): number {
  const geoLatRad = (0.5 - worldZ / WORLD_SPAN_Z) * Math.PI;
  const declRad = solarDeclinationDeg * DEG_TO_RAD;
  const solarIncidence = Math.max(0, Math.cos(geoLatRad - declRad));
  const baseWarmth = Math.pow(solarIncidence, 1.35);
  const baseTempOffset = (baseTempC - 10) * 0.025;
  const elevCool = Math.max(0, height) * 0.00035;
  return baseWarmth + baseTempOffset - elevCool;
}

const SNOW_RGB: [number, number, number] = [0.92, 0.95, 0.98];
const WINTER_GRASS_RGB: [number, number, number] = [0.44, 0.41, 0.25];
const WINTER_FOREST_RGB: [number, number, number] = [0.14, 0.27, 0.19];
const DRY_SAVANNA_RGB: [number, number, number] = [0.72, 0.63, 0.34];
const DESERT_RGB: [number, number, number] = [0.85, 0.76, 0.52];
const SCORCHED_WOOD_RGB: [number, number, number] = [0.68, 0.54, 0.32];
const TUNDRA_ROCK_RGB: [number, number, number] = [0.44, 0.47, 0.36];

/**
 * Adjusts a biome's base RGB color for the current orbital solar declination (degrees), worldZ latitude, and elevation.
 * Writes into `out` to avoid per-vertex allocations in chunk mesh generation.
 */
export function applyClimateBiomeColor(
  biomeId: number,
  worldZ: number,
  height: number,
  solarDeclinationDeg: number,
  out: [number, number, number],
  baseTempC: number = 10
): void {
  const base = BIOME_COLORS[biomeId] ?? BIOME_COLORS[0];
  out[0] = base[0];
  out[1] = base[1];
  out[2] = base[2];

  if (Math.abs(solarDeclinationDeg) < 0.01) return;

  const seasonalWarmth = computeSeasonalWarmth(worldZ, height, solarDeclinationDeg, baseTempC);
  const equinoxWarmth = computeSeasonalWarmth(worldZ, height, 0, baseTempC);
  const seasonalDelta = seasonalWarmth - equinoxWarmth;
  const isFoliage = biomeId === 0 || biomeId === 1 || biomeId === 2 || biomeId === 5 || biomeId === 6 || biomeId === 8;

  if (seasonalDelta < 0) {
    // Hemisphere tilted away from Sun (Winter): foliage goes dormant and snow advances
    const winterStrength = clamp01(-seasonalDelta / 0.22);
    if (isFoliage) {
      const coolDormant = winterStrength * clamp01((0.72 - seasonalWarmth) / 0.45);
      const winterTarget = biomeId === 2 || biomeId === 6 ? WINTER_FOREST_RGB : WINTER_GRASS_RGB;
      lerpRgb(out, winterTarget, coolDormant * 0.85, out);
    }
    const snowBlend = clamp01((0.28 - seasonalWarmth) / 0.20) * clamp01(-seasonalDelta / 0.10);
    if (snowBlend > 0 && biomeId !== 7) {
      const strength = biomeId === 3 ? snowBlend * 0.8 : snowBlend;
      lerpRgb(out, SNOW_RGB, strength, out);
    }
    return;
  }

  // Hemisphere tilted toward Sun (Summer): snow melts to tundra; temperate foliage turns lush; extreme heat dries
  const summerStrength = clamp01(seasonalDelta / 0.22);
  if (biomeId === 7) {
    const meltBlend = clamp01((seasonalWarmth - 0.22) / 0.28) * summerStrength;
    lerpRgb(out, TUNDRA_ROCK_RGB, meltBlend, out);
    return;
  }

  if (isFoliage) {
    const summerLush = summerStrength * clamp01((0.78 - seasonalWarmth) / 0.40);
    if (summerLush > 0) {
      out[0] = Math.min(1, out[0] * (1 + 0.08 * summerLush));
      out[1] = Math.min(1, out[1] * (1 + 0.12 * summerLush));
    }
    const dryBlend = clamp01((seasonalWarmth - 0.88) / 0.25) * summerStrength;
    if (dryBlend > 0) {
      if (dryBlend < 0.5) {
        lerpRgb(out, DRY_SAVANNA_RGB, dryBlend * 2, out);
      } else {
        const aridTarget = biomeId === 2 || biomeId === 6 ? SCORCHED_WOOD_RGB : DESERT_RGB;
        lerpRgb(DRY_SAVANNA_RGB, aridTarget, (dryBlend - 0.5) * 2, out);
      }
    }
  }
}

export function getSeaLevelOffsetForTemp(_solarDeclinationDeg: number): number {
  return 0;
}

/**
 * Computes instanced 3D tree RGB color [0..1] and canopy scale multiplier for People-level (L7..L9) foliage.
 */
function applyAshToFoliageAppearance(
  out: [number, number, number],
  baseScaleMul: number,
  ashNorm: number
): { r: number; g: number; b: number; scaleMul: number } {
  if (ashNorm <= 0.06) {
    return { r: out[0], g: out[1], b: out[2], scaleMul: baseScaleMul };
  }
  const ashT = clamp01((ashNorm - 0.06) / 0.72);
  const charredAsh: [number, number, number] = [0.24, 0.23, 0.24];
  lerpRgb(out, charredAsh, ashT * 0.94, out);
  return {
    r: out[0],
    g: out[1],
    b: out[2],
    scaleMul: baseScaleMul * (1 - 0.44 * ashT),
  };
}

export function computeFoliagePropAppearance(
  biomeId: number,
  worldZ: number,
  height: number,
  solarDeclinationDeg: number,
  baseTempC: number = 10,
  ashNorm: number = 0
): { r: number; g: number; b: number; scaleMul: number } {
  const base: [number, number, number] =
    biomeId === 6 ? [0.06, 0.46, 0.24] : [0.09, 0.40, 0.20];
  if (Math.abs(solarDeclinationDeg) < 0.01) {
    const out: [number, number, number] = [base[0], base[1], base[2]];
    return applyAshToFoliageAppearance(out, 1, ashNorm);
  }

  const seasonalWarmth = computeSeasonalWarmth(worldZ, height, solarDeclinationDeg, baseTempC);
  const equinoxWarmth = computeSeasonalWarmth(worldZ, height, 0, baseTempC);
  const seasonalDelta = seasonalWarmth - equinoxWarmth;
  const out: [number, number, number] = [base[0], base[1], base[2]];

  if (seasonalDelta < 0) {
    const winterStrength = clamp01(-seasonalDelta / 0.22);
    const winterPine: [number, number, number] = [0.16, 0.28, 0.20];
    const coolDormant = winterStrength * clamp01((0.72 - seasonalWarmth) / 0.45);
    lerpRgb(out, winterPine, coolDormant * 0.85, out);
    const snowBlend = clamp01((0.28 - seasonalWarmth) / 0.20) * clamp01(-seasonalDelta / 0.10);
    lerpRgb(out, SNOW_RGB, snowBlend * 0.92, out);
    return applyAshToFoliageAppearance(out, 1, ashNorm);
  }

  const summerStrength = clamp01(seasonalDelta / 0.22);
  const summerGreen: [number, number, number] = [0.13, 0.55, 0.13];
  const summerBoost = summerStrength * clamp01((0.78 - seasonalWarmth) / 0.40);
  lerpRgb(out, summerGreen, summerBoost * 0.7, out);

  const dryBlend = clamp01((seasonalWarmth - 0.88) / 0.25) * summerStrength;
  if (dryBlend > 0) {
    if (dryBlend < 0.5) {
      lerpRgb(out, [0.58, 0.50, 0.22], dryBlend * 2, out);
    } else {
      lerpRgb([0.58, 0.50, 0.22], [0.48, 0.35, 0.20], (dryBlend - 0.5) * 2, out);
    }
  }
  const scaleMul = 1 - 0.45 * dryBlend;
  return applyAshToFoliageAppearance(out, scaleMul, ashNorm);
}

function blendAshIntoVertexColor(
  colors: Float32Array,
  p3: number,
  ashNorm: number,
  isOcean: boolean
): void {
  if (isOcean) {
    if (ashNorm <= 0.14) return;
    const t = clamp01((ashNorm - 0.14) / 0.86) * 0.72;
    colors[p3] = colors[p3] * (1 - t) + 0.18 * t;
    colors[p3 + 1] = colors[p3 + 1] * (1 - t) + 0.22 * t;
    colors[p3 + 2] = colors[p3 + 2] * (1 - t) + 0.27 * t;
    return;
  }
  if (ashNorm <= 0.04) return;
  if (ashNorm < 0.45) {
    const t = ((ashNorm - 0.04) / 0.41) * 0.85;
    colors[p3] = colors[p3] * (1 - t) + 0.38 * t;
    colors[p3 + 1] = colors[p3 + 1] * (1 - t) + 0.36 * t;
    colors[p3 + 2] = colors[p3 + 2] * (1 - t) + 0.33 * t;
  } else {
    const t = clamp01((ashNorm - 0.45) / 0.55);
    const midR = colors[p3] * 0.15 + 0.38 * 0.85;
    const midG = colors[p3 + 1] * 0.15 + 0.36 * 0.85;
    const midB = colors[p3 + 2] * 0.15 + 0.33 * 0.85;
    colors[p3] = midR * (1 - t) + 0.21 * t;
    colors[p3 + 1] = midG * (1 - t) + 0.19 * t;
    colors[p3 + 2] = midB * (1 - t) + 0.20 * t;
  }
}

export interface ChunkMeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

const MESH_GRID_SIZE = CHUNK_SIZE + 1; // +1 seam vertex stitches adjacent chunks with zero gap
const MESH_GRID_AREA = MESH_GRID_SIZE * MESH_GRID_SIZE;

export class QWorldTerrainMesh {
  private readonly tree: QWorldChunkTree;
  private readonly sharedIndices: Uint16Array;
  private readonly tempHeights = new Int16Array(CHUNK_AREA);
  private readonly tempBiomes = new Uint8Array(CHUNK_AREA);
  private readonly tempWater = new Uint8Array(CHUNK_AREA);
  private readonly tempRain = new Uint8Array(CHUNK_AREA);
  private readonly seamHeights = new Int16Array(MESH_GRID_AREA);
  private readonly seamBiomes = new Uint8Array(MESH_GRID_AREA);
  private readonly seamWater = new Uint8Array(MESH_GRID_AREA);
  private readonly seamRain = new Uint8Array(MESH_GRID_AREA);
  private readonly scratchC0: [number, number, number] = [0, 0, 0];
  private readonly scratchCL: [number, number, number] = [0, 0, 0];
  private readonly scratchCR: [number, number, number] = [0, 0, 0];
  private readonly scratchCU: [number, number, number] = [0, 0, 0];
  private readonly scratchCD: [number, number, number] = [0, 0, 0];
  private ashGrid: Uint8Array | null = null;
  private skyVeilGrid: Uint8Array | null = null;

  constructor(tree: QWorldChunkTree) {
    this.tree = tree;
    this.sharedIndices = QWorldTerrainMesh.buildGridIndices(MESH_GRID_SIZE);
  }

  public setAtmosphereOverlays(
    ashGrid: Uint8Array | null,
    skyVeilGrid: Uint8Array | null
  ): void {
    this.ashGrid = ashGrid;
    this.skyVeilGrid = skyVeilGrid;
  }

  public getSharedIndices(): Uint16Array {
    return this.sharedIndices;
  }

  private static buildGridIndices(size: number): Uint16Array {
    const quads = (size - 1) * (size - 1);
    const indices = new Uint16Array(quads * 6);
    let ptr = 0;
    for (let z = 0; z < size - 1; z++) {
      for (let x = 0; x < size - 1; x++) {
        const a = z * size + x;
        const b = a + 1;
        const c = (z + 1) * size + x;
        const d = c + 1;
        indices[ptr++] = a;
        indices[ptr++] = c;
        indices[ptr++] = b;
        indices[ptr++] = b;
        indices[ptr++] = c;
        indices[ptr++] = d;
      }
    }
    return indices;
  }

  public buildChunkGeometry(
    lod: number,
    cx: number,
    cz: number,
    mode: TerrainRenderMode = 'normal',
    flatWaterSurface: boolean = false,
    solarDeclinationDeg: number = 0,
    baseSeaLevel: number = 0,
    baseTempC: number = 10
  ): THREE.BufferGeometry {
    const { positions, normals, colors } = this.buildChunkBuffers(
      lod,
      cx,
      cz,
      mode,
      flatWaterSurface,
      solarDeclinationDeg,
      baseSeaLevel,
      baseTempC
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.sharedIndices, 1));
    return geometry;
  }

  public buildChunkBuffers(
    lod: number,
    cx: number,
    cz: number,
    mode: TerrainRenderMode = 'normal',
    flatWaterSurface: boolean = false,
    solarDeclinationDeg: number = 0,
    baseSeaLevel: number = 0,
    baseTempC: number = 10
  ): ChunkMeshBuffers {
    const needRain = mode === 'rain';
    this.tree.sampleChunkGrid(
      lod,
      cx,
      cz,
      this.tempHeights,
      this.tempBiomes,
      this.tempWater,
      needRain ? this.tempRain : undefined
    );
    const spacing = this.tree.getSampleSpacing(lod);
    const originX = cx * CHUNK_SIZE * spacing;
    const originZ = cz * CHUNK_SIZE * spacing;
    const elevScale = ELEVATION_SCALE;
    const seaOffset = getSeaLevelOffsetForTemp(solarDeclinationDeg);
    const effectiveSeaLevel = baseSeaLevel + seaOffset;

    // Copy 81x81 chunk samples into 82x82 seam-stitched grid and fill +x/+z border from neighbors
    const chunksX = WORLD_L0_CHUNKS_X * Math.pow(3, lod);
    const rightCx = ((cx + 1) % chunksX + chunksX) % chunksX;
    const rightChunk = this.tree.getChunk(lod, rightCx, cz);
    const bottomChunk = this.tree.getChunk(lod, cx, cz + 1);
    const cornerChunk = this.tree.getChunk(lod, rightCx, cz + 1);

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const srcOff = lz * CHUNK_SIZE;
      const dstOff = lz * MESH_GRID_SIZE;
      this.seamHeights.set(this.tempHeights.subarray(srcOff, srcOff + CHUNK_SIZE), dstOff);
      this.seamBiomes.set(this.tempBiomes.subarray(srcOff, srcOff + CHUNK_SIZE), dstOff);
      this.seamWater.set(this.tempWater.subarray(srcOff, srcOff + CHUNK_SIZE), dstOff);
      if (needRain) {
        this.seamRain.set(this.tempRain.subarray(srcOff, srcOff + CHUNK_SIZE), dstOff);
      }

      const edgeIdx = dstOff + CHUNK_SIZE;
      if (rightChunk) {
        const rIdx = lz * CHUNK_SIZE;
        this.seamHeights[edgeIdx] = rightChunk.heights[rIdx];
        this.seamBiomes[edgeIdx] = rightChunk.biomes[rIdx];
        this.seamWater[edgeIdx] = rightChunk.waterFlags[rIdx];
        if (needRain) this.seamRain[edgeIdx] = rightChunk.rainfall[rIdx];
      } else {
        const edgeX = originX + CHUNK_SIZE * spacing;
        const edgeZ = originZ + lz * spacing;
        this.seamHeights[edgeIdx] = this.tree.getHeightAt(lod, edgeX, edgeZ);
        this.seamBiomes[edgeIdx] = this.tree.getBiomeAt(lod, edgeX, edgeZ);
        this.seamWater[edgeIdx] = this.tree.getWaterAt(lod, edgeX, edgeZ);
        if (needRain) this.seamRain[edgeIdx] = this.tree.getRainfallAt(lod, edgeX, edgeZ);
      }
    }
    const bottomZ = originZ + CHUNK_SIZE * spacing;
    const bottomOff = CHUNK_SIZE * MESH_GRID_SIZE;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const idx = bottomOff + lx;
      if (bottomChunk) {
        this.seamHeights[idx] = bottomChunk.heights[lx];
        this.seamBiomes[idx] = bottomChunk.biomes[lx];
        this.seamWater[idx] = bottomChunk.waterFlags[lx];
        if (needRain) this.seamRain[idx] = bottomChunk.rainfall[lx];
      } else {
        const edgeX = originX + lx * spacing;
        this.seamHeights[idx] = this.tree.getHeightAt(lod, edgeX, bottomZ);
        this.seamBiomes[idx] = this.tree.getBiomeAt(lod, edgeX, bottomZ);
        this.seamWater[idx] = this.tree.getWaterAt(lod, edgeX, bottomZ);
        if (needRain) this.seamRain[idx] = this.tree.getRainfallAt(lod, edgeX, bottomZ);
      }
    }
    const cornerIdx = bottomOff + CHUNK_SIZE;
    if (cornerChunk) {
      this.seamHeights[cornerIdx] = cornerChunk.heights[0];
      this.seamBiomes[cornerIdx] = cornerChunk.biomes[0];
      this.seamWater[cornerIdx] = cornerChunk.waterFlags[0];
      if (needRain) this.seamRain[cornerIdx] = cornerChunk.rainfall[0];
    } else {
      const cornerX = originX + CHUNK_SIZE * spacing;
      this.seamHeights[cornerIdx] = this.tree.getHeightAt(lod, cornerX, bottomZ);
      this.seamBiomes[cornerIdx] = this.tree.getBiomeAt(lod, cornerX, bottomZ);
      this.seamWater[cornerIdx] = this.tree.getWaterAt(lod, cornerX, bottomZ);
      if (needRain) this.seamRain[cornerIdx] = this.tree.getRainfallAt(lod, cornerX, bottomZ);
    }

    const positions = new Float32Array(MESH_GRID_AREA * 3);
    const colors = new Float32Array(MESH_GRID_AREA * 3);
    const normals = new Float32Array(MESH_GRID_AREA * 3);
    const invTwoSpacing = 1 / (2 * spacing);
    const hasSeasonShift = Math.abs(solarDeclinationDeg) >= 0.01;

    for (let lz = 0; lz < MESH_GRID_SIZE; lz++) {
      const localZ = lz * spacing;
      const vertexWorldZ = originZ + localZ;
      const zUp = lz > 0 ? lz - 1 : 0;
      const zDown = lz < MESH_GRID_SIZE - 1 ? lz + 1 : MESH_GRID_SIZE - 1;

      for (let lx = 0; lx < MESH_GRID_SIZE; lx++) {
        const idx = lz * MESH_GRID_SIZE + lx;
        const h = this.seamHeights[idx];
        const b = this.seamBiomes[idx];
        const w = this.seamWater[idx];

        const p3 = idx * 3;
        const baseIsOcean = w === WATER_OCEAN;
        const isOcean =
          seaOffset > 0
            ? baseIsOcean || h <= effectiveSeaLevel
            : seaOffset < 0
              ? baseIsOcean && h <= effectiveSeaLevel
              : baseIsOcean;
        const isExposedSeabed = seaOffset < 0 && baseIsOcean && h > effectiveSeaLevel;
        const effectiveBiome = isExposedSeabed ? (h > effectiveSeaLevel + 40 ? 4 : 3) : b;

        positions[p3] = lx * spacing;
        positions[p3 + 1] = flatWaterSurface && isOcean ? effectiveSeaLevel * elevScale : h * elevScale;
        positions[p3 + 2] = localZ;

        // Fast analytical normal from central height differences
        if (flatWaterSurface && isOcean) {
          normals[p3] = 0;
          normals[p3 + 1] = 1;
          normals[p3 + 2] = 0;
        } else {
          const xLeft = lx > 0 ? lx - 1 : 0;
          const xRight = lx < MESH_GRID_SIZE - 1 ? lx + 1 : MESH_GRID_SIZE - 1;
          const dhdx = (this.seamHeights[lz * MESH_GRID_SIZE + xRight] - this.seamHeights[lz * MESH_GRID_SIZE + xLeft]) * elevScale * invTwoSpacing;
          const dhdz = (this.seamHeights[zDown * MESH_GRID_SIZE + lx] - this.seamHeights[zUp * MESH_GRID_SIZE + lx]) * elevScale * invTwoSpacing;
          const nx = -dhdx;
          const ny = 1;
          const nz = -dhdz;
          const invLen = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
          normals[p3] = nx * invLen;
          normals[p3 + 1] = ny * invLen;
          normals[p3 + 2] = nz * invLen;
        }

        const vertexWorldX = originX + lx * spacing;
        const aboveSea = h - baseSeaLevel;
        if (isOcean) {
          if (flatWaterSurface) {
            const depth = Math.max(0, effectiveSeaLevel - h);
            const depthT = 1 - Math.exp(-depth / 350);
            colors[p3] = 0.16 * (1 - depthT) + 0.015 * depthT;
            colors[p3 + 1] = 0.56 * (1 - depthT) + 0.09 * depthT;
            colors[p3 + 2] = 0.82 * (1 - depthT) + 0.024 * 10 * depthT;
          } else {
            colors[p3] = 0.05;
            colors[p3 + 1] = 0.35;
            colors[p3 + 2] = 0.68;
          }
          if (this.ashGrid && (mode === 'normal' || mode === 'biome')) {
            const ashNorm = sampleAtmosByteAtWorld(this.ashGrid, vertexWorldX, vertexWorldZ) / 255;
            blendAshIntoVertexColor(colors, p3, ashNorm, true);
          }
        } else if (mode === 'heatmap') {
          const norm = Math.max(0, Math.min(1, (aboveSea + 1000) / 2000));
          colors[p3] = norm;
          colors[p3 + 1] = 1 - Math.abs(norm - 0.5) * 1.6;
          colors[p3 + 2] = 1 - norm;
        } else if (mode === 'temp') {
          // Planet temperature / thermal heat map (including volcanic winter cooling when skyVeilGrid is active)
          const veilCool = this.skyVeilGrid
            ? (sampleAtmosByteAtWorld(this.skyVeilGrid, vertexWorldX, vertexWorldZ) / 255) * 0.32
            : 0;
          const warmth = clamp01(
            computeSeasonalWarmth(vertexWorldZ, aboveSea, solarDeclinationDeg, baseTempC) - veilCool
          );
          const shade = Math.max(0.7, Math.min(1.15, 0.92 + aboveSea * 0.0002));
          if (warmth < 0.25) {
            const t = warmth / 0.25;
            colors[p3] = (0.18 * (1 - t) + 0.12 * t) * shade;
            colors[p3 + 1] = (0.45 * (1 - t) + 0.78 * t) * shade;
            colors[p3 + 2] = (0.95 * (1 - t) + 0.92 * t) * shade;
          } else if (warmth < 0.55) {
            const t = (warmth - 0.25) / 0.30;
            colors[p3] = (0.12 * (1 - t) + 0.42 * t) * shade;
            colors[p3 + 1] = (0.78 * (1 - t) + 0.85 * t) * shade;
            colors[p3 + 2] = (0.92 * (1 - t) + 0.24 * t) * shade;
          } else if (warmth < 0.80) {
            const t = (warmth - 0.55) / 0.25;
            colors[p3] = (0.42 * (1 - t) + 0.96 * t) * shade;
            colors[p3 + 1] = (0.85 * (1 - t) + 0.62 * t) * shade;
            colors[p3 + 2] = (0.24 * (1 - t) + 0.10 * t) * shade;
          } else {
            const t = (warmth - 0.80) / 0.20;
            colors[p3] = (0.96 * (1 - t) + 0.88 * t) * shade;
            colors[p3 + 1] = (0.62 * (1 - t) + 0.16 * t) * shade;
            colors[p3 + 2] = (0.10 * (1 - t) + 0.12 * t) * shade;
          }
        } else if (mode === 'rain') {
          // Rainfall & snow weather map (arid tan -> light green -> rain cyan/blue -> heavy rain indigo, or snow/ice when freezing)
          const rainNorm = this.seamRain[idx] / 255;
          const warmth = computeSeasonalWarmth(vertexWorldZ, aboveSea, solarDeclinationDeg, baseTempC);
          const shade = Math.max(0.7, Math.min(1.15, 0.92 + aboveSea * 0.0002));
          if (warmth < 0.24 && rainNorm > 0.20) {
            // Freezing precipitation: snow & ice accumulation
            const snowT = clamp01((rainNorm - 0.20) / 0.65);
            colors[p3] = Math.min(1, (0.62 * (1 - snowT) + 0.94 * snowT) * shade);
            colors[p3 + 1] = Math.min(1, (0.76 * (1 - snowT) + 0.97 * snowT) * shade);
            colors[p3 + 2] = Math.min(1, (0.92 * (1 - snowT) + 1.0 * snowT) * shade);
          } else if (rainNorm < 0.30) {
            const t = rainNorm / 0.30;
            colors[p3] = (0.86 * (1 - t) + 0.72 * t) * shade;
            colors[p3 + 1] = (0.68 * (1 - t) + 0.78 * t) * shade;
            colors[p3 + 2] = (0.38 * (1 - t) + 0.36 * t) * shade;
          } else if (rainNorm < 0.60) {
            const t = (rainNorm - 0.30) / 0.30;
            colors[p3] = (0.72 * (1 - t) + 0.18 * t) * shade;
            colors[p3 + 1] = (0.78 * (1 - t) + 0.72 * t) * shade;
            colors[p3 + 2] = (0.36 * (1 - t) + 0.78 * t) * shade;
          } else {
            const t = (rainNorm - 0.60) / 0.40;
            colors[p3] = (0.18 * (1 - t) + 0.16 * t) * shade;
            colors[p3 + 1] = (0.72 * (1 - t) + 0.28 * t) * shade;
            colors[p3 + 2] = (0.78 * (1 - t) + 0.95 * t) * shade;
          }
        } else if (mode === 'biomes') {
          // Crisp categorical biome view
          const c0 = BIOME_COLORS[effectiveBiome] ?? BIOME_COLORS[0];
          const shade = Math.max(0.78, Math.min(1.12, 0.95 + aboveSea * 0.00018));
          colors[p3] = Math.min(1, c0[0] * shade);
          colors[p3 + 1] = Math.min(1, c0[1] * shade);
          colors[p3 + 2] = Math.min(1, c0[2] * shade);
        } else {
          // 5-tap cross blend smooths discrete biome borders against triangle sawtooth artifacts
          const xLeft = lx > 0 ? lx - 1 : 0;
          const xRight = lx < MESH_GRID_SIZE - 1 ? lx + 1 : MESH_GRID_SIZE - 1;
          const shade = Math.max(0.65, Math.min(1.25, 0.9 + aboveSea * 0.0003));
          if (!hasSeasonShift) {
            const c0 = BIOME_COLORS[effectiveBiome] ?? BIOME_COLORS[0];
            const cL = BIOME_COLORS[this.seamBiomes[lz * MESH_GRID_SIZE + xLeft]] ?? c0;
            const cR = BIOME_COLORS[this.seamBiomes[lz * MESH_GRID_SIZE + xRight]] ?? c0;
            const cU = BIOME_COLORS[this.seamBiomes[zUp * MESH_GRID_SIZE + lx]] ?? c0;
            const cD = BIOME_COLORS[this.seamBiomes[zDown * MESH_GRID_SIZE + lx]] ?? c0;
            colors[p3] = Math.min(1, (c0[0] * 0.6 + (cL[0] + cR[0] + cU[0] + cD[0]) * 0.1) * shade);
            colors[p3 + 1] = Math.min(1, (c0[1] * 0.6 + (cL[1] + cR[1] + cU[1] + cD[1]) * 0.1) * shade);
            colors[p3 + 2] = Math.min(1, (c0[2] * 0.6 + (cL[2] + cR[2] + cU[2] + cD[2]) * 0.1) * shade);
          } else {
            const bL = this.seamBiomes[lz * MESH_GRID_SIZE + xLeft];
            const bR = this.seamBiomes[lz * MESH_GRID_SIZE + xRight];
            const bU = this.seamBiomes[zUp * MESH_GRID_SIZE + lx];
            const bD = this.seamBiomes[zDown * MESH_GRID_SIZE + lx];
            const c0 = this.scratchC0;
            applyClimateBiomeColor(effectiveBiome, vertexWorldZ, aboveSea, solarDeclinationDeg, c0, baseTempC);
            if (bL === effectiveBiome && bR === effectiveBiome && bU === effectiveBiome && bD === effectiveBiome) {
              colors[p3] = Math.min(1, c0[0] * shade);
              colors[p3 + 1] = Math.min(1, c0[1] * shade);
              colors[p3 + 2] = Math.min(1, c0[2] * shade);
            } else {
              const cL = this.scratchCL;
              const cR = this.scratchCR;
              const cU = this.scratchCU;
              const cD = this.scratchCD;
              applyClimateBiomeColor(bL, vertexWorldZ, aboveSea, solarDeclinationDeg, cL, baseTempC);
              applyClimateBiomeColor(bR, vertexWorldZ, aboveSea, solarDeclinationDeg, cR, baseTempC);
              applyClimateBiomeColor(bU, vertexWorldZ, aboveSea, solarDeclinationDeg, cU, baseTempC);
              applyClimateBiomeColor(bD, vertexWorldZ, aboveSea, solarDeclinationDeg, cD, baseTempC);
              colors[p3] = Math.min(1, (c0[0] * 0.6 + (cL[0] + cR[0] + cU[0] + cD[0]) * 0.1) * shade);
              colors[p3 + 1] = Math.min(1, (c0[1] * 0.6 + (cL[1] + cR[1] + cU[1] + cD[1]) * 0.1) * shade);
              colors[p3 + 2] = Math.min(1, (c0[2] * 0.6 + (cL[2] + cR[2] + cU[2] + cD[2]) * 0.1) * shade);
            }
          }
          if (this.ashGrid) {
            const ashNorm = sampleAtmosByteAtWorld(this.ashGrid, vertexWorldX, vertexWorldZ) / 255;
            blendAshIntoVertexColor(colors, p3, ashNorm, false);
          }
        }
      }
    }

    return { positions, normals, colors };
  }

  public buildVisibleRing(
    lod: number,
    centerCx: number,
    centerCz: number,
    ringRadius: number,
    mode: TerrainRenderMode,
    flatWaterSurface: boolean = false,
    solarDeclinationDeg: number = 0
  ): THREE.BufferGeometry[] {
    const geometries: THREE.BufferGeometry[] = [];
    for (let cz = centerCz - ringRadius; cz <= centerCz + ringRadius; cz++) {
      for (let cx = centerCx - ringRadius; cx <= centerCx + ringRadius; cx++) {
        geometries.push(this.buildChunkGeometry(lod, cx, cz, mode, flatWaterSurface, solarDeclinationDeg));
      }
    }
    return geometries;
  }

  public collectVisiblePropTransforms(
    lod: number,
    bounds: WorldBounds,
    maxCount: number = 5000,
    solarDeclinationDeg: number = 0,
    baseSeaLevel: number = 0
  ): PropTransform[] {
    if (lod < 7) return [];

    const seaOffset = getSeaLevelOffsetForTemp(solarDeclinationDeg);
    const effectiveSeaLevel = baseSeaLevel + seaOffset;
    const spacing = this.tree.getSampleSpacing(lod);
    const span = this.tree.getChunkWorldSpan(lod);
    const minCx = Math.floor(bounds.minX / span);
    const maxCx = Math.floor(bounds.maxX / span);
    const minCz = Math.floor(bounds.minZ / span);
    const maxCz = Math.floor(bounds.maxZ / span);

    const transforms: PropTransform[] = [];
    const step = lod === 7 ? 2 : 1;

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        this.tree.sampleChunkGrid(lod, cx, cz, this.tempHeights, this.tempBiomes, this.tempWater);
        const originX = cx * span;
        const originZ = cz * span;

        for (let lz = 0; lz < CHUNK_SIZE; lz += step) {
          const wz = originZ + lz * spacing;
          if (wz < bounds.minZ || wz > bounds.maxZ) continue;

          for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
            const idx = lz * CHUNK_SIZE + lx;
            const biomeId = this.tempBiomes[idx];
            if (biomeId !== 2 && biomeId !== 3 && biomeId !== 6) continue; // Forest, Rock, Jungle
            const h = this.tempHeights[idx];
            const baseOcean = this.tempWater[idx] === WATER_OCEAN;
            const isOcean =
              seaOffset > 0
                ? baseOcean || h <= effectiveSeaLevel
                : seaOffset < 0
                  ? baseOcean && h <= effectiveSeaLevel
                  : baseOcean;
            if (isOcean) continue;

            const wx = originX + lx * spacing;
            if (wx < bounds.minX || wx > bounds.maxX) continue;

            transforms.push({
              x: wx,
              y: this.tempHeights[idx] * ELEVATION_SCALE,
              z: wz,
              biomeId,
              scale: 0.8 + ((lx * 13 + lz * 7) % 5) * 0.1,
            });

            if (transforms.length >= maxCount) return transforms;
          }
        }
      }
    }
    return transforms;
  }
}
