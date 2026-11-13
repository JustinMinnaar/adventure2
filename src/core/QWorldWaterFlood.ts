import { QWorldChunkTree, CHUNK_SIZE, TerrainChunk } from './QWorldChunkTree';

export const WATER_DRY = 0;
export const WATER_OCEAN = 1;

export interface OceanSeedCell {
  cx: number;
  cz: number;
  lx: number;
  lz: number;
}

export interface ChunkRange {
  minCx: number;
  maxCx: number;
  minCz: number;
  maxCz: number;
}

export class QWorldWaterFlood {
  private readonly tree: QWorldChunkTree;
  public seaLevel: number;

  constructor(tree: QWorldChunkTree, seaLevel: number = 0) {
    this.tree = tree;
    this.seaLevel = seaLevel;
  }

  /**
   * Incremental BFS flood-fill from ocean seeds into connected cells with height <= seaLevel.
   * Enclosed depressions surrounded by terrain > seaLevel are never reached and stay dry.
   */
  public propagateFromSeeds(lod: number, seeds: OceanSeedCell[]): number {
    const capacity = Math.max(4096, this.tree.getStoredChunkCount(lod) * CHUNK_SIZE * CHUNK_SIZE);
    const queueCx = new Int32Array(capacity);
    const queueCz = new Int32Array(capacity);
    const queueIdx = new Int32Array(capacity);
    let head = 0;
    let tail = 0;
    let floodedCount = 0;

    for (const s of seeds) {
      const chunk = this.tree.getChunk(lod, s.cx, s.cz);
      if (!chunk) continue;
      const idx = s.lz * CHUNK_SIZE + s.lx;
      if (chunk.heights[idx] <= this.seaLevel) {
        if (chunk.waterFlags[idx] !== WATER_OCEAN) {
          chunk.waterFlags[idx] = WATER_OCEAN;
          floodedCount++;
        }
        queueCx[tail] = s.cx;
        queueCz[tail] = s.cz;
        queueIdx[tail] = idx;
        tail++;
      }
    }

    let cachedCx = Number.NaN;
    let cachedCz = Number.NaN;
    let cachedChunk: TerrainChunk | undefined;

    while (head < tail) {
      const cx = queueCx[head];
      const cz = queueCz[head];
      const idx = queueIdx[head];
      head++;

      const lx = idx % CHUNK_SIZE;
      const lz = (idx / CHUNK_SIZE) | 0;

      // Fast interior path: all 4 neighbors stay within the same chunk
      if (lx > 0 && lx < CHUNK_SIZE - 1 && lz > 0 && lz < CHUNK_SIZE - 1) {
        if (cx !== cachedCx || cz !== cachedCz) {
          cachedCx = cx;
          cachedCz = cz;
          cachedChunk = this.tree.getChunk(lod, cx, cz);
        }
        if (!cachedChunk) continue;
        const wf = cachedChunk.waterFlags;
        const h = cachedChunk.heights;
        const sl = this.seaLevel;

        const rIdx = idx + 1;
        if (wf[rIdx] !== WATER_OCEAN && h[rIdx] <= sl) {
          wf[rIdx] = WATER_OCEAN;
          floodedCount++;
          queueCx[tail] = cx; queueCz[tail] = cz; queueIdx[tail++] = rIdx;
        }
        const lIdx = idx - 1;
        if (wf[lIdx] !== WATER_OCEAN && h[lIdx] <= sl) {
          wf[lIdx] = WATER_OCEAN;
          floodedCount++;
          queueCx[tail] = cx; queueCz[tail] = cz; queueIdx[tail++] = lIdx;
        }
        const dIdx = idx + CHUNK_SIZE;
        if (wf[dIdx] !== WATER_OCEAN && h[dIdx] <= sl) {
          wf[dIdx] = WATER_OCEAN;
          floodedCount++;
          queueCx[tail] = cx; queueCz[tail] = cz; queueIdx[tail++] = dIdx;
        }
        const uIdx = idx - CHUNK_SIZE;
        if (wf[uIdx] !== WATER_OCEAN && h[uIdx] <= sl) {
          wf[uIdx] = WATER_OCEAN;
          floodedCount++;
          queueCx[tail] = cx; queueCz[tail] = cz; queueIdx[tail++] = uIdx;
        }
        continue;
      }

      // Boundary path: check 4 neighbors with chunk wrapping
      for (let d = 0; d < 4; d++) {
        let nx = lx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        let nz = lz + (d === 2 ? 1 : d === 3 ? -1 : 0);
        let ncx = cx;
        let ncz = cz;

        if (nx < 0) { ncx--; nx = CHUNK_SIZE - 1; }
        else if (nx >= CHUNK_SIZE) { ncx++; nx = 0; }
        if (nz < 0) { ncz--; nz = CHUNK_SIZE - 1; }
        else if (nz >= CHUNK_SIZE) { ncz++; nz = 0; }

        if (ncx !== cachedCx || ncz !== cachedCz) {
          cachedCx = ncx;
          cachedCz = ncz;
          cachedChunk = this.tree.getChunk(lod, ncx, ncz);
        }
        if (!cachedChunk) continue;

        const nIdx = nz * CHUNK_SIZE + nx;
        if (cachedChunk.waterFlags[nIdx] === WATER_OCEAN) continue;
        if (cachedChunk.heights[nIdx] > this.seaLevel) continue;

        cachedChunk.waterFlags[nIdx] = WATER_OCEAN;
        floodedCount++;
        queueCx[tail] = ncx;
        queueCz[tail] = ncz;
        queueIdx[tail] = nIdx;
        tail++;
      }
    }

    return floodedCount;
  }

  /**
   * Clears ocean flags in the modified chunk range and re-runs BFS from ocean seeds
   * so any cut-off bays drain cleanly.
   */
  public recomputeArea(lod: number, range: ChunkRange, seeds: OceanSeedCell[]): number {
    for (let cz = range.minCz; cz <= range.maxCz; cz++) {
      for (let cx = range.minCx; cx <= range.maxCx; cx++) {
        const chunk = this.tree.getChunk(lod, cx, cz);
        if (chunk) {
          chunk.waterFlags.fill(WATER_DRY);
        }
      }
    }
    return this.propagateFromSeeds(lod, seeds);
  }
}
