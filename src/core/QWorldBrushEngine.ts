import { QWorldChunkTree, CHUNK_SIZE, MAX_LOD } from './QWorldChunkTree';

export type ElevationBrushMode = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface ElevationBrushParams {
  lod: number;
  worldX: number;
  worldZ: number;
  radiusWorld: number;
  mode: ElevationBrushMode;
  strength: number;
  targetHeight?: number;
}

export interface BiomeBrushParams {
  lod: number;
  worldX: number;
  worldZ: number;
  radiusWorld: number;
  biomeId: number;
}

export class QWorldBrushEngine {
  private readonly tree: QWorldChunkTree;

  constructor(tree: QWorldChunkTree) {
    this.tree = tree;
  }

  public applyElevationBrush(params: ElevationBrushParams): void {
    const { lod, worldX, worldZ, radiusWorld, mode, strength, targetHeight = 0 } = params;
    const spacing = this.tree.getSampleSpacing(lod);
    const minGx = Math.floor((worldX - radiusWorld) / spacing);
    const maxGx = Math.ceil((worldX + radiusWorld) / spacing);
    const minGz = Math.floor((worldZ - radiusWorld) / spacing);
    const maxGz = Math.ceil((worldZ + radiusWorld) / spacing);
    const radiusSq = radiusWorld * radiusWorld;

    const minCx = Math.floor(minGx / CHUNK_SIZE);
    const maxCx = Math.floor(maxGx / CHUNK_SIZE);
    const minCz = Math.floor(minGz / CHUNK_SIZE);
    const maxCz = Math.floor(maxGz / CHUNK_SIZE);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.tree.getOrCreateChunk(lod, cx, cz);
        const startLx = Math.max(0, minGx - cx * CHUNK_SIZE);
        const endLx = Math.min(CHUNK_SIZE - 1, maxGx - cx * CHUNK_SIZE);
        const startLz = Math.max(0, minGz - cz * CHUNK_SIZE);
        const endLz = Math.min(CHUNK_SIZE - 1, maxGz - cz * CHUNK_SIZE);

        for (let lz = startLz; lz <= endLz; lz++) {
          const wz = (cz * CHUNK_SIZE + lz) * spacing;
          const dz = wz - worldZ;
          const dzSq = dz * dz;

          for (let lx = startLx; lx <= endLx; lx++) {
            const wx = (cx * CHUNK_SIZE + lx) * spacing;
            const dx = wx - worldX;
            const distSq = dx * dx + dzSq;
            if (distSq > radiusSq) continue;

            const t = Math.sqrt(distSq) / radiusWorld;
            const falloff = 1 - (3 * t * t - 2 * t * t * t);
            const idx = lz * CHUNK_SIZE + lx;
            const current = chunk.heights[idx];

            let next = current;
            if (mode === 'raise') {
              next = current + strength * falloff;
            } else if (mode === 'lower') {
              next = current - strength * falloff;
            } else if (mode === 'flatten') {
              const blend = Math.min(1, strength * falloff);
              next = current + (targetHeight - current) * blend;
            } else if (mode === 'smooth') {
              const avg = this.sampleLocalAverage(chunk.heights, lx, lz);
              next = current + (avg - current) * Math.min(1, strength * falloff);
            }

            chunk.heights[idx] = Math.max(-10000, Math.min(10000, Math.round(next)));
          }
        }
      }
    }

    if (lod > 0) {
      this.tree.rollupToParent(lod, minGx, maxGx, minGz, maxGz);
    }
    if (lod < MAX_LOD) {
      this.tree.invalidateDescendants(lod, minGx, maxGx, minGz, maxGz);
    }
  }

  public applyBiomeBrush(params: BiomeBrushParams): void {
    const { lod, worldX, worldZ, radiusWorld, biomeId } = params;
    const spacing = this.tree.getSampleSpacing(lod);
    const minGx = Math.floor((worldX - radiusWorld) / spacing);
    const maxGx = Math.ceil((worldX + radiusWorld) / spacing);
    const minGz = Math.floor((worldZ - radiusWorld) / spacing);
    const maxGz = Math.ceil((worldZ + radiusWorld) / spacing);
    const radiusSq = radiusWorld * radiusWorld;

    const minCx = Math.floor(minGx / CHUNK_SIZE);
    const maxCx = Math.floor(maxGx / CHUNK_SIZE);
    const minCz = Math.floor(minGz / CHUNK_SIZE);
    const maxCz = Math.floor(maxGz / CHUNK_SIZE);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.tree.getOrCreateChunk(lod, cx, cz);
        const startLx = Math.max(0, minGx - cx * CHUNK_SIZE);
        const endLx = Math.min(CHUNK_SIZE - 1, maxGx - cx * CHUNK_SIZE);
        const startLz = Math.max(0, minGz - cz * CHUNK_SIZE);
        const endLz = Math.min(CHUNK_SIZE - 1, maxGz - cz * CHUNK_SIZE);

        for (let lz = startLz; lz <= endLz; lz++) {
          const wz = (cz * CHUNK_SIZE + lz) * spacing;
          const dz = wz - worldZ;
          const dzSq = dz * dz;

          for (let lx = startLx; lx <= endLx; lx++) {
            const wx = (cx * CHUNK_SIZE + lx) * spacing;
            const dx = wx - worldX;
            if (dx * dx + dzSq <= radiusSq) {
              chunk.biomes[lz * CHUNK_SIZE + lx] = biomeId;
            }
          }
        }
      }
    }

    if (lod > 0) {
      this.tree.rollupToParent(lod, minGx, maxGx, minGz, maxGz);
    }
    if (lod < MAX_LOD) {
      this.tree.invalidateDescendants(lod, minGx, maxGx, minGz, maxGz);
    }
  }

  private sampleLocalAverage(heights: Int16Array, lx: number, lz: number): number {
    let sum = 0;
    let count = 0;
    for (let oz = -1; oz <= 1; oz++) {
      const nz = lz + oz;
      if (nz < 0 || nz >= CHUNK_SIZE) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const nx = lx + ox;
        if (nx < 0 || nx >= CHUNK_SIZE) continue;
        sum += heights[nz * CHUNK_SIZE + nx];
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }
}
