export const CHUNK_SIZE = 81;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const MIN_LOD = 0;
export const MAX_LOD = 9;
export const DEFAULT_SEA_LEVEL = 0;

// Power-of-3 world-unit spacing per sample across L0 (world) -> L9 (people/1yd)
const LOD_SPACING = [19683, 6561, 2187, 729, 243, 81, 27, 9, 3, 1] as const;

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
}

export class QWorldChunkTree {
  private levels: Map<number, TerrainChunk>[] = Array.from(
    { length: MAX_LOD + 1 },
    () => new Map<number, TerrainChunk>()
  );

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

  public getChunk(lod: number, cx: number, cz: number): TerrainChunk | undefined {
    return this.levels[lod]?.get(QWorldChunkTree.packKey(cx, cz));
  }

  public getOrCreateChunk(lod: number, cx: number, cz: number, defaultWaterFlag: number = 0): TerrainChunk {
    const key = QWorldChunkTree.packKey(cx, cz);
    const existing = this.levels[lod].get(key);
    if (existing) return existing;

    const heights = new Int16Array(CHUNK_AREA);
    const biomes = new Uint8Array(CHUNK_AREA);
    const waterFlags = new Uint8Array(CHUNK_AREA);

    // Initialize from nearest ancestor if one exists
    if (lod > 0) {
      let hasAncestor = false;
      for (let l = lod - 1; l >= MIN_LOD; l--) {
        if (this.levels[l].size > 0) {
          hasAncestor = true;
          break;
        }
      }
      this.sampleChunkGrid(lod, cx, cz, heights, biomes, hasAncestor ? waterFlags : undefined);
      if (!hasAncestor && defaultWaterFlag !== 0) {
        waterFlags.fill(defaultWaterFlag);
      }
    } else {
      heights.fill(DEFAULT_SEA_LEVEL);
      waterFlags.fill(1); // L0 baseline at sea level (0) is ocean
    }

    const chunk: TerrainChunk = { lod, cx, cz, heights, biomes, waterFlags };
    this.levels[lod].set(key, chunk);
    return chunk;
  }

