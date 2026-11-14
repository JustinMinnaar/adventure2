export const CHUNK_SIZE = 81;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const MIN_LOD = 0;
export const MAX_LOD = 9;
export const DEFAULT_SEA_LEVEL = 0;

// Power-of-3 world-unit spacing per sample across L0 (world) -> L9 (people/1yd)
const LOD_SPACING = [19683, 6561, 2187, 729, 243, 81, 27, 9, 3, 1] as const;

export const WORLD_L0_CHUNKS_X = 8;
export const WORLD_L0_CHUNKS_Z = 4;
export const WORLD_SPAN_X = WORLD_L0_CHUNKS_X * CHUNK_SIZE * LOD_SPACING[0]; // 12,754,584 yd (360 deg longitude)
export const WORLD_SPAN_Z = WORLD_L0_CHUNKS_Z * CHUNK_SIZE * LOD_SPACING[0]; // 6,377,292 yd (180 deg latitude: -90 to +90)
export const PLANET_RADIUS_YARDS = WORLD_SPAN_X / (2 * Math.PI); // ~2,029,955 yd

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainChunk {
  lod: number;
  cx: number;
  cz: number;
  heights: Int16Array;
  biomes: Uint8Array;
  waterFlags: Uint8Array;
  rainfall: Uint8Array;
}

export class QWorldChunkTree {
  private levels: Map<number, TerrainChunk>[] = Array.from(
    { length: MAX_LOD + 1 },
    () => new Map<number, TerrainChunk>()
  );
  private readonly scratchAncSample = new Int32Array(4);
  private readonly scratchRollupBiomeIds = new Uint8Array(9);
  private readonly scratchRollupBiomeCounts = new Uint8Array(9);
  private readonly scratchRollupHeights = new Int16Array(9);
  private readonly scratchRollupWeights = new Uint8Array(9);

  public static packKey(cx: number, cz: number): number {
    return (cx + 0x80000) * 0x100000 + (cz + 0x80000);
  }

  public getSampleSpacing(lod: number): number {
    const clamped = Math.max(MIN_LOD, Math.min(MAX_LOD, lod));
    return LOD_SPACING[clamped];
  }

  public getChunkWorldSpan(lod: number): number {
    return CHUNK_SIZE * this.getSampleSpacing(lod);
  }

  public getStoredChunkCount(lod?: number): number {
    if (lod !== undefined) {
      return this.levels[lod]?.size ?? 0;
    }
    let total = 0;
    for (let l = 0; l <= MAX_LOD; l++) {
      total += this.levels[l].size;
    }
    return total;
  }

  public getAllChunks(): TerrainChunk[] {
    const result: TerrainChunk[] = [];
    for (let l = 0; l <= MAX_LOD; l++) {
      for (const chunk of this.levels[l].values()) {
        result.push(chunk);
      }
    }
    return result;
  }

  public getStoredChunksForLod(lod: number): TerrainChunk[] {
    const level = this.levels[lod];
    if (!level) return [];
    return Array.from(level.values());
  }

  public getStoredChunkRange(lod: number): { minCx: number; maxCx: number; minCz: number; maxCz: number } | null {
    const level = this.levels[lod];
    if (!level || level.size === 0) return null;
    let minCx = Infinity;
    let maxCx = -Infinity;
    let minCz = Infinity;
    let maxCz = -Infinity;
    for (const c of level.values()) {
      if (c.cx < minCx) minCx = c.cx;
      if (c.cx > maxCx) maxCx = c.cx;
      if (c.cz < minCz) minCz = c.cz;
      if (c.cz > maxCz) maxCz = c.cz;
    }
    return { minCx, maxCx, minCz, maxCz };
  }

  public getChunk(lod: number, cx: number, cz: number): TerrainChunk | undefined {
    return this.levels[lod]?.get(QWorldChunkTree.packKey(cx, cz));
  }

  public setChunk(chunk: TerrainChunk): void {
    this.levels[chunk.lod]?.set(QWorldChunkTree.packKey(chunk.cx, chunk.cz), chunk);
  }

  public clear(): void {
    for (let l = 0; l <= MAX_LOD; l++) {
      this.levels[l].clear();
    }
  }

  public getOrCreateChunk(lod: number, cx: number, cz: number, defaultWaterFlag: number = 0): TerrainChunk {
    const key = QWorldChunkTree.packKey(cx, cz);
    const existing = this.levels[lod].get(key);
    if (existing) return existing;

    const heights = new Int16Array(CHUNK_AREA);
    const biomes = new Uint8Array(CHUNK_AREA);
    const waterFlags = new Uint8Array(CHUNK_AREA);
    const rainfall = new Uint8Array(CHUNK_AREA);
    rainfall.fill(128);

    // Initialize from nearest ancestor if one exists
    if (lod > 0) {
      let hasAncestor = false;
      for (let l = lod - 1; l >= MIN_LOD; l--) {
        if (this.levels[l].size > 0) {
          hasAncestor = true;
          break;
        }
      }
      this.sampleChunkGrid(lod, cx, cz, heights, biomes, hasAncestor ? waterFlags : undefined, hasAncestor ? rainfall : undefined);
      if (!hasAncestor && defaultWaterFlag !== 0) {
        waterFlags.fill(defaultWaterFlag);
      }
    } else {
      heights.fill(DEFAULT_SEA_LEVEL);
      waterFlags.fill(1); // L0 baseline at sea level (0) is ocean
    }

    const chunk: TerrainChunk = { lod, cx, cz, heights, biomes, waterFlags, rainfall };
    this.levels[lod].set(key, chunk);
    return chunk;
  }

