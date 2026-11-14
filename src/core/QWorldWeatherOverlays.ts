import * as THREE from 'three';
import {
  QWorldChunkTree,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from './QWorldChunkTree';
import { ELEVATION_SCALE } from './QWorldTerrainMesh';
import {
  ATMOS_NX,
  ATMOS_NZ,
  AtmosphereField,
  sampleAtmosFloatAtWorld,
} from './QWorldAtmosphere';
import { VolcanoSource, VolcanicFalloutResult } from './QWorldVolcanicFallout';

const CELL_SPAN_X = WORLD_SPAN_X / ATMOS_NX;
const CELL_SPAN_Z = WORLD_SPAN_Z / ATMOS_NZ;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function writeWindColor(
  warmth: number,
  anomaly: number,
  isHighAltitude: boolean,
  out: [number, number, number]
): void {
  if (isHighAltitude) {
    const t = clamp01(warmth);
    if (t < 0.5) {
      const k = t * 2;
      out[0] = 0.22 * (1 - k) + 0.98 * k;
      out[1] = 0.74 * (1 - k) + 0.92 * k;
      out[2] = 0.98 * (1 - k) + 0.45 * k;
    } else {
      const k = (t - 0.5) * 2;
      out[0] = 0.98;
      out[1] = 0.92 * (1 - k) + 0.38 * k;
      out[2] = 0.45 * (1 - k) + 0.42 * k;
    }
    return;
  }
  const thermal = clamp01((warmth - 0.45) * 0.8 + anomaly * 0.85 + 0.5);
  if (thermal < 0.5) {
    const k = thermal * 2;
    out[0] = 0.08 * (1 - k) + 0.65 * k;
    out[1] = 0.68 * (1 - k) + 0.85 * k;
    out[2] = 0.98 * (1 - k) + 0.92 * k;
  } else {
    const k = (thermal - 0.5) * 2;
    out[0] = 0.65 * (1 - k) + 0.98 * k;
    out[1] = 0.85 * (1 - k) + 0.36 * k;
    out[2] = 0.92 * (1 - k) + 0.12 * k;
  }
}

function appendArrowTriangles(
  pos: number[],
  col: number[],
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dz: number,
  length: number,
  rgb: [number, number, number]
): void {
  const px = -dz;
  const pz = dx;
  const halfLen = length * 0.5;
  const headBase = halfLen * 0.22;
  const shaftW = length * 0.085;
  const headW = length * 0.24;

  const tailX = cx - dx * halfLen;
  const tailZ = cz - dz * halfLen;
  const neckX = cx + dx * headBase;
  const neckZ = cz + dz * headBase;
  const tipX = cx + dx * halfLen;
  const tipZ = cz + dz * halfLen;

  // Shaft (2 triangles) + Arrowhead (1 triangle) = 9 vertices
  const verts = [
    tailX + px * shaftW, cy, tailZ + pz * shaftW,
    tailX - px * shaftW, cy, tailZ - pz * shaftW,
    neckX + px * shaftW, cy, neckZ + pz * shaftW,
    neckX + px * shaftW, cy, neckZ + pz * shaftW,
    tailX - px * shaftW, cy, tailZ - pz * shaftW,
    neckX - px * shaftW, cy, neckZ - pz * shaftW,
    neckX + px * headW, cy, neckZ + pz * headW,
    neckX - px * headW, cy, neckZ - pz * headW,
    tipX, cy, tipZ,
  ];
  for (let i = 0; i < verts.length; i += 3) {
    pos.push(verts[i], verts[i + 1], verts[i + 2]);
    col.push(rgb[0], rgb[1], rgb[2]);
  }
}

export function buildWindArrowGeometry(
  tree: QWorldChunkTree,
  atmos: AtmosphereField,
  isHighAltitude: boolean,
  cameraDistance: number,
  flatWater: boolean,
  seaLevel: number
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col: number[] = [];
  const rgb: [number, number, number] = [1, 1, 1];
  const stepX = 5;
  const stepZ = 4;
  const altLift = isHighAltitude
    ? Math.max(450, cameraDistance * 0.022)
    : Math.max(140, cameraDistance * 0.0085);
  const baseArrowLen = CELL_SPAN_X * 3.2;
  const uGrid = isHighAltitude ? atmos.highWindU : atmos.lowWindU;
  const vGrid = isHighAltitude ? atmos.highWindV : atmos.lowWindV;

  for (let az = 2; az < ATMOS_NZ - 1; az += stepZ) {
    const wz = (az + 0.5) * CELL_SPAN_Z;
    for (let ax = 2; ax < ATMOS_NX; ax += stepX) {
      const idx = az * ATMOS_NX + ax;
      const u = uGrid[idx];
      const v = vGrid[idx];
      const speed = Math.hypot(u, v);
      if (speed < 0.6) continue;

      const wx = (ax + 0.5) * CELL_SPAN_X;
      const surfaceY = tree.getSurfaceHeightAt(0, wx, wz, flatWater, seaLevel) * ELEVATION_SCALE;
      const arrowLen = baseArrowLen * (0.45 + 0.75 * clamp01(speed / (isHighAltitude ? 26 : 12)));
      writeWindColor(atmos.effectiveWarmth[idx], atmos.airTempAnomaly[idx], isHighAltitude, rgb);
      appendArrowTriangles(pos, col, wx, surfaceY + altLift, wz, u / speed, v / speed, arrowLen, rgb);
    }
  }

  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function appendDrapedQuad(
  pos: number[],
  col4: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  rgba: [number, number, number, number]
): void {
  pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
  for (let i = 0; i < 6; i++) {
    col4.push(rgba[0], rgba[1], rgba[2], rgba[3]);
  }
}

export function buildStormRiskGeometry(
  tree: QWorldChunkTree,
  atmos: AtmosphereField,
  cameraDistance: number,
  flatWater: boolean,
  seaLevel: number
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col4: number[] = [];
  const yLift = Math.max(95, cameraDistance * 0.0055);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];

  for (let az = 0; az < ATMOS_NZ; az++) {
    const z0 = az * CELL_SPAN_Z;
    const z1 = z0 + CELL_SPAN_Z;
    const wz = z0 + CELL_SPAN_Z * 0.5;
    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = az * ATMOS_NX + ax;
      const sByte = atmos.stormRisk[idx];
      const hByte = atmos.hurricaneRisk[idx];
      if (sByte < 95 && hByte < 65) continue;

      const x0 = ax * CELL_SPAN_X;
      const x1 = x0 + CELL_SPAN_X;
      const wx = x0 + CELL_SPAN_X * 0.5;
      const y = tree.getSurfaceHeightAt(0, wx, wz, flatWater, seaLevel) * ELEVATION_SCALE + yLift;

      if (hByte >= 65 && hByte >= sByte * 0.75) {
        const t = clamp01((hByte - 65) / 170);
        rgba[0] = 0.98;
        rgba[1] = 0.65 * (1 - t) + 0.14 * t;
        rgba[2] = 0.18 * (1 - t) + 0.45 * t;
        rgba[3] = 0.24 + 0.48 * t;
      } else {
        const t = clamp01((sByte - 95) / 150);
        rgba[0] = 0.24 * (1 - t) + 0.52 * t;
        rgba[1] = 0.72 * (1 - t) + 0.36 * t;
        rgba[2] = 0.98;
        rgba[3] = 0.18 + 0.38 * t;
      }
      appendDrapedQuad(pos, col4, x0, z0, x1, z1, y, rgba);
    }
  }

  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col4, 4));
  return geo;
}