  public getHeightAt(lod: number, worldX: number, worldZ: number): number {
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = worldX / spacing;
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

  public getBiomeAt(lod: number, worldX: number, worldZ: number): number {
    for (let l = lod; l >= MIN_LOD; l--) {
      const spacing = LOD_SPACING[l];
      const gx = Math.floor(worldX / spacing);
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

  public setSampleAt(
    lod: number,
    worldX: number,
    worldZ: number,
    data: { height?: number; biome?: number; waterFlag?: number }
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
  }

  public sampleChunkGrid(
    lod: number,
    cx: number,
    cz: number,
    outHeights: Int16Array,
    outBiomes: Uint8Array,
    outWaterFlags?: Uint8Array
  ): void {
    const direct = this.getChunk(lod, cx, cz);
    if (direct) {
      outHeights.set(direct.heights);
      outBiomes.set(direct.biomes);
      if (outWaterFlags) outWaterFlags.set(direct.waterFlags);
      return;
    }

    const spacing = LOD_SPACING[lod];
    const originX = cx * CHUNK_SIZE * spacing;
    const originZ = cz * CHUNK_SIZE * spacing;

    // Find highest ancestor level that has any chunk covering this region
    let ancLod = -1;
    for (let l = lod - 1; l >= MIN_LOD; l--) {
      if (this.levels[l].size > 0) {
        ancLod = l;
        break;
      }
    }

    if (ancLod === -1) {
      outHeights.fill(DEFAULT_SEA_LEVEL);
      outBiomes.fill(0);
      if (outWaterFlags) outWaterFlags.fill(1); // Default height 0 is ocean
      return;
    }

    const ancSpacing = LOD_SPACING[ancLod];
    const ratio = spacing / ancSpacing;
    const ancMap = this.levels[ancLod];
    const halfRatioMinusHalf = 0.5 * ratio - 0.5;
    let lastAcx = Number.NaN;
    let lastAcz = Number.NaN;
    let lastAncChunk: TerrainChunk | undefined;

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
        const fx = (originX / ancSpacing) + lx * ratio + halfRatioMinusHalf;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const x1 = x0 + 1;
        const acx0 = Math.floor(x0 / CHUNK_SIZE);
        const acx1 = Math.floor(x1 / CHUNK_SIZE);
        const alx0 = x0 - acx0 * CHUNK_SIZE;
        const alx1 = x1 - acx1 * CHUNK_SIZE;
        const outIdx = lz * CHUNK_SIZE + lx;

        let h00 = DEFAULT_SEA_LEVEL, b00 = 0, wf00 = 1;
        let h10 = DEFAULT_SEA_LEVEL, b10 = 0, wf10 = 1;
        let h01 = DEFAULT_SEA_LEVEL, b01 = 0, wf01 = 1;
        let h11 = DEFAULT_SEA_LEVEL, b11 = 0, wf11 = 1;

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
          }
        } else {
          const c00 = ancMap.get(QWorldChunkTree.packKey(acx0, acz0));
          if (c00) { const i = alz0 * CHUNK_SIZE + alx0; h00 = c00.heights[i]; b00 = c00.biomes[i]; wf00 = c00.waterFlags[i]; }
          const c10 = ancMap.get(QWorldChunkTree.packKey(acx1, acz0));
          if (c10) { const i = alz0 * CHUNK_SIZE + alx1; h10 = c10.heights[i]; b10 = c10.biomes[i]; wf10 = c10.waterFlags[i]; }
          const c01 = ancMap.get(QWorldChunkTree.packKey(acx0, acz1));
          if (c01) { const i = alz1 * CHUNK_SIZE + alx0; h01 = c01.heights[i]; b01 = c01.biomes[i]; wf01 = c01.waterFlags[i]; }
          const c11 = ancMap.get(QWorldChunkTree.packKey(acx1, acz1));
          if (c11) { const i = alz1 * CHUNK_SIZE + alx1; h11 = c11.heights[i]; b11 = c11.biomes[i]; wf11 = c11.waterFlags[i]; }
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
    let lastCcx = Number.NaN;
    let lastCcz = Number.NaN;
    let lastChildChunk: TerrainChunk | undefined;

    let lastPcx = Number.NaN;
    let lastPcz = Number.NaN;
    let lastParentChunk: TerrainChunk | undefined;

    const biomeIds = new Uint8Array(9);
    const biomeCounts = new Uint8Array(9);
    const sampleHeights = new Int16Array(9);
    const sampleWeights = new Uint8Array(9);

    for (let pgz = minPGz; pgz <= maxPGz; pgz++) {
      const pcz = Math.floor(pgz / CHUNK_SIZE);
      const plz = pgz - pcz * CHUNK_SIZE;
      const pRowOffset = plz * CHUNK_SIZE;
      const baseCgz = pgz * 3;

      for (let pgx = minPGx; pgx <= maxPGx; pgx++) {
        const pcx = Math.floor(pgx / CHUNK_SIZE);
        const plx = pgx - pcx * CHUNK_SIZE;

        if (pcx !== lastPcx || pcz !== lastPcz) {
          lastPcx = pcx;
          lastPcz = pcz;
          lastParentChunk = this.getOrCreateChunk(parentLod, pcx, pcz, 1);
        }
        const pIdx = pRowOffset + plx;
        const fallbackH = lastParentChunk!.heights[pIdx];
        const fallbackB = lastParentChunk!.biomes[pIdx];
        const fallbackW = lastParentChunk!.waterFlags[pIdx];
        const baseCgx = pgx * 3;

        let sampleCount = 0;
        let oceanCount = 0;
        let uniqueCount = 0;

        for (let dz = 0; dz < 3; dz++) {
          const cgz = baseCgz + dz;
          const ccz = Math.floor(cgz / CHUNK_SIZE);
          const clz = cgz - ccz * CHUNK_SIZE;
          const cRowOffset = clz * CHUNK_SIZE;

          for (let dx = 0; dx < 3; dx++) {
            const cgx = baseCgx + dx;
            const ccx = Math.floor(cgx / CHUNK_SIZE);
            const clx = cgx - ccx * CHUNK_SIZE;

            if (ccx !== lastCcx || ccz !== lastCcz) {
              lastCcx = ccx;
              lastCcz = ccz;
              lastChildChunk = childMap.get(QWorldChunkTree.packKey(ccx, ccz));
            }

            let h = fallbackH;
            let b = fallbackB;
            let w = fallbackW;
            if (lastChildChunk) {
              const cIdx = cRowOffset + clx;
              h = lastChildChunk.heights[cIdx];
              b = lastChildChunk.biomes[cIdx];
              w = lastChildChunk.waterFlags[cIdx];
            }
            sampleHeights[sampleCount] = h;
            sampleWeights[sampleCount] = dx === 1 && dz === 1 ? 3 : dx === 1 || dz === 1 ? 2 : 1;
            sampleCount++;
            if (w === 1) oceanCount++;

            // Track mode biome in 3x3 block without allocations
            let found = false;
            for (let k = 0; k < uniqueCount; k++) {
              if (biomeIds[k] === b) {
                biomeCounts[k]++;
                found = true;
                break;
              }
            }
            if (!found) {
              biomeIds[uniqueCount] = b;
              biomeCounts[uniqueCount] = 1;
              uniqueCount++;
            }
          }
        }

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

        let bestBiome = fallbackB;
        let bestCount = -1;
        for (let k = 0; k < uniqueCount; k++) {
          if (biomeCounts[k] > bestCount) {
            bestCount = biomeCounts[k];
            bestBiome = biomeIds[k];
          }
        }

        lastParentChunk!.heights[pIdx] = medianH;
        lastParentChunk!.biomes[pIdx] = bestBiome;
        lastParentChunk!.waterFlags[pIdx] = oceanCount >= 5 ? 1 : 0;
      }
    }

    if (parentLod > MIN_LOD) {
      this.rollupToParent(parentLod, minPGx, maxPGx, minPGz, maxPGz);
    }
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

      const minCx = Math.floor(minGx / CHUNK_SIZE);
      const maxCx = Math.floor(maxGx / CHUNK_SIZE);
      const minCz = Math.floor(minGz / CHUNK_SIZE);
      const maxCz = Math.floor(maxGz / CHUNK_SIZE);

      for (let cz = minCz; cz <= maxCz; cz++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          map.delete(QWorldChunkTree.packKey(cx, cz));
        }
      }
    }
  }

