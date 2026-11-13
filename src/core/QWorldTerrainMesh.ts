import * as THREE from 'three';
import { QWorldChunkTree, CHUNK_SIZE, CHUNK_AREA, WorldBounds } from './QWorldChunkTree';
import { WATER_OCEAN } from './QWorldWaterFlood';

export type TerrainRenderMode = 'biome' | 'heatmap';

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

export class QWorldTerrainMesh {
  private readonly tree: QWorldChunkTree;
  private readonly sharedIndices: Uint16Array;
  private readonly tempHeights = new Int16Array(CHUNK_AREA);
  private readonly tempBiomes = new Uint8Array(CHUNK_AREA);
  private readonly tempWater = new Uint8Array(CHUNK_AREA);

  constructor(tree: QWorldChunkTree) {
    this.tree = tree;
    this.sharedIndices = QWorldTerrainMesh.buildGridIndices(CHUNK_SIZE);
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
    mode: TerrainRenderMode = 'biome'
  ): THREE.BufferGeometry {
    this.tree.sampleChunkGrid(lod, cx, cz, this.tempHeights, this.tempBiomes, this.tempWater);
    const spacing = this.tree.getSampleSpacing(lod);
    const originX = cx * CHUNK_SIZE * spacing;
    const originZ = cz * CHUNK_SIZE * spacing;
    const elevScale = 0.05;

    const positions = new Float32Array(CHUNK_AREA * 3);
    const colors = new Float32Array(CHUNK_AREA * 3);
    const normals = new Float32Array(CHUNK_AREA * 3);
    const invTwoSpacing = 1 / (2 * spacing);

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = originZ + lz * spacing;
      const zUp = lz > 0 ? lz - 1 : 0;
      const zDown = lz < CHUNK_SIZE - 1 ? lz + 1 : CHUNK_SIZE - 1;

      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = lz * CHUNK_SIZE + lx;
        const h = this.tempHeights[idx];
        const b = this.tempBiomes[idx];
        const w = this.tempWater[idx];

        const p3 = idx * 3;
        positions[p3] = originX + lx * spacing;
        positions[p3 + 1] = h * elevScale;
        positions[p3 + 2] = wz;

        // Fast analytical normal from central height differences
        const xLeft = lx > 0 ? lx - 1 : 0;
        const xRight = lx < CHUNK_SIZE - 1 ? lx + 1 : CHUNK_SIZE - 1;
        const dhdx = (this.tempHeights[lz * CHUNK_SIZE + xRight] - this.tempHeights[lz * CHUNK_SIZE + xLeft]) * elevScale * invTwoSpacing;
        const dhdz = (this.tempHeights[zDown * CHUNK_SIZE + lx] - this.tempHeights[zUp * CHUNK_SIZE + lx]) * elevScale * invTwoSpacing;
        const nx = -dhdx;
        const ny = 1;
        const nz = -dhdz;
        const invLen = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        normals[p3] = nx * invLen;
        normals[p3 + 1] = ny * invLen;
        normals[p3 + 2] = nz * invLen;

        if (w === WATER_OCEAN) {
          colors[p3] = 0.05;
          colors[p3 + 1] = 0.35;
          colors[p3 + 2] = 0.68;
        } else if (mode === 'heatmap') {
          const norm = Math.max(0, Math.min(1, (h + 1000) / 2000));
          colors[p3] = norm;
          colors[p3 + 1] = 1 - Math.abs(norm - 0.5) * 1.6;
          colors[p3 + 2] = 1 - norm;
        } else {
          // 5-tap cross blend smooths discrete biome borders against triangle sawtooth artifacts
          const c0 = BIOME_COLORS[b] ?? BIOME_COLORS[0];
          const cL = BIOME_COLORS[this.tempBiomes[lz * CHUNK_SIZE + xLeft]] ?? c0;
          const cR = BIOME_COLORS[this.tempBiomes[lz * CHUNK_SIZE + xRight]] ?? c0;
          const cU = BIOME_COLORS[this.tempBiomes[zUp * CHUNK_SIZE + lx]] ?? c0;
          const cD = BIOME_COLORS[this.tempBiomes[zDown * CHUNK_SIZE + lx]] ?? c0;
          const shade = Math.max(0.65, Math.min(1.25, 0.9 + h * 0.0003));
          colors[p3] = Math.min(1, (c0[0] * 0.6 + (cL[0] + cR[0] + cU[0] + cD[0]) * 0.1) * shade);
          colors[p3 + 1] = Math.min(1, (c0[1] * 0.6 + (cL[1] + cR[1] + cU[1] + cD[1]) * 0.1) * shade);
          colors[p3 + 2] = Math.min(1, (c0[2] * 0.6 + (cL[2] + cR[2] + cU[2] + cD[2]) * 0.1) * shade);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.sharedIndices, 1));
    return geometry;
  }

  public buildVisibleRing(
    lod: number,
    centerCx: number,
    centerCz: number,
    ringRadius: number,
    mode: TerrainRenderMode
  ): THREE.BufferGeometry[] {
    const geometries: THREE.BufferGeometry[] = [];
    for (let cz = centerCz - ringRadius; cz <= centerCz + ringRadius; cz++) {
      for (let cx = centerCx - ringRadius; cx <= centerCx + ringRadius; cx++) {
        geometries.push(this.buildChunkGeometry(lod, cx, cz, mode));
      }
    }
    return geometries;
  }

  public collectVisiblePropTransforms(
    lod: number,
    bounds: WorldBounds,
    maxCount: number = 5000
  ): PropTransform[] {
    if (lod < 7) return [];

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
            if (this.tempWater[idx] === WATER_OCEAN) continue;

            const wx = originX + lx * spacing;
            if (wx < bounds.minX || wx > bounds.maxX) continue;

            transforms.push({
              x: wx,
              y: this.tempHeights[idx] * 0.05,
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