export function buildFalloutOverlayGeometry(
  tree: QWorldChunkTree,
  fallout: VolcanicFalloutResult,
  cameraDistance: number,
  flatWater: boolean,
  seaLevel: number
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const col4: number[] = [];
  const yLift = Math.max(70, cameraDistance * 0.0042);
  const rgba: [number, number, number, number] = [0, 0, 0, 0];

  for (let az = 0; az < ATMOS_NZ; az++) {
    const z0 = az * CELL_SPAN_Z;
    const z1 = z0 + CELL_SPAN_Z;
    const wz = z0 + CELL_SPAN_Z * 0.5;
    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const ash = fallout.ashFallout[az * ATMOS_NX + ax];
      if (ash < 14) continue;
      const x0 = ax * CELL_SPAN_X;
      const x1 = x0 + CELL_SPAN_X;
      const wx = x0 + CELL_SPAN_X * 0.5;
      const y = tree.getSurfaceHeightAt(0, wx, wz, flatWater, seaLevel) * ELEVATION_SCALE + yLift;

      if (ash < 70) {
        const t = (ash - 14) / 56;
        rgba[0] = 0.92;
        rgba[1] = 0.72 * (1 - t) + 0.45 * t;
        rgba[2] = 0.16;
        rgba[3] = 0.18 + 0.22 * t;
      } else if (ash < 155) {
        const t = (ash - 70) / 85;
        rgba[0] = 0.92 * (1 - t) + 0.84 * t;
        rgba[1] = 0.45 * (1 - t) + 0.16 * t;
        rgba[2] = 0.14;
        rgba[3] = 0.40 + 0.22 * t;
      } else {
        const t = clamp01((ash - 155) / 100);
        rgba[0] = 0.84 * (1 - t) + 0.58 * t;
        rgba[1] = 0.16 * (1 - t) + 0.06 * t;
        rgba[2] = 0.14 * (1 - t) + 0.22 * t;
        rgba[3] = 0.62 + 0.18 * t;
      }
      appendDrapedQuad(pos, col4, x0, z0, x1, z1, y, rgba);
    }
  }

  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col4, 4));
  return geo;
}

