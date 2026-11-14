import { WORLD_SPAN_X, WORLD_SPAN_Z } from './QWorldChunkTree';
import {
  ATMOS_NX,
  ATMOS_NZ,
  ATMOS_AREA,
  AtmosphereField,
  wrapAtmosX,
} from './QWorldAtmosphere';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface VolcanoSource {
  id: string;
  name: string;
  x: number;
  z: number;
  magnitude: number; // 1..8 (VEI-like scale)
  active: boolean;
}

export interface VolcanicFalloutResult {
  ashFallout: Uint8Array;
  skyVeil: Uint8Array;
  northLandAshPct: number;
  southLandAshPct: number;
}

export interface VolcanicSkySample {
  overheadVeil: number; // 0..1 overhead volcanic ash/aerosol dimming
  horizonGlowStrength: number; // 0..1 distant eruption / ash-wall glow on horizon
  horizonGlowAzimuthDeg: number; // 0..360 compass bearing toward glow
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function injectVolcanoUmbrellas(
  activeVolcanoes: VolcanoSource[],
  tropo: Float32Array,
  strato: Float32Array,
  deposit: Float32Array
): { northWeight: number; southWeight: number; maxMagnitude: number } {
  let northWeight = 0;
  let southWeight = 0;
  let maxMagnitude = 0;

  for (const v of activeVolcanoes) {
    const mag = clamp(v.magnitude, 1, 8);
    if (mag > maxMagnitude) maxMagnitude = mag;
    const wrappedX = ((v.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    const cx = (wrappedX / WORLD_SPAN_X) * ATMOS_NX;
    const cz = clamp((v.z / WORLD_SPAN_Z) * ATMOS_NZ, 0, ATMOS_NZ - 1);
    const strength = Math.pow(1.82, mag - 3) * 32;
    if (cz < ATMOS_NZ * 0.5) northWeight += strength;
    else southWeight += strength;

    const sigma = 0.7 + mag * 0.2;
    const sigmaSq = sigma * sigma;
    const rad = Math.ceil(sigma * 2.6);
    const zMin = Math.max(0, Math.floor(cz - rad));
    const zMax = Math.min(ATMOS_NZ - 1, Math.ceil(cz + rad));

    for (let az = zMin; az <= zMax; az++) {
      const dz = az + 0.5 - cz;
      for (let dx = -rad; dx <= rad; dx++) {
        const ax = wrapAtmosX(Math.floor(cx) + dx);
        const distSq = dx * dx + dz * dz;
        const w = Math.exp(-distSq / (2 * sigmaSq));
        if (w < 0.008) continue;
        const idx = az * ATMOS_NX + ax;
        tropo[idx] += strength * w * 1.05;
        strato[idx] += strength * w * 0.95;
        deposit[idx] += strength * w * 0.5;
      }
    }
  }
  return { northWeight, southWeight, maxMagnitude };
}

function buildBarrierPassTables(
  ridgeHeights: Float32Array,
  plumeCeiling: number
): { tropoPass: Float32Array; stratoPass: Float32Array } {
  const tropoPass = new Float32Array(ATMOS_AREA);
  const stratoPass = new Float32Array(ATMOS_AREA);
  const stratoCeiling = plumeCeiling * 1.25;
  for (let i = 0; i < ATMOS_AREA; i++) {
    const r = ridgeHeights[i];
    if (r <= 80) {
      tropoPass[i] = 1;
      stratoPass[i] = 1;
    } else {
      const rt = r / plumeCeiling;
      const rs = r / stratoCeiling;
      tropoPass[i] = Math.exp(-4.2 * rt * rt);
      stratoPass[i] = Math.exp(-3.4 * rs * rs);
    }
  }
  return { tropoPass, stratoPass };
}

function diffuseTroposphericCell(
  idx: number,
  rowOff: number,
  ax: number,
  zUp: number,
  zDn: number,
  diffMass: number,
  tropoPass: Float32Array,
  nextTropo: Float32Array,
  deposit: Float32Array
): void {
  const axL = ax > 0 ? ax - 1 : ATMOS_NX - 1;
  const axR = ax < ATMOS_NX - 1 ? ax + 1 : 0;
  const q = diffMass * 0.25;
  const pL = tropoPass[rowOff + axL];
  const pR = tropoPass[rowOff + axR];
  const pU = tropoPass[zUp * ATMOS_NX + ax];
  const pD = tropoPass[zDn * ATMOS_NX + ax];
  nextTropo[rowOff + axL] += q * pL;
  nextTropo[rowOff + axR] += q * pR;
  nextTropo[zUp * ATMOS_NX + ax] += q * pU;
  nextTropo[zDn * ATMOS_NX + ax] += q * pD;
  deposit[idx] += q * (4 - pL - pR - pU - pD) * 0.72;
}

function stepTroposphericAsh(
  atmos: AtmosphereField,
  tropoPass: Float32Array,
  tropo: Float32Array,
  nextTropo: Float32Array,
  deposit: Float32Array,
  northDominant: number,
  eddySpread: number
): void {
  nextTropo.fill(0);
  for (let az = 0; az < ATMOS_NZ; az++) {
    const isNorth = az < ATMOS_NZ * 0.5;
    const coldDomeV =
      northDominant > 0 && isNorth ? 3.8 : northDominant < 0 && !isNorth ? -3.8 : 0;
    const rowOff = az * ATMOS_NX;
    const zUp = Math.max(0, az - 1);
    const zDn = Math.min(ATMOS_NZ - 1, az + 1);

    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = rowOff + ax;
      const mass = tropo[idx];
      if (mass < 0.004) continue;
      const settle = mass * 0.042;
      deposit[idx] += settle;
      const moving = mass - settle;
      const diffBudget = moving * eddySpread;
      diffuseTroposphericCell(idx, rowOff, ax, zUp, zDn, diffBudget, tropoPass, nextTropo, deposit);

      const advBudget = moving - diffBudget;
      const u = atmos.lowWindU[idx] * 0.55 + atmos.highWindU[idx] * 0.38;
      const v = atmos.lowWindV[idx] * 0.68 + coldDomeV;
      const fx = clamp(u * 0.078, -0.85, 0.85);
      const fz = clamp(v * 0.078, -0.85, 0.85);
      const axL = ax > 0 ? ax - 1 : ATMOS_NX - 1;
      const axR = ax < ATMOS_NX - 1 ? ax + 1 : 0;
      const idxX = rowOff + (fx >= 0 ? axR : axL);
      const passX = tropoPass[idxX];
      const zonalMass = advBudget * Math.abs(fx) * (1 - Math.abs(fz) * 0.5);
      nextTropo[idxX] += zonalMass * passX;
      deposit[idx] += zonalMass * (1 - passX) * 0.65;

      const idxZ = (fz >= 0 ? zDn : zUp) * ATMOS_NX + ax;
      const passZ = tropoPass[idxZ];
      const meridMass = advBudget * Math.abs(fz);
      nextTropo[idxZ] += meridMass * passZ;
      const blockedZ = meridMass * (1 - passZ);
      deposit[idx] += blockedZ * 0.64;
      nextTropo[rowOff + axL] += blockedZ * 0.18 * tropoPass[rowOff + axL];
      nextTropo[rowOff + axR] += blockedZ * 0.18 * tropoPass[rowOff + axR];
      nextTropo[idx] += Math.max(0, advBudget - zonalMass - meridMass);
    }
  }
}

function stepStratosphericVeil(
  atmos: AtmosphereField,
  stratoPass: Float32Array,
  strato: Float32Array,
  nextStrato: Float32Array,
  nextTropo: Float32Array
): void {
  nextStrato.fill(0);
  const eqRow = ATMOS_NZ * 0.5;
  for (let az = 0; az < ATMOS_NZ; az++) {
    const nearItcz = Math.abs(az - eqRow) < 4 ? 0.25 : 1.0;
    const rowOff = az * ATMOS_NX;
    const zUp = Math.max(0, az - 1);
    const zDn = Math.min(ATMOS_NZ - 1, az + 1);

    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = rowOff + ax;
      const m = strato[idx];
      if (m < 0.004) continue;
      // Upper ash veil rains fine tephra down into the lower troposphere across the hemisphere
      const rainout = m * 0.045;
      nextTropo[idx] += rainout;
      const rem = m - rainout;

      const shiftX = clamp(atmos.highWindU[idx] * 0.21, -3.2, 3.2);
      const baseX = Math.floor(ax + shiftX);
      const fracX = ax + shiftX - baseX;
      const x0 = ((baseX % ATMOS_NX) + ATMOS_NX) % ATMOS_NX;
      const x1 = x0 < ATMOS_NX - 1 ? x0 + 1 : 0;
      const xEast = (ax + 3) % ATMOS_NX;

      const advMass = rem * 0.62;
      nextStrato[rowOff + x0] += advMass * (1 - fracX);
      nextStrato[rowOff + x1] += advMass * fracX;
      nextStrato[rowOff + xEast] += rem * 0.14 * stratoPass[rowOff + xEast];

      const passUp = stratoPass[zUp * ATMOS_NX + x0];
      const passDn = stratoPass[zDn * ATMOS_NX + x0] * (az < eqRow && zDn >= eqRow ? 0.06 : 1.0);
      const spread = rem * 0.12 * nearItcz;
      nextStrato[zUp * ATMOS_NX + x0] += spread * passUp;
      nextStrato[zDn * ATMOS_NX + x0] += spread * passDn;
      nextStrato[rowOff + x0] += spread * (2 - passUp - passDn);
    }
  }
}

function finalizeFalloutBuffers(
  atmos: AtmosphereField,
  deposit: Float32Array,
  tropo: Float32Array,
  strato: Float32Array
): VolcanicFalloutResult {
  const ashFallout = new Uint8Array(ATMOS_AREA);
  const skyVeil = new Uint8Array(ATMOS_AREA);
  let northLandTotal = 0;
  let northLandAsh = 0;
  let southLandTotal = 0;
  let southLandAsh = 0;

  for (let az = 0; az < ATMOS_NZ; az++) {
    const isNorth = az < ATMOS_NZ * 0.5;
    for (let ax = 0; ax < ATMOS_NX; ax++) {
      const idx = az * ATMOS_NX + ax;
      const rawAsh = (deposit[idx] + tropo[idx] * 0.35) * 0.06;
      const rawVeil = strato[idx] * 0.24 + tropo[idx] * 0.15;
      const ashByte = rawAsh > 0.002 ? Math.round(clamp01(1 - Math.exp(-rawAsh)) * 255) : 0;
      const veilByte = rawVeil > 0.002 ? Math.round(clamp01(1 - Math.exp(-rawVeil)) * 255) : 0;
      ashFallout[idx] = ashByte;
      skyVeil[idx] = veilByte;

      if (atmos.oceanMask[idx] === 0) {
        if (isNorth) {
          northLandTotal++;
          if (ashByte >= 25) northLandAsh++;
        } else {
          southLandTotal++;
          if (ashByte >= 25) southLandAsh++;
        }
      }
    }
  }

  return {
    ashFallout,
    skyVeil,
    northLandAshPct: northLandTotal > 0 ? Math.round((northLandAsh / northLandTotal) * 100) : 0,
    southLandAshPct: southLandTotal > 0 ? Math.round((southLandAsh / southLandTotal) * 100) : 0,
  };
}

export function computeVolcanicFallout(
  atmos: AtmosphereField,
  volcanoes: VolcanoSource[]
): VolcanicFalloutResult {
  const active = volcanoes.filter((v) => v.active && v.magnitude > 0);
  if (active.length === 0) {
    return {
      ashFallout: new Uint8Array(ATMOS_AREA),
      skyVeil: new Uint8Array(ATMOS_AREA),
      northLandAshPct: 0,
      southLandAshPct: 0,
    };
  }

  let tropo = new Float32Array(ATMOS_AREA);
  let nextTropo = new Float32Array(ATMOS_AREA);
  let strato = new Float32Array(ATMOS_AREA);
  let nextStrato = new Float32Array(ATMOS_AREA);
  const deposit = new Float32Array(ATMOS_AREA);

  const { northWeight, southWeight, maxMagnitude } = injectVolcanoUmbrellas(
    active,
    tropo,
    strato,
    deposit
  );
  const northDominant = northWeight > southWeight * 1.25 ? 1 : southWeight > northWeight * 1.25 ? -1 : 0;
  const plumeCeiling = 650 + maxMagnitude * 215;
  const { tropoPass, stratoPass } = buildBarrierPassTables(atmos.ridgeHeights, plumeCeiling);

  const steps = 38;
  const baseEddy = 0.19 + maxMagnitude * 0.036;
  for (let s = 0; s < steps; s++) {
    const eddySpread = s < 14 ? Math.min(0.64, baseEddy * 1.45) : baseEddy;
    stepTroposphericAsh(atmos, tropoPass, tropo, nextTropo, deposit, northDominant, eddySpread);
    const tmpT = tropo;
    tropo = nextTropo;
    nextTropo = tmpT;

    stepStratosphericVeil(atmos, stratoPass, strato, nextStrato, tropo);
    const tmpS = strato;
    strato = nextStrato;
    nextStrato = tmpS;
  }

  return finalizeFalloutBuffers(atmos, deposit, tropo, strato);
}

function computeGreatCircleBearingAndDeg(
  obsLatDeg: number,
  obsLonDeg: number,
  targetLatDeg: number,
  targetLonDeg: number
): { distanceDeg: number; azimuthDeg: number } {
  const lat1 = obsLatDeg * DEG_TO_RAD;
  const lat2 = targetLatDeg * DEG_TO_RAD;
  const dLon = (targetLonDeg - obsLonDeg) * DEG_TO_RAD;
  const sin1 = Math.sin(lat1);
  const cos1 = Math.cos(lat1);
  const sin2 = Math.sin(lat2);
  const cos2 = Math.cos(lat2);

  const cosDist = clamp(sin1 * sin2 + cos1 * cos2 * Math.cos(dLon), -1, 1);
  const distanceDeg = Math.acos(cosDist) * RAD_TO_DEG;
  const y = Math.sin(dLon) * cos2;
  const x = cos1 * sin2 - sin1 * cos2 * Math.cos(dLon);
  const az = (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
  return { distanceDeg, azimuthDeg: az };
}

export function sampleVolcanicSkyAtLatLon(
  fallout: VolcanicFalloutResult,
  volcanoes: VolcanoSource[],
  latitudeDeg: number,
  longitudeDeg: number
): VolcanicSkySample {
  const normLon = ((((longitudeDeg + 180) % 360) + 360) % 360) / 360;
  const normLat = clamp01((90 - latitudeDeg) / 180);
  const ax = wrapAtmosX(Math.floor(normLon * ATMOS_NX));
  const az = clamp(Math.floor(normLat * ATMOS_NZ), 0, ATMOS_NZ - 1);
  const overheadVeil = fallout.skyVeil[az * ATMOS_NX + ax] / 255;

  let bestStrength = 0;
  let bestAz = 0;
  for (const v of volcanoes) {
    if (!v.active || v.magnitude <= 0) continue;
    const vLat = 90 - clamp01(v.z / WORLD_SPAN_Z) * 180;
    const vLon = ((((v.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X) / WORLD_SPAN_X) * 360 - 180;
    const { distanceDeg, azimuthDeg } = computeGreatCircleBearingAndDeg(
      latitudeDeg,
      longitudeDeg,
      vLat,
      vLon
    );
    const reachDeg = 18 + v.magnitude * 6.5;
    if (distanceDeg < reachDeg) {
      const s = clamp01(1 - distanceDeg / reachDeg) * clamp01(v.magnitude / 8) * 0.85;
      if (s > bestStrength) {
        bestStrength = s;
        bestAz = azimuthDeg;
      }
    }
  }

  return {
    overheadVeil,
    horizonGlowStrength: bestStrength,
    horizonGlowAzimuthDeg: bestAz,
  };
}

export const SKY_VEIL_SYNC_NX = 36;
export const SKY_VEIL_SYNC_NZ = 18;

export interface SyncedVolcanoInfo {
  name: string;
  magnitude: number;
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface SyncedVolcanicSky {
  veilGrid36x18: number[] | null;
  activeVolcanoes: SyncedVolcanoInfo[];
}

export function packSkyVeilSyncGrid(skyVeil: Uint8Array): number[] {
  const out = new Array<number>(SKY_VEIL_SYNC_NX * SKY_VEIL_SYNC_NZ);
  const stepX = ATMOS_NX / SKY_VEIL_SYNC_NX; // 6
  const stepZ = ATMOS_NZ / SKY_VEIL_SYNC_NZ; // 6
  for (let sz = 0; sz < SKY_VEIL_SYNC_NZ; sz++) {
    for (let sx = 0; sx < SKY_VEIL_SYNC_NX; sx++) {
      let sum = 0;
      for (let dz = 0; dz < stepZ; dz++) {
        const row = (sz * stepZ + dz) * ATMOS_NX + sx * stepX;
        for (let dx = 0; dx < stepX; dx++) {
          sum += skyVeil[row + dx];
        }
      }
      out[sz * SKY_VEIL_SYNC_NX + sx] = Math.round(sum / (stepX * stepZ));
    }
  }
  return out;
}

function samplePackedVeilGrid(grid: number[], latitudeDeg: number, longitudeDeg: number): number {
  const normLon = ((((longitudeDeg + 180) % 360) + 360) % 360) / 360;
  const normLat = clamp01((90 - latitudeDeg) / 180);
  const fx = normLon * SKY_VEIL_SYNC_NX - 0.5;
  const fz = clamp(normLat * SKY_VEIL_SYNC_NZ - 0.5, 0, SKY_VEIL_SYNC_NZ - 1.0001);
  const x0 = ((Math.floor(fx) % SKY_VEIL_SYNC_NX) + SKY_VEIL_SYNC_NX) % SKY_VEIL_SYNC_NX;
  const x1 = (x0 + 1) % SKY_VEIL_SYNC_NX;
  const z0 = Math.floor(fz);
  const z1 = Math.min(SKY_VEIL_SYNC_NZ - 1, z0 + 1);
  const tx = fx - Math.floor(fx);
  const tz = fz - z0;
  const top = grid[z0 * SKY_VEIL_SYNC_NX + x0] * (1 - tx) + grid[z0 * SKY_VEIL_SYNC_NX + x1] * tx;
  const bot = grid[z1 * SKY_VEIL_SYNC_NX + x0] * (1 - tx) + grid[z1 * SKY_VEIL_SYNC_NX + x1] * tx;
  return clamp01((top * (1 - tz) + bot * tz) / 255);
}

export function sampleSyncedVolcanicSky(
  sync: SyncedVolcanicSky | null | undefined,
  latitudeDeg: number,
  longitudeDeg: number
): VolcanicSkySample {
  if (!sync) return { overheadVeil: 0, horizonGlowStrength: 0, horizonGlowAzimuthDeg: 0 };
  const grid = sync.veilGrid36x18;
  const overheadVeil =
    grid && grid.length === SKY_VEIL_SYNC_NX * SKY_VEIL_SYNC_NZ
      ? samplePackedVeilGrid(grid, latitudeDeg, longitudeDeg)
      : 0;

  let bestStrength = 0;
  let bestAz = 0;
  for (const v of sync.activeVolcanoes) {
    if (v.magnitude <= 0) continue;
    const { distanceDeg, azimuthDeg } = computeGreatCircleBearingAndDeg(
      latitudeDeg,
      longitudeDeg,
      v.latitudeDeg,
      v.longitudeDeg
    );
    const reachDeg = 18 + v.magnitude * 6.5;
    if (distanceDeg < reachDeg) {
      const s = clamp01(1 - distanceDeg / reachDeg) * clamp01(v.magnitude / 8) * 0.85;
      if (s > bestStrength) {
        bestStrength = s;
        bestAz = azimuthDeg;
      }
    }
  }
  return { overheadVeil, horizonGlowStrength: bestStrength, horizonGlowAzimuthDeg: bestAz };
}
