import {
  PLANET_RADIUS_YARDS,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from './QWorldChunkTree';

export const GLOBE_Y_SCALE = 0.65;
const HALF_PI = Math.PI * 0.5;
const HALF_WORLD_SPAN_X = WORLD_SPAN_X * 0.5;
const HALF_WORLD_SPAN_Z = WORLD_SPAN_Z * 0.5;
const INV_PLANET_RADIUS = 1 / PLANET_RADIUS_YARDS;
const GLOBE_BLEND_MIN_DIST = 20000;
const GLOBE_BLEND_MAX_DIST = 700000;

let cachedTargetZ = Number.NaN;
let cachedCosT = 1;
let cachedSinT = 0;

function updateTargetTrig(targetZ: number): void {
  if (targetZ === cachedTargetZ) return;
  const targetLat = computeGlobeTargetLatRad(targetZ);
  cachedCosT = Math.cos(targetLat);
  cachedSinT = Math.sin(targetLat);
  cachedTargetZ = targetZ;
}

export interface GlobeVector3Target {
  set(x: number, y: number, z: number): unknown;
}

export interface GlobeSurfaceCoords {
  wx: number;
  wz: number;
}

/**
 * Wraps a longitudinal X delta into [-WORLD_SPAN_X / 2, WORLD_SPAN_X / 2).
 */
export function wrapDeltaX(dx: number): number {
  if (dx >= -HALF_WORLD_SPAN_X && dx < HALF_WORLD_SPAN_X) return dx;
  return ((((dx + HALF_WORLD_SPAN_X) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X) - HALF_WORLD_SPAN_X;
}

/**
 * Smoothly blends between flat terrain (0) and full spherical globe (1) across L1 -> L0.
 */
export function computeGlobeBlend(distance: number): number {
  const t = Math.max(
    0,
    Math.min(1, (distance - GLOBE_BLEND_MIN_DIST) / (GLOBE_BLEND_MAX_DIST - GLOBE_BLEND_MIN_DIST))
  );
  return t * t * (3 - 2 * t);
}

/**
 * Converts a flat world Z coordinate into spherical latitude radians in [-PI/2, PI/2].
 */
export function computeGlobePointLatRad(wz: number): number {
  const raw = (wz - HALF_WORLD_SPAN_Z) * INV_PLANET_RADIUS;
  return raw < -HALF_PI ? -HALF_PI : raw > HALF_PI ? HALF_PI : raw;
}

/**
 * Converts camera target Z into the planet pitch angle (latitude) centered under the camera.
 */
export function computeGlobeTargetLatRad(targetZ: number): number {
  const raw = (targetZ - HALF_WORLD_SPAN_Z) * INV_PLANET_RADIUS;
  return raw < -HALF_PI ? -HALF_PI : raw > HALF_PI ? HALF_PI : raw;
}

/**
 * Returns the cosine of the spherical angle between (wx, wz) and the camera sub-point (targetX, targetZ).
 */
export function computeGlobeFrontCos(
  wx: number,
  wz: number,
  targetX: number,
  targetZ: number
): number {
  updateTargetTrig(targetZ);
  const lon = (wx - targetX) * INV_PLANET_RADIUS;
  const rawLat = (wz - HALF_WORLD_SPAN_Z) * INV_PLANET_RADIUS;
  const phi = rawLat < -HALF_PI ? -HALF_PI : rawLat > HALF_PI ? HALF_PI : rawLat;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi));
  return cosPhi * Math.cos(lon) * cachedCosT + sinPhi * cachedSinT;
}

/**
 * Tests whether a world point lies on the visible front hemisphere of the tilted globe.
 */
export function isGlobePointVisible(
  wx: number,
  wz: number,
  targetX: number,
  targetZ: number,
  globeBlend: number
): boolean {
  if (globeBlend <= 0.5) return true;
  return computeGlobeFrontCos(wx, wz, targetX, targetZ) >= -0.02;
}

/**
 * Projects flat world coordinates (wx, wy, wz) onto the 3D tilted globe ellipsoid blended by globeBlend.
 */
export function projectWorldToGlobe(
  wx: number,
  wy: number,
  wz: number,
  targetX: number,
  targetZ: number,
  globeBlend: number,
  out: GlobeVector3Target
): void {
  if (globeBlend <= 0.001) {
    out.set(wx, wy, wz);
    return;
  }

  updateTargetTrig(targetZ);
  const lon = (wx - targetX) * INV_PLANET_RADIUS;
  const rawLat = (wz - HALF_WORLD_SPAN_Z) * INV_PLANET_RADIUS;
  const lat = rawLat < -HALF_PI ? -HALF_PI : rawLat > HALF_PI ? HALF_PI : rawLat;
  const r = PLANET_RADIUS_YARDS + wy;

  const sinLat = Math.sin(lat);
  const cosLat = Math.sqrt(Math.max(0, 1 - sinLat * sinLat));
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  const cosT = cachedCosT;
  const sinT = cachedSinT;

  const px = r * cosLat * sinLon;
  const py = r * cosLat * cosLon;
  const pz = r * sinLat;

  const rotZ = pz * cosT - py * sinT;
  const rotY = py * cosT + pz * sinT;

  const sX = targetX + px;
  const sZ = targetZ + rotZ;
  const sY = GLOBE_Y_SCALE * rotY - PLANET_RADIUS_YARDS;

  if (globeBlend >= 0.9999) {
    out.set(sX, sY, sZ);
    return;
  }
  out.set(
    wx + (sX - wx) * globeBlend,
    wy + (sY - wy) * globeBlend,
    wz + (sZ - wz) * globeBlend
  );
}

/**
 * Intersects a 3D ray with the sea-level tilted globe ellipsoid and recovers flat world (wx, wz).
 */
export function intersectGlobeEllipsoid(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  targetX: number,
  targetZ: number,
  out: GlobeSurfaceCoords
): boolean {
  const r = PLANET_RADIUS_YARDS;
  const ox = originX - targetX;
  const oy = (originY + r) / GLOBE_Y_SCALE;
  const oz = originZ - targetZ;
  const dy = dirY / GLOBE_Y_SCALE;

  const a = dirX * dirX + dy * dy + dirZ * dirZ;
  if (a <= 1e-18) return false;

  const b = 2 * (ox * dirX + oy * dy + oz * dirZ);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;

  const sqrtDisc = Math.sqrt(disc);
  let t = (-b - sqrtDisc) / (2 * a);
  if (t <= 0) {
    t = (-b + sqrtDisc) / (2 * a);
    if (t <= 0) return false;
  }

  const px = ox + t * dirX;
  const rotY = oy + t * dy;
  const rotZ = oz + t * dirZ;

  updateTargetTrig(targetZ);
  const cosT = cachedCosT;
  const sinT = cachedSinT;

  const py = rotY * cosT - rotZ * sinT;
  const pz = rotZ * cosT + rotY * sinT;

  const lat = Math.asin(Math.max(-1, Math.min(1, pz / r)));
  const lon = Math.atan2(px, py);

  out.wx = targetX + lon * r;
  out.wz = Math.max(0, Math.min(WORLD_SPAN_Z, HALF_WORLD_SPAN_Z + lat * r));
  return true;
}