  /**
   * Deterministically refines a chunk when zooming into a finer LOD for the first time,
   * perturbing ocean/ground borders and inland relief, then storing it for consistency.
   * Empty ocean chunks are left virtual (unallocated).
   */
  public refineChunkOnZoom(lod: number, cx: number, cz: number): boolean {
    if (lod <= MIN_LOD || lod > MAX_LOD) return false;
    const key = QWorldChunkTree.packKey(cx, cz);
    if (this.levels[lod].has(key)) return false;

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
    this.sampleChunkGrid(lod, cx, cz, heights, biomes, waterFlags);

    // Leave pure flat ocean chunks virtual
    let hasLand = false;
    for (let i = 0; i < CHUNK_AREA; i++) {
      if (waterFlags[i] === 0 || heights[i] > 0) {
        hasLand = true;
        break;
      }
    }
    if (!hasLand) return false;

    const baseH = new Int16Array(heights);
    const baseW = new Uint8Array(waterFlags);
    const baseGx = cx * CHUNK_SIZE;
    const baseGz = cz * CHUNK_SIZE;

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

        const n = QWorldChunkTree.hash2D(baseGx + lx, gz, lod);

        if (isCoastBorder) {
          const nextH = Math.max(-10000, Math.min(10000, Math.round(baseH[idx] + n * 35)));
          heights[idx] = nextH;
          waterFlags[idx] = nextH <= DEFAULT_SEA_LEVEL ? 1 : 0;
          if (nextH > DEFAULT_SEA_LEVEL && biomes[idx] === 0) {
            biomes[idx] = 1; // Grass along newly raised coastal cells
          }
        } else if (baseH[idx] > DEFAULT_SEA_LEVEL) {
          const amp = Math.min(24, baseH[idx] * 0.08);
          heights[idx] = Math.max(1, Math.min(10000, Math.round(baseH[idx] + n * amp)));
        }
      }
    }

    this.levels[lod].set(key, { lod, cx, cz, heights, biomes, waterFlags });
    return true;
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