export function buildVolcanoPlumesGeometry(
  tree: QWorldChunkTree,
  atmos: AtmosphereField,
  volcanoes: VolcanoSource[],
  cameraDistance: number,
  flatWater: boolean,
  seaLevel: number
): THREE.BufferGeometry | null {
  const active = volcanoes.filter((v) => v.active && v.magnitude > 0);
  if (active.length === 0) return null;

  const mergedPos: number[] = [];
  const mergedCol: number[] = [];
  const visualScale = Math.max(120, cameraDistance * 0.016);

  for (const v of active) {
    const baseY = tree.getSurfaceHeightAt(0, v.x, v.z, flatWater, seaLevel) * ELEVATION_SCALE;
    const wu = sampleAtmosFloatAtWorld(atmos.highWindU, v.x, v.z) * 0.6 +
      sampleAtmosFloatAtWorld(atmos.lowWindU, v.x, v.z) * 0.4;
    const wv = sampleAtmosFloatAtWorld(atmos.highWindV, v.x, v.z) * 0.6 +
      sampleAtmosFloatAtWorld(atmos.lowWindV, v.x, v.z) * 0.4;
    const puffs = 7;

    for (let p = 0; p < puffs; p++) {
      const frac = p / (puffs - 1);
      const radius = visualScale * (0.38 + frac * 1.45) * (0.6 + v.magnitude * 0.08);
      const puffGeo = new THREE.IcosahedronGeometry(radius, 0);
      const px = v.x + wu * visualScale * frac * 0.55;
      const pz = v.z + wv * visualScale * frac * 0.55;
      const py = baseY + visualScale * (0.45 + frac * 3.1);
      puffGeo.translate(px, py, pz);

      const pAttr = puffGeo.getAttribute('position');
      const rCol = p === 0 ? 0.96 : 0.22 - frac * 0.06;
      const gCol = p === 0 ? 0.36 : 0.19 - frac * 0.05;
      const bCol = p === 0 ? 0.08 : 0.20 - frac * 0.04;
      for (let k = 0; k < pAttr.count; k++) {
        mergedPos.push(pAttr.getX(k), pAttr.getY(k), pAttr.getZ(k));
        mergedCol.push(rCol, gCol, bCol);
      }
      puffGeo.dispose();
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(mergedPos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(mergedCol, 3));
  return out;
}