  public getHeightAt(lod: number, worldX: number, worldZ: number): number {
    const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = wrappedX / spacing;
      const gz = worldZ / spacing;
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const chunk = this.levels[l].get(QWorldChunkTree.packKey(cx, cz));
      if (chunk) {
        if (l === lod) {
          const lx = Math.floor(gx) - cx * CHUNK_SIZE;
          const lz = Math.floor(gz) - cz * CHUNK_SIZE;
          return chunk.heights[lz * CHUNK_SIZE + lx];
        }
        return this.sampleBilinearHeight(l, gx, gz);
      }
    }
    return DEFAULT_SEA_LEVEL;
  }

  /**
   * Returns the exact rendered terrain mesh height (in yards) at continuous world (X, Z),
   * matching QWorldTerrainMesh's two-triangle quad split and optional flat water surface.
   */
  public getSurfaceHeightAt(
    lod: number,
    worldX: number,
    worldZ: number,
    flatWaterSurface: boolean = false,
    seaLevel: number = DEFAULT_SEA_LEVEL
  ): number {
    const clampedLod = Math.max(MIN_LOD, Math.min(MAX_LOD, lod));
    const spacing = LOD_SPACING[clampedLod];
    const gx = worldX / spacing;
    const gz = worldZ / spacing;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    const h00 = this.getRenderedVertexHeight(clampedLod, ix, iz, flatWaterSurface, seaLevel);
    const h10 = this.getRenderedVertexHeight(clampedLod, ix + 1, iz, flatWaterSurface, seaLevel);
    const h01 = this.getRenderedVertexHeight(clampedLod, ix, iz + 1, flatWaterSurface, seaLevel);
    const h11 = this.getRenderedVertexHeight(clampedLod, ix + 1, iz + 1, flatWaterSurface, seaLevel);

    if (fx + fz <= 1) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    }
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  }

  private getRenderedVertexHeight(
    lod: number,
    ix: number,
    iz: number,
    flatWaterSurface: boolean,
    seaLevel: number
  ): number {
    const spacing = LOD_SPACING[lod];
    const directCx = Math.floor(ix / CHUNK_SIZE);
    const directCz = Math.floor(iz / CHUNK_SIZE);
    let sampleIx = ix;
    let sampleIz = iz;

    if (!this.getChunk(lod, directCx, directCz)) {
      const totalGridX = WORLD_L0_CHUNKS_X * CHUNK_SIZE * Math.pow(3, lod);
      const totalGridZ = WORLD_L0_CHUNKS_Z * CHUNK_SIZE * Math.pow(3, lod);
      if (ix < 0 || ix >= totalGridX) {
        sampleIx = ((ix % totalGridX) + totalGridX) % totalGridX;
      }
      if (iz < 0 || iz >= totalGridZ) {
        sampleIz = Math.max(0, Math.min(totalGridZ - 1, iz));
      }
    }

    const wx = sampleIx * spacing;
    const wz = sampleIz * spacing;
    if (flatWaterSurface && this.getWaterAt(lod, wx, wz) === 1) {
      return seaLevel;
    }
    return this.getHeightAt(lod, wx, wz);
  }

  public getBiomeAt(lod: number, worldX: number, worldZ: number): number {
    const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = Math.floor(wrappedX / spacing);
      const gz = Math.floor(worldZ / spacing);
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const chunk = this.levels[l].get(QWorldChunkTree.packKey(cx, cz));
      if (chunk) {
        const lx = gx - cx * CHUNK_SIZE;
        const lz = gz - cz * CHUNK_SIZE;
        return chunk.biomes[lz * CHUNK_SIZE + lx];
      }
    }
    return 0;
  }

  public getWaterAt(lod: number, worldX: number, worldZ: number): number {
    const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = Math.floor(wrappedX / spacing);
      const gz = Math.floor(worldZ / spacing);
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const chunk = this.levels[l].get(QWorldChunkTree.packKey(cx, cz));
      if (chunk) {
        const lx = gx - cx * CHUNK_SIZE;
        const lz = gz - cz * CHUNK_SIZE;
        return chunk.waterFlags[lz * CHUNK_SIZE + lx];
      }
    }
    return 1;
  }

  public getRainfallAt(lod: number, worldX: number, worldZ: number): number {
    const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = Math.floor(wrappedX / spacing);
      const gz = Math.floor(worldZ / spacing);
      const cx = Math.floor(gx / CHUNK_SIZE);
      const cz = Math.floor(gz / CHUNK_SIZE);
      const chunk = this.levels[l].get(QWorldChunkTree.packKey(cx, cz));
      if (chunk) {
        const lx = gx - cx * CHUNK_SIZE;
        const lz = gz - cz * CHUNK_SIZE;
        return chunk.rainfall[lz * CHUNK_SIZE + lx];
      }
    }
    return 128;
  }

  public setSampleAt(
    lod: number,
    worldX: number,
    worldZ: number,
    data: { height?: number; biome?: number; waterFlag?: number; rainfall?: number }
  ): void {
    const spacing = LOD_SPACING[lod];
    const gx = Math.floor(worldX / spacing);
    const gz = Math.floor(worldZ / spacing);
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const chunk = this.getOrCreateChunk(lod, cx, cz);
    const idx = (gz - cz * CHUNK_SIZE) * CHUNK_SIZE + (gx - cx * CHUNK_SIZE);
    if (data.height !== undefined) chunk.heights[idx] = data.height;
    if (data.biome !== undefined) chunk.biomes[idx] = data.biome;
    if (data.waterFlag !== undefined) chunk.waterFlags[idx] = data.waterFlag;
    if (data.rainfall !== undefined) chunk.rainfall[idx] = data.rainfall;
  }

  private findCoveringAncestorLod(lod: number, cx: number, cz: number): number {
    for (let l = lod - 1; l >= MIN_LOD; l--) {
      const map = this.levels[l];
      if (map.size === 0) continue;
      const scale = Math.pow(3, lod - l);
      const rawAcx = Math.floor(cx / scale);
      const acz = Math.floor(cz / scale);
      const lChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, l);
      const wrappedAcx = ((rawAcx % lChunksX) + lChunksX) % lChunksX;
      if (
        map.has(QWorldChunkTree.packKey(rawAcx, acz)) ||
        map.has(QWorldChunkTree.packKey(wrappedAcx, acz))
      ) {
        return l;
      }
    }
    for (let l = lod - 1; l >= MIN_LOD; l--) {
      if (this.levels[l].size > 0) return l;
    }
    return -1;
  }

  private readFallbackAncestorSample(
    ancLod: number,
    ancSpacing: number,
    acx: number,
    acz: number,
    alx: number,
    alz: number,
    needRainfall: boolean
  ): void {
    const wx = (acx * CHUNK_SIZE + alx) * ancSpacing;
    const wz = (acz * CHUNK_SIZE + alz) * ancSpacing;
    if (wz >= 0 && wz < WORLD_SPAN_Z) {
      const wrappedX = ((wx % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
      for (let l = ancLod - 1; l >= MIN_LOD; l--) {
        const map = this.levels[l];
        if (map.size === 0) continue;
        const spacing = LOD_SPACING[l];
        const gx = Math.floor(wrappedX / spacing);
        const gz = Math.floor(wz / spacing);
        const cx = Math.floor(gx / CHUNK_SIZE);
        const cz = Math.floor(gz / CHUNK_SIZE);
        const chunk = map.get(QWorldChunkTree.packKey(cx, cz));
        if (chunk) {
          const idx = (gz - cz * CHUNK_SIZE) * CHUNK_SIZE + (gx - cx * CHUNK_SIZE);
          this.scratchAncSample[0] = chunk.heights[idx];
          this.scratchAncSample[1] = chunk.biomes[idx];
          this.scratchAncSample[2] = chunk.waterFlags[idx];
          this.scratchAncSample[3] = needRainfall ? chunk.rainfall[idx] : 128;
          return;
        }
      }
    }
    this.scratchAncSample[0] = DEFAULT_SEA_LEVEL;
    this.scratchAncSample[1] = 0;
    this.scratchAncSample[2] = 1;
    this.scratchAncSample[3] = 128;
  }

  private loadAncestorCorner(
    ancMap: Map<number, TerrainChunk>,
    ancLod: number,
    ancSpacing: number,
    acx: number,
    acz: number,
    alx: number,
    alz: number,
    needRainfall: boolean
  ): void {
    const chunk = ancMap.get(QWorldChunkTree.packKey(acx, acz));
    if (chunk) {
      const i = alz * CHUNK_SIZE + alx;
      this.scratchAncSample[0] = chunk.heights[i];
      this.scratchAncSample[1] = chunk.biomes[i];
      this.scratchAncSample[2] = chunk.waterFlags[i];
      this.scratchAncSample[3] = needRainfall ? chunk.rainfall[i] : 128;
      return;
    }
    this.readFallbackAncestorSample(ancLod, ancSpacing, acx, acz, alx, alz, needRainfall);
  }

  public sampleChunkGrid(
    lod: number,
    cx: number,
    cz: number,
    outHeights: Int16Array,
    outBiomes: Uint8Array,
    outWaterFlags?: Uint8Array,
    outRainfall?: Uint8Array
  ): void {
    const direct = this.getChunk(lod, cx, cz);
    if (direct) {
      outHeights.set(direct.heights);
      outBiomes.set(direct.biomes);
      if (outWaterFlags) outWaterFlags.set(direct.waterFlags);
      if (outRainfall) outRainfall.set(direct.rainfall);
      return;
    }

    const spacing = LOD_SPACING[lod];
    const originX = cx * CHUNK_SIZE * spacing;
    const originZ = cz * CHUNK_SIZE * spacing;

    const ancLod = this.findCoveringAncestorLod(lod, cx, cz);
    if (ancLod === -1) {
      outHeights.fill(DEFAULT_SEA_LEVEL);
      outBiomes.fill(0);
      if (outWaterFlags) outWaterFlags.fill(1); // Default height 0 is ocean
      if (outRainfall) outRainfall.fill(128);
      return;
    }

    const ancSpacing = LOD_SPACING[ancLod];
    const ancChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, ancLod);
    const needsWrapX = originX < 0 || cx >= WORLD_L0_CHUNKS_X * Math.pow(3, lod) - 1;
    const ratio = spacing / ancSpacing;
    const ancMap = this.levels[ancLod];
    const needRain = Boolean(outRainfall);
    const halfRatioMinusHalf = 0.5 * ratio - 0.5;
    let lastAcx = Number.NaN;
    let lastAcz = Number.NaN;
    let lastAncChunk: TerrainChunk | undefined;

    // Precompute X-slice parameters (invariant across rows lz = 0..CHUNK_SIZE - 1)
    const alx0Arr = new Int32Array(CHUNK_SIZE);
    const alx1Arr = new Int32Array(CHUNK_SIZE);
    const acx0Arr = new Int32Array(CHUNK_SIZE);
    const acx1Arr = new Int32Array(CHUNK_SIZE);
    const txArr = new Float32Array(CHUNK_SIZE);

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const fx = (originX / ancSpacing) + lx * ratio + halfRatioMinusHalf;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      txArr[lx] = tx;
      const x1 = x0 + 1;
      const rawAcx0 = Math.floor(x0 / CHUNK_SIZE);
      const rawAcx1 = Math.floor(x1 / CHUNK_SIZE);
      alx0Arr[lx] = x0 - rawAcx0 * CHUNK_SIZE;
      alx1Arr[lx] = x1 - rawAcx1 * CHUNK_SIZE;
      acx0Arr[lx] = needsWrapX && (rawAcx0 < 0 || rawAcx0 >= ancChunksX)
        ? ((rawAcx0 % ancChunksX) + ancChunksX) % ancChunksX
        : rawAcx0;
      acx1Arr[lx] = needsWrapX && (rawAcx1 < 0 || rawAcx1 >= ancChunksX)
        ? ((rawAcx1 % ancChunksX) + ancChunksX) % ancChunksX
        : rawAcx1;
    }

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const fz = (originZ / ancSpacing) + lz * ratio + halfRatioMinusHalf;
      const z0 = Math.floor(fz);
      const tz = fz - z0;
      const z1 = z0 + 1;
      const acz0 = Math.floor(z0 / CHUNK_SIZE);
      const acz1 = Math.floor(z1 / CHUNK_SIZE);
      const alz0 = z0 - acz0 * CHUNK_SIZE;
      const alz1 = z1 - acz1 * CHUNK_SIZE;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const alx0 = alx0Arr[lx];
        const alx1 = alx1Arr[lx];
        const acx0 = acx0Arr[lx];
        const acx1 = acx1Arr[lx];
        const tx = txArr[lx];
        const outIdx = lz * CHUNK_SIZE + lx;

        let h00 = DEFAULT_SEA_LEVEL, b00 = 0, wf00 = 1, rf00 = 128;
        let h10 = DEFAULT_SEA_LEVEL, b10 = 0, wf10 = 1, rf10 = 128;
        let h01 = DEFAULT_SEA_LEVEL, b01 = 0, wf01 = 1, rf01 = 128;
        let h11 = DEFAULT_SEA_LEVEL, b11 = 0, wf11 = 1, rf11 = 128;

        if (acx0 === acx1 && acz0 === acz1) {
          if (acx0 !== lastAcx || acz0 !== lastAcz) {
            lastAcx = acx0;
            lastAcz = acz0;
            lastAncChunk = ancMap.get(QWorldChunkTree.packKey(acx0, acz0));
          }
          if (lastAncChunk) {
            const r0 = alz0 * CHUNK_SIZE;
            const r1 = alz1 * CHUNK_SIZE;
            const i00 = r0 + alx0;
            const i10 = r0 + alx1;
            const i01 = r1 + alx0;
            const i11 = r1 + alx1;
            h00 = lastAncChunk.heights[i00]; b00 = lastAncChunk.biomes[i00]; wf00 = lastAncChunk.waterFlags[i00];
            h10 = lastAncChunk.heights[i10]; b10 = lastAncChunk.biomes[i10]; wf10 = lastAncChunk.waterFlags[i10];
            h01 = lastAncChunk.heights[i01]; b01 = lastAncChunk.biomes[i01]; wf01 = lastAncChunk.waterFlags[i01];
            h11 = lastAncChunk.heights[i11]; b11 = lastAncChunk.biomes[i11]; wf11 = lastAncChunk.waterFlags[i11];
            if (outRainfall) {
              rf00 = lastAncChunk.rainfall[i00];
              rf10 = lastAncChunk.rainfall[i10];
              rf01 = lastAncChunk.rainfall[i01];
              rf11 = lastAncChunk.rainfall[i11];
            }
          } else {
            this.readFallbackAncestorSample(ancLod, ancSpacing, acx0, acz0, alx0, alz0, needRain);
            h00 = this.scratchAncSample[0]; b00 = this.scratchAncSample[1]; wf00 = this.scratchAncSample[2]; rf00 = this.scratchAncSample[3];
            this.readFallbackAncestorSample(ancLod, ancSpacing, acx0, acz0, alx1, alz0, needRain);
            h10 = this.scratchAncSample[0]; b10 = this.scratchAncSample[1]; wf10 = this.scratchAncSample[2]; rf10 = this.scratchAncSample[3];
            this.readFallbackAncestorSample(ancLod, ancSpacing, acx0, acz0, alx0, alz1, needRain);
            h01 = this.scratchAncSample[0]; b01 = this.scratchAncSample[1]; wf01 = this.scratchAncSample[2]; rf01 = this.scratchAncSample[3];
            this.readFallbackAncestorSample(ancLod, ancSpacing, acx0, acz0, alx1, alz1, needRain);
            h11 = this.scratchAncSample[0]; b11 = this.scratchAncSample[1]; wf11 = this.scratchAncSample[2]; rf11 = this.scratchAncSample[3];
          }
        } else {
          this.loadAncestorCorner(ancMap, ancLod, ancSpacing, acx0, acz0, alx0, alz0, needRain);
          h00 = this.scratchAncSample[0]; b00 = this.scratchAncSample[1]; wf00 = this.scratchAncSample[2]; rf00 = this.scratchAncSample[3];
          this.loadAncestorCorner(ancMap, ancLod, ancSpacing, acx1, acz0, alx1, alz0, needRain);
          h10 = this.scratchAncSample[0]; b10 = this.scratchAncSample[1]; wf10 = this.scratchAncSample[2]; rf10 = this.scratchAncSample[3];
          this.loadAncestorCorner(ancMap, ancLod, ancSpacing, acx0, acz1, alx0, alz1, needRain);
          h01 = this.scratchAncSample[0]; b01 = this.scratchAncSample[1]; wf01 = this.scratchAncSample[2]; rf01 = this.scratchAncSample[3];
          this.loadAncestorCorner(ancMap, ancLod, ancSpacing, acx1, acz1, alx1, alz1, needRain);
          h11 = this.scratchAncSample[0]; b11 = this.scratchAncSample[1]; wf11 = this.scratchAncSample[2]; rf11 = this.scratchAncSample[3];
        }

        const w00 = (1 - tx) * (1 - tz);
        const w10 = tx * (1 - tz);
        const w01 = (1 - tx) * tz;
        const w11 = tx * tz;

        outHeights[outIdx] = Math.round(w00 * h00 + w10 * h10 + w01 * h01 + w11 * h11);

        if (outWaterFlags) {
          const oceanW = w00 * wf00 + w10 * wf10 + w01 * wf01 + w11 * wf11;
          outWaterFlags[outIdx] = oceanW >= 0.5 ? 1 : 0;
        }

        if (outRainfall) {
          outRainfall[outIdx] = Math.round(w00 * rf00 + w10 * rf10 + w01 * rf01 + w11 * rf11);
        }

        // Weighted mode across the 4 nearest ancestor biomes (anti-aliases staircase corners)
        if (b00 === b10 && b00 === b01 && b00 === b11) {
          outBiomes[outIdx] = b00;
        } else {
          const s00 = w00 + (b10 === b00 ? w10 : 0) + (b01 === b00 ? w01 : 0) + (b11 === b00 ? w11 : 0);
          let bestB = b00;
          let bestW = s00;
          if (b10 !== b00) {
            const s10 = w10 + (b01 === b10 ? w01 : 0) + (b11 === b10 ? w11 : 0);
            if (s10 > bestW) { bestW = s10; bestB = b10; }
          }
          if (b01 !== b00 && b01 !== b10) {
            const s01 = w01 + (b11 === b01 ? w11 : 0);
            if (s01 > bestW) { bestW = s01; bestB = b01; }
          }
          if (b11 !== b00 && b11 !== b10 && b11 !== b01 && w11 > bestW) {
            bestB = b11;
          }
          outBiomes[outIdx] = bestB;
        }
      }
    }
  }

  public pruneMatchingParentChunks(): number {
    let pruned = 0;
    const tempH = new Int16Array(CHUNK_AREA);
    const tempB = new Uint8Array(CHUNK_AREA);

    for (let l = MAX_LOD; l >= MIN_LOD; l--) {
      const map = this.levels[l];
      for (const [key, chunk] of map.entries()) {
        if (l === 0) {
          let matchesDefault = true;
          for (let i = 0; i < CHUNK_AREA; i++) {
            if (chunk.heights[i] !== DEFAULT_SEA_LEVEL || chunk.biomes[i] !== 0) {
              matchesDefault = false;
              break;
            }
          }
          if (matchesDefault) {
            map.delete(key);
            pruned++;
          }
        } else {
          // Temporarily detach to sample parent baseline
          map.delete(key);
          this.sampleChunkGrid(l, chunk.cx, chunk.cz, tempH, tempB);
          let matchesParent = true;
          for (let i = 0; i < CHUNK_AREA; i++) {
            if (chunk.heights[i] !== tempH[i] || chunk.biomes[i] !== tempB[i]) {
              matchesParent = false;
              break;
            }
          }
          if (matchesParent) {
            pruned++;
          } else {
            map.set(key, chunk);
          }
        }
      }
    }
    return pruned;
  }

  public queryChunksInBounds(lod: number, bounds: WorldBounds): TerrainChunk[] {
    const span = this.getChunkWorldSpan(lod);
    const minCx = Math.floor(bounds.minX / span);
    const maxCx = Math.floor(bounds.maxX / span);
    const minCz = Math.floor(bounds.minZ / span);
    const maxCz = Math.floor(bounds.maxZ / span);

    const results: TerrainChunk[] = [];
    const map = this.levels[lod];
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = map.get(QWorldChunkTree.packKey(cx, cz));
        if (chunk) results.push(chunk);
      }
    }
    return results;
  }

  /**
   * Bottom-up rollup: averages 3x3 child blocks into parent samples and picks the
   * dominant biome & ocean flag, propagating recursively up to L0.
   */
  public rollupChunksToParent(
    childLod: number,
    minCx: number,
    maxCx: number,
    minCz: number,
    maxCz: number
  ): void {
    this.rollupToParent(
      childLod,
      minCx * CHUNK_SIZE,
      (maxCx + 1) * CHUNK_SIZE - 1,
      minCz * CHUNK_SIZE,
      (maxCz + 1) * CHUNK_SIZE - 1
    );
  }

  private lookupChildChunk(
    childMap: Map<number, TerrainChunk>,
    childChunksX: number,
    ccx: number,
    ccz: number
  ): TerrainChunk | undefined {
    let chunk = childMap.get(QWorldChunkTree.packKey(ccx, ccz));
    if (!chunk && (ccx < 0 || ccx >= childChunksX)) {
      const wrappedCcx = ((ccx % childChunksX) + childChunksX) % childChunksX;
      chunk = childMap.get(QWorldChunkTree.packKey(wrappedCcx, ccz));
    }
    return chunk;
  }

  private writeRolledUpParentSample(
    parentChunk: TerrainChunk,
    pIdx: number,
    uniqueCount: number,
    oceanCount: number,
    rainfallWeightedSum: number,
    centerBiome: number
  ): void {
    const sampleHeights = this.scratchRollupHeights;
    const sampleWeights = this.scratchRollupWeights;
    const biomeIds = this.scratchRollupBiomeIds;
    const biomeCounts = this.scratchRollupBiomeCounts;

    // Insertion sort 9 (height, weight) pairs for center-weighted median (total weight = 15, mid = 8)
    for (let i = 1; i < 9; i++) {
      const keyH = sampleHeights[i];
      const keyW = sampleWeights[i];
      let j = i - 1;
      while (j >= 0 && sampleHeights[j] > keyH) {
        sampleHeights[j + 1] = sampleHeights[j];
        sampleWeights[j + 1] = sampleWeights[j];
        j--;
      }
      sampleHeights[j + 1] = keyH;
      sampleWeights[j + 1] = keyW;
    }
    let cumWeight = 0;
    let medianH = sampleHeights[4];
    for (let i = 0; i < 9; i++) {
      cumWeight += sampleWeights[i];
      if (cumWeight >= 8) {
        medianH = sampleHeights[i];
        break;
      }
    }

    let bestBiome = centerBiome;
    let bestCount = -1;
    for (let k = 0; k < uniqueCount; k++) {
      const cnt = biomeCounts[k];
      if (cnt > bestCount || (cnt === bestCount && biomeIds[k] === centerBiome)) {
        bestCount = cnt;
        bestBiome = biomeIds[k];
      }
    }

    parentChunk.heights[pIdx] = medianH;
    parentChunk.biomes[pIdx] = bestBiome;
    parentChunk.waterFlags[pIdx] = oceanCount >= 5 ? 1 : 0;
    parentChunk.rainfall[pIdx] = Math.round(rainfallWeightedSum / 15);
  }

  public rollupToParent(
    childLod: number,
    minChildGx: number,
    maxChildGx: number,
    minChildGz: number,
    maxChildGz: number
  ): void {
    if (childLod <= MIN_LOD) return;

    const parentLod = childLod - 1;
    const minPGx = Math.floor(minChildGx / 3);
    const maxPGx = Math.floor(maxChildGx / 3);
    const minPGz = Math.floor(minChildGz / 3);
    const maxPGz = Math.floor(maxChildGz / 3);

    const childMap = this.levels[childLod];
    const childChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, childLod);
    let lastCcx = Number.NaN;
    let lastCcz = Number.NaN;
    let lastChildChunk: TerrainChunk | undefined;

    let lastPcx = Number.NaN;
    let lastPcz = Number.NaN;
    let lastParentChunk: TerrainChunk | undefined;

    const biomeIds = this.scratchRollupBiomeIds;
    const biomeCounts = this.scratchRollupBiomeCounts;
    const sampleHeights = this.scratchRollupHeights;
    const sampleWeights = this.scratchRollupWeights;

    for (let pgz = minPGz; pgz <= maxPGz; pgz++) {
      const pcz = Math.floor(pgz / CHUNK_SIZE);
      const plz = pgz - pcz * CHUNK_SIZE;
      const pRowOffset = plz * CHUNK_SIZE;
      const baseCgz = pgz * 3;
      const ccz0 = Math.floor(baseCgz / CHUNK_SIZE);
      const clz0 = baseCgz - ccz0 * CHUNK_SIZE;
      const zInsideOneChunk = clz0 <= CHUNK_SIZE - 3;

      for (let pgx = minPGx; pgx <= maxPGx; pgx++) {
        const pcx = Math.floor(pgx / CHUNK_SIZE);
        const plx = pgx - pcx * CHUNK_SIZE;

        if (pcx !== lastPcx || pcz !== lastPcz) {
          lastPcx = pcx;
          lastPcz = pcz;
          lastParentChunk = this.getOrCreateChunk(parentLod, pcx, pcz, 1);
        }
        const pIdx = pRowOffset + plx;
        const baseCgx = pgx * 3;
        const ccx0 = Math.floor(baseCgx / CHUNK_SIZE);
        const clx0 = baseCgx - ccx0 * CHUNK_SIZE;
        const sameChunk = zInsideOneChunk && clx0 <= CHUNK_SIZE - 3;

        if (sameChunk) {
          if (ccx0 !== lastCcx || ccz0 !== lastCcz) {
            lastCcx = ccx0;
            lastCcz = ccz0;
            lastChildChunk = this.lookupChildChunk(childMap, childChunksX, ccx0, ccz0);
          }
          if (!lastChildChunk) continue;
        }

        const fallbackH = lastParentChunk!.heights[pIdx];
        const fallbackB = lastParentChunk!.biomes[pIdx];
        const fallbackW = lastParentChunk!.waterFlags[pIdx];
        const fallbackR = lastParentChunk!.rainfall[pIdx];

        let sampleCount = 0;
        let oceanCount = 0;
        let uniqueCount = 0;
        let rainfallWeightedSum = 0;
        let centerBiome = fallbackB;

        for (let dz = 0; dz < 3; dz++) {
          const zMid = dz === 1;
          let ccz = ccz0;
          let clz = clz0 + dz;
          if (!sameChunk) {
            const cgz = baseCgz + dz;
            ccz = Math.floor(cgz / CHUNK_SIZE);
            clz = cgz - ccz * CHUNK_SIZE;
          }
          const cRowOffset = clz * CHUNK_SIZE;

          for (let dx = 0; dx < 3; dx++) {
            let clx = clx0 + dx;
            if (!sameChunk) {
              const cgx = baseCgx + dx;
              const ccx = Math.floor(cgx / CHUNK_SIZE);
              clx = cgx - ccx * CHUNK_SIZE;
              if (ccx !== lastCcx || ccz !== lastCcz) {
                lastCcx = ccx;
                lastCcz = ccz;
                lastChildChunk = this.lookupChildChunk(childMap, childChunksX, ccx, ccz);
              }
            }

            let h = fallbackH;
            let b = fallbackB;
            let w = fallbackW;
            let r = fallbackR;
            if (lastChildChunk) {
              const cIdx = cRowOffset + clx;
              h = lastChildChunk.heights[cIdx];
              b = lastChildChunk.biomes[cIdx];
              w = lastChildChunk.waterFlags[cIdx];
              r = lastChildChunk.rainfall[cIdx];
            }
            const weight = dx === 1 && zMid ? 3 : dx === 1 || zMid ? 2 : 1;
            if (dx === 1 && zMid) centerBiome = b;
            sampleHeights[sampleCount] = h;
            sampleWeights[sampleCount] = weight;
            sampleCount++;
            if (w === 1) oceanCount++;
            rainfallWeightedSum += r * weight;

            let found = false;
            for (let k = 0; k < uniqueCount; k++) {
              if (biomeIds[k] === b) {
                biomeCounts[k] += weight;
                found = true;
                break;
              }
            }
            if (!found) {
              biomeIds[uniqueCount] = b;
              biomeCounts[uniqueCount] = weight;
              uniqueCount++;
            }
          }
        }

        this.writeRolledUpParentSample(
          lastParentChunk!,
          pIdx,
          uniqueCount,
          oceanCount,
          rainfallWeightedSum,
          centerBiome
        );
      }
    }

    if (parentLod > MIN_LOD) {
      this.rollupToParent(parentLod, minPGx, maxPGx, minPGz, maxPGz);
    }
  }

  /**
   * Collects all stored chunks at `lod` overlapping [minGx..maxGx, minGz..maxGz]
   * and all stored ancestor chunks across parent levels L0..lod-1 covering the rolled-up hierarchy.
   */
  public collectChunksInGridHierarchy(
    lod: number,
    minGx: number,
    maxGx: number,
    minGz: number,
    maxGz: number
  ): TerrainChunk[] {
    const result: TerrainChunk[] = [];
    const seen = new Set<TerrainChunk>();
    let curMinGx = minGx;
    let curMaxGx = maxGx;
    let curMinGz = minGz;
    let curMaxGz = maxGz;

    for (let l = lod; l >= MIN_LOD; l--) {
      const map = this.levels[l];
      if (map.size > 0) {
        const lChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, l);
        const minCx = Math.floor(curMinGx / CHUNK_SIZE);
        const maxCx = Math.floor(curMaxGx / CHUNK_SIZE);
        const minCz = Math.floor(curMinGz / CHUNK_SIZE);
        const maxCz = Math.floor(curMaxGz / CHUNK_SIZE);
        for (let cz = minCz; cz <= maxCz; cz++) {
          for (let cx = minCx; cx <= maxCx; cx++) {
            const direct = map.get(QWorldChunkTree.packKey(cx, cz));
            if (direct && !seen.has(direct)) {
              seen.add(direct);
              result.push(direct);
            }
            if (cx < 0 || cx >= lChunksX) {
              const wrappedCx = ((cx % lChunksX) + lChunksX) % lChunksX;
              const wrapped = map.get(QWorldChunkTree.packKey(wrappedCx, cz));
              if (wrapped && !seen.has(wrapped)) {
                seen.add(wrapped);
                result.push(wrapped);
              }
            }
          }
        }
      }
      if (l === MIN_LOD) break;
      curMinGx = Math.floor(curMinGx / 3);
      curMaxGx = Math.floor(curMaxGx / 3);
      curMinGz = Math.floor(curMinGz / 3);
      curMaxGz = Math.floor(curMaxGz / 3);
    }
    return result;
  }

  /**
   * Invalidates (deletes) cached descendant chunks under an edited parent grid region
   * so they are cleanly recreated from the updated parent when zooming back in.
   */
  public invalidateDescendants(
    parentLod: number,
    minParentGx: number,
    maxParentGx: number,
    minParentGz: number,
    maxParentGz: number
  ): void {
    let minGx = minParentGx;
    let maxGx = maxParentGx;
    let minGz = minParentGz;
    let maxGz = maxParentGz;

    for (let childLod = parentLod + 1; childLod <= MAX_LOD; childLod++) {
      minGx = minGx * 3;
      maxGx = maxGx * 3 + 2;
      minGz = minGz * 3;
      maxGz = maxGz * 3 + 2;

      const map = this.levels[childLod];
      if (map.size === 0) continue;

      const childChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, childLod);
      const minCx = Math.floor(minGx / CHUNK_SIZE);
      const maxCx = Math.floor(maxGx / CHUNK_SIZE);
      const minCz = Math.floor(minGz / CHUNK_SIZE);
      const maxCz = Math.floor(maxGz / CHUNK_SIZE);

      for (let cz = minCz; cz <= maxCz; cz++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          map.delete(QWorldChunkTree.packKey(cx, cz));
          if (cx < 0 || cx >= childChunksX) {
            const wrappedCx = ((cx % childChunksX) + childChunksX) % childChunksX;
            map.delete(QWorldChunkTree.packKey(wrappedCx, cz));
          }
        }
      }
    }
  }

  /**
   * Deterministically refines a chunk when zooming into a finer LOD for the first time,
   * perturbing ocean/ground borders and inland relief, then storing it for consistency.
   * Empty ocean chunks are left virtual (unallocated).
   */
  public refineChunkOnZoom(
    lod: number,
    cx: number,
    cz: number,
    seaLevel: number = DEFAULT_SEA_LEVEL,
    outCreated?: TerrainChunk[]
  ): boolean {
    if (lod <= MIN_LOD || lod > MAX_LOD) return false;
    const key = QWorldChunkTree.packKey(cx, cz);
    if (this.levels[lod].has(key)) return false;

    // 1. Ensure ancestor chain exists (recursive cascade from parent level down to L0)
    const parentLod = lod - 1;
    const parentChunksX = WORLD_L0_CHUNKS_X * Math.pow(3, parentLod);
    const parentChunksZ = WORLD_L0_CHUNKS_Z * Math.pow(3, parentLod);

    const minPcx = Math.floor((cx * 27 - 1) / 81);
    const maxPcx = Math.floor((cx * 27 + 27) / 81);
    const minPcz = Math.floor((cz * 27 - 1) / 81);
    const maxPcz = Math.floor((cz * 27 + 27) / 81);

    for (let pz = minPcz; pz <= maxPcz; pz++) {
      if (pz < 0 || pz >= parentChunksZ) continue;
      for (let px = minPcx; px <= maxPcx; px++) {
        const wrappedPx = ((px % parentChunksX) + parentChunksX) % parentChunksX;
        const pKey = QWorldChunkTree.packKey(wrappedPx, pz);
        if (!this.levels[parentLod].has(pKey)) {
          this.refineChunkOnZoom(parentLod, wrappedPx, pz, seaLevel, outCreated);
        }
      }
    }

    let hasAnyAncestor = false;
    for (let l = lod - 1; l >= MIN_LOD; l--) {
      if (this.levels[l].size > 0) {
        hasAnyAncestor = true;
        break;
      }
    }
    if (!hasAnyAncestor) return false;

    const heights = new Int16Array(CHUNK_AREA);
    const biomes = new Uint8Array(CHUNK_AREA);
    const waterFlags = new Uint8Array(CHUNK_AREA);
    const rainfall = new Uint8Array(CHUNK_AREA);
    this.sampleChunkGrid(lod, cx, cz, heights, biomes, waterFlags, rainfall);

    // Leave pure flat ocean chunks virtual
    let hasLand = false;
    for (let i = 0; i < CHUNK_AREA; i++) {
      if (waterFlags[i] === 0 || heights[i] > seaLevel) {
        hasLand = true;
        break;
      }
    }
    if (!hasLand) return false;

    const baseH = new Int16Array(heights);
    const baseW = new Uint8Array(waterFlags);
    const baseGx = cx * CHUNK_SIZE;
    const baseGz = cz * CHUNK_SIZE;

    // Scale perturbation down at each deeper LOD so coastlines stay soft and maintain gradient
    const lodDecay = Math.pow(0.45, lod - 1);
    const coastAmp = Math.max(0.5, 28 * lodDecay);
    const cellSpacing = LOD_SPACING[lod];

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const gz = baseGz + lz;
      const zUp = lz > 0 ? lz - 1 : 0;
      const zDn = lz < CHUNK_SIZE - 1 ? lz + 1 : CHUNK_SIZE - 1;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = lz * CHUNK_SIZE + lx;
        const xLt = lx > 0 ? lx - 1 : 0;
        const xRt = lx < CHUNK_SIZE - 1 ? lx + 1 : CHUNK_SIZE - 1;

        const wC = baseW[idx];
        const isCoastBorder =
          baseW[lz * CHUNK_SIZE + xLt] !== wC ||
          baseW[lz * CHUNK_SIZE + xRt] !== wC ||
          baseW[zUp * CHUNK_SIZE + lx] !== wC ||
          baseW[zDn * CHUNK_SIZE + lx] !== wC;

        const hC = baseH[idx];
        const aboveSea = hC - seaLevel;
        const hLt = baseH[lz * CHUNK_SIZE + xLt];
        const hRt = baseH[lz * CHUNK_SIZE + xRt];
        const hUp = baseH[zUp * CHUNK_SIZE + lx];
        const hDn = baseH[zDn * CHUNK_SIZE + lx];
        const dhx = (hRt - hLt) * 0.5;
        const dhz = (hDn - hUp) * 0.5;
        const slopeYds = Math.hypot(dhx, dhz);
        const grade = slopeYds / cellSpacing; // Rise over run

        const n = QWorldChunkTree.smoothNoise2D((baseGx + lx) * 0.35, gz * 0.35, lod);
        const biome = biomes[idx];
        const isMountainOrRock = biome === 3 || biome === 7;

        if (isCoastBorder) {
          const amp = isMountainOrRock ? coastAmp * 1.4 : coastAmp;
          const nextH = Math.max(-10000, Math.min(10000, Math.round(hC + n * amp)));
          heights[idx] = nextH;
          waterFlags[idx] = nextH <= seaLevel ? 1 : 0;
          if (nextH > seaLevel && biomes[idx] === 0) {
            biomes[idx] = 1; // Grass along newly raised coastal cells
          }
        } else if (aboveSea > 0) {
          // Check for steep rocky cliff formation
          // Steep terrain (grade > 0.40 in mountains, or grade > 0.60 in hills) develops rocky cliff ledges
          const cliffNoise = QWorldChunkTree.smoothNoise2D((baseGx + lx) * 0.75, gz * 0.75, lod + 41);
          const isCliffCandidate = (isMountainOrRock && grade > 0.40) || grade > 0.60;

          if (isCliffCandidate && cliffNoise > -0.15) {
            // Stepped rocky ledge: sharpens slope into crags and cliff breaks
            const stepPhase = Math.sin(aboveSea * 0.12 + cliffNoise * 3.0);
            const ledgeAmp = Math.min(32 * lodDecay, slopeYds * 0.45);
            const nextH = Math.round(hC + stepPhase * ledgeAmp);
            heights[idx] = Math.max(seaLevel + 1, Math.min(10000, nextH));

            // Expose bare rock on sheer cliff faces (soil/grass cannot cling to near-vertical drops)
            if (grade > 0.62 && biome !== 7) {
              biomes[idx] = 3; // Rock
            }
          } else {
            // Rolling smoothed slopes & swales for hills, grasslands, and gentle terrain
            const maxRelief = isMountainOrRock ? 18 * lodDecay : 8 * lodDecay;
            const relFactor = isMountainOrRock ? 0.04 : 0.018;
            const amp = Math.min(maxRelief, aboveSea * relFactor);
            heights[idx] = Math.max(seaLevel + 1, Math.min(10000, Math.round(hC + n * amp)));
          }
        }
      }
    }

    const created: TerrainChunk = { lod, cx, cz, heights, biomes, waterFlags, rainfall };
    this.levels[lod].set(key, created);
    if (outCreated) outCreated.push(created);
    return true;
  }

  private static smoothNoise2D(x: number, z: number, seed: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const n00 = QWorldChunkTree.hash2D(x0, z0, seed);
    const n10 = QWorldChunkTree.hash2D(x0 + 1, z0, seed);
    const n01 = QWorldChunkTree.hash2D(x0, z0 + 1, seed);
    const n11 = QWorldChunkTree.hash2D(x0 + 1, z0 + 1, seed);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return nx0 + (nx1 - nx0) * v;
  }

  private static hash2D(gx: number, gz: number, seed: number): number {
    let h = Math.imul(gx, 374761393) + Math.imul(gz, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h & 0xffff) / 32767.5 - 1.0; // [-1, 1]
  }

  private sampleBilinearHeight(lod: number, gx: number, gz: number): number {
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const cx = Math.floor(ix / CHUNK_SIZE);
    const cz = Math.floor(iz / CHUNK_SIZE);
    const chunk = this.levels[lod].get(QWorldChunkTree.packKey(cx, cz));
    if (!chunk) return DEFAULT_SEA_LEVEL;
    const lx = ix - cx * CHUNK_SIZE;
    const lz = iz - cz * CHUNK_SIZE;
    return chunk.heights[lz * CHUNK_SIZE + lx];
  }
}
