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

export type PolygonActionType = 'slope-raise' | 'lower' | 'flatten' | 'biome';

export interface PolygonActionParams {
  lod: number;
  polygon: { x: number; z: number }[];
  action: PolygonActionType;
  amount: number;
  biomeId?: number;
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

  public applyPolygonAction(params: PolygonActionParams): void {
    const { lod, polygon, action, amount, biomeId = 1 } = params;
    if (polygon.length < 3) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const spacing = this.tree.getSampleSpacing(lod);
    const minGx = Math.floor(minX / spacing);
    const maxGx = Math.ceil(maxX / spacing);
    const minGz = Math.floor(minZ / spacing);
    const maxGz = Math.ceil(maxZ / spacing);

    // For slope-raise, find max interior distance to polygon boundary so center=1.0, edge=0.0
    let maxEdgeDist = 1;
    if (action === 'slope-raise') {
      maxEdgeDist = 0;
      const step = Math.max(1, Math.floor(Math.max(maxGx - minGx, maxGz - minGz) / 64));
      for (let gz = minGz; gz <= maxGz; gz += step) {
        const wz = gz * spacing;
        for (let gx = minGx; gx <= maxGx; gx += step) {
          const wx = gx * spacing;
          if (!QWorldBrushEngine.pointInPolygon(wx, wz, polygon)) continue;
          const d = QWorldBrushEngine.distToPolygonEdges(wx, wz, polygon);
          if (d > maxEdgeDist) maxEdgeDist = d;
        }
      }
      if (maxEdgeDist <= 0) maxEdgeDist = 1;
    }

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
          for (let lx = startLx; lx <= endLx; lx++) {
            const wx = (cx * CHUNK_SIZE + lx) * spacing;
            if (!QWorldBrushEngine.pointInPolygon(wx, wz, polygon)) continue;

            const idx = lz * CHUNK_SIZE + lx;
            if (action === 'biome') {
              chunk.biomes[idx] = biomeId;
            } else if (action === 'flatten') {
              chunk.heights[idx] = Math.max(-10000, Math.min(10000, Math.round(amount)));
            } else if (action === 'lower') {
              chunk.heights[idx] = Math.max(-10000, Math.min(10000, chunk.heights[idx] - Math.round(amount)));
            } else if (action === 'slope-raise') {
              const d = QWorldBrushEngine.distToPolygonEdges(wx, wz, polygon);
              const t = Math.min(1, d / maxEdgeDist);
              const falloff = t * t * (3 - 2 * t);
              const next = chunk.heights[idx] + amount * falloff;
              chunk.heights[idx] = Math.max(-10000, Math.min(10000, Math.round(next)));
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

  private static pointInPolygon(x: number, z: number, poly: { x: number; z: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, zi = poly[i].z;
      const xj = poly[j].x, zj = poly[j].z;
      const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private static distToPolygonEdges(x: number, z: number, poly: { x: number; z: number }[]): number {
    let minDistSq = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j].x, az = poly[j].z;
      const bx = poly[i].x, bz = poly[i].z;
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx;
      const pz = az + t * dz;
      const dSq = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dSq < minDistSq) minDistSq = dSq;
    }
    return Math.sqrt(minDistSq);
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
