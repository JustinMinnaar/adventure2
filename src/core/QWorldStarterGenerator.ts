import {
  QWorldChunkTree,
  CHUNK_SIZE,
  WORLD_L0_CHUNKS_X,
  WORLD_L0_CHUNKS_Z,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from './QWorldChunkTree';
import { QWorldWaterFlood, OceanSeedCell } from './QWorldWaterFlood';
import { QWorldVectorTree, WorldPoint2D } from './QWorldVectorTree';

export function createRandomSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createValueNoise3D(rng: () => number): (x: number, y: number, z: number) => number {
  const size = 64;
  const mask = size - 1;
  const table = new Float32Array(size * size * size);
  for (let i = 0; i < table.length; i++) {
    table[i] = rng() * 2 - 1;
  }

  const sample = (ix: number, iy: number, iz: number): number => {
    const x = ix & mask;
    const y = iy & mask;
    const z = iz & mask;
    return table[(z * size + y) * size + x];
  };

  return (x: number, y: number, z: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

    const n000 = sample(x0, y0, z0);
    const n100 = sample(x0 + 1, y0, z0);
    const n010 = sample(x0, y0 + 1, z0);
    const n110 = sample(x0 + 1, y0 + 1, z0);
    const n001 = sample(x0, y0, z0 + 1);
    const n101 = sample(x0 + 1, y0, z0 + 1);
    const n011 = sample(x0, y0 + 1, z0 + 1);
    const n111 = sample(x0 + 1, y0 + 1, z0 + 1);

    const nx00 = n000 + (n100 - n000) * u;
    const nx10 = n010 + (n110 - n010) * u;
    const nx01 = n001 + (n101 - n001) * u;
    const nx11 = n011 + (n111 - n011) * u;

    const nxy0 = nx00 + (nx10 - nx00) * v;
    const nxy1 = nx01 + (nx11 - nx01) * v;
    return nxy0 + (nxy1 - nxy0) * w;
  };
}

function fbm3D(
  noise: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2.05,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function ridged3D(
  noise: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  octaves: number,
  lacunarity = 2.1,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let signal = 1 - Math.abs(noise(x * freq, y * freq, z * freq));
    signal *= signal;
    signal *= weight;
    weight = Math.max(0, Math.min(1, signal * 1.8));
    sum += signal * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

export interface WorldGenOptions {
  /** 0..100: 0 = mostly land, 50 = balanced oceans, 100 = waterworld */
  waterAmount: number;
  /** 500..1500 yd: ocean sea level height */
  seaLevel: number;
  /** 0..100: 0 = small islands, 50 = balanced continents, 100 = supercontinents */
  continentScale: number;
  /** 0..100: 0 = flat/rolling hills, 50 = balanced ranges, 100 = dramatic mountain chains */
  mountainIntensity: number;
  /** 0..100: 0 = arid/desert, 50 = balanced biomes, 100 = lush forests & jungles */
  greenery: number;
  /** 0..50 °C: initial base planet temperature (0 = ice, 10 = balanced default, 50 = extreme heat) */
  baseTempC: number;
  /** 0..12: number of volcano markers generated along raised mountain faults */
  volcanoCount?: number;
}

export const DEFAULT_WORLD_GEN_OPTIONS: WorldGenOptions = {
  waterAmount: 75,
  seaLevel: 1000,
  continentScale: 50,
  mountainIntensity: 50,
  greenery: 75,
  baseTempC: 10,
  volcanoCount: 3,
};

const VOLCANO_NAMES = [
  'Mount Ashspire',
  'Caldera Pyre',
  'Dreadpeak',
  'Cinderhorn',
  'Brimstone Crown',
  'Obsidian Maw',
  'Embercrest',
  'Sulfur Tor',
  'Magma Fang',
  'Scoria Crag',
  'Krakensfire',
  'Redforge Peak',
];

interface FaultVolcanoCandidate {
  wx: number;
  wz: number;
  cx: number;
  cz: number;
  idx: number;
  score: number;
}

function placeFaultVolcanoes(
  candidates: FaultVolcanoCandidate[],
  count: number,
  seaLevel: number,
  chunkTree: QWorldChunkTree,
  vectorTree: QWorldVectorTree
): void {
  if (count <= 0 || candidates.length === 0) return;
  candidates.sort((a, b) => b.score - a.score);
  const chosen: FaultVolcanoCandidate[] = [];
  const minDistSq = (WORLD_SPAN_X * 0.085) ** 2;

  for (const cand of candidates) {
    if (chosen.length >= count) break;
    let tooClose = false;
    for (const prev of chosen) {
      let dx = Math.abs(cand.wx - prev.wx);
      if (dx > WORLD_SPAN_X * 0.5) dx = WORLD_SPAN_X - dx;
      const dz = cand.wz - prev.wz;
      if (dx * dx + dz * dz < minDistSq) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) chosen.push(cand);
  }

  for (let i = 0; i < chosen.length; i++) {
    const v = chosen[i];
    const chunk = chunkTree.getChunk(0, v.cx, v.cz);
    if (chunk) {
      chunk.heights[v.idx] = Math.max(chunk.heights[v.idx] + 220, seaLevel + 420);
      chunk.biomes[v.idx] = 3;
      chunk.waterFlags[v.idx] = 0;
    }
    const y = Math.round(chunkTree.getSurfaceHeightAt(0, v.wx, v.wz, false, seaLevel));
    vectorTree.addMarker({
      id: `starter-volcano-${i + 1}`,
      name: VOLCANO_NAMES[i % VOLCANO_NAMES.length],
      category: 'volcano',
      x: v.wx,
      y,
      z: v.wz,
      minLod: 0,
      maxLod: 9,
      locked: false,
      eruptionActive: false,
      eruptionMagnitude: 6 + (i % 3),
    });
  }
}

export function generateStarterWorld(
  seedInput?: string,
  optionsInput?: Partial<WorldGenOptions>
): {
  seed: string;
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  oceanSeeds: OceanSeedCell[];
  seaLevel: number;
} {
  const opts: WorldGenOptions = { ...DEFAULT_WORLD_GEN_OPTIONS, ...optionsInput };
  const seed = (seedInput ?? '').trim() || createRandomSeed();
  const rng = mulberry32(hashSeed(seed));
  const elevNoise = createValueNoise3D(rng);
  const ridgeNoise = createValueNoise3D(rng);
  const moistNoise = createValueNoise3D(rng);
  const maskNoise = createValueNoise3D(rng);

  const chunkTree = new QWorldChunkTree();
  const flood = new QWorldWaterFlood(chunkTree, opts.seaLevel);
  const vectorTree = new QWorldVectorTree({
    minX: 0,
    maxX: WORLD_SPAN_X,
    minZ: 0,
    maxZ: WORLD_SPAN_Z,
  });

  const lod = 0;
  const spacing = chunkTree.getSampleSpacing(lod); // 19,683 yd per L0 cell

  let bestLandX = WORLD_SPAN_X * 0.5;
  let bestLandZ = WORLD_SPAN_Z * 0.5;
  let bestLandScore = -Infinity;
  const oceanSeeds: OceanSeedCell[] = [];
  const volcanoCandidates: FaultVolcanoCandidate[] = [];

  const contFreq = 3.4 - (opts.continentScale / 100) * 2.1; // 3.4 (islands) -> 1.3 (supercontinents)
  const landOffset = (50 - opts.waterAmount) * 4.5 - 80;
  const ridgeAmp = (opts.mountainIntensity / 50) * 1450;
  const moistBias = (opts.greenery - 50) * 0.009;
  const baseTempOffset = (opts.baseTempC - 10) * 0.025;

  // Equatorial push + ~50% chance of a continent drifting/reaching one pole
  const hasPolarContinent = rng() < 0.5;
  const polarSign = rng() < 0.5 ? 1 : -1;
  const polarLon = rng() * Math.PI * 2;

  // Generate 6..8 tectonic fault lines on the 3D unit sphere (randomly ~50/50 red mountain faults vs blue depression/rift faults)
  const faultCount = 6 + Math.floor(rng() * 3);
  const faultPtsX: number[] = [];
  const faultPtsY: number[] = [];
  const faultPtsZ: number[] = [];
  const faultPtsPolarity: number[] = [];

  for (let f = 0; f < faultCount; f++) {
    // Randomly 50/50 red ('mountain', +1) or blue ('depression', -1)
    const isRedMountainFault = rng() < 0.5;
    const faultKind: 'mountain' | 'depression' = isRedMountainFault ? 'mountain' : 'depression';
    const polarity = isRedMountainFault ? 1 : -1;

    // Random starting point on sphere (preferring non-extreme latitudes) and tangent direction
    const startLat = (rng() - 0.5) * Math.PI * 0.75;
    const startLon = rng() * Math.PI * 2;
    let px = Math.cos(startLat) * Math.cos(startLon);
    let py = Math.sin(startLat);
    let pz = Math.cos(startLat) * Math.sin(startLon);

    // Random unit tangent perpendicular to p
    const rx = rng() - 0.5;
    const ry = rng() - 0.5;
    const rz = rng() - 0.5;
    const dotPR = px * rx + py * ry + pz * rz;
    let tx = rx - dotPR * px;
    let ty = ry - dotPR * py;
    let tz = rz - dotPR * pz;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;

    const steps = 28 + Math.floor(rng() * 14);
    const stepAngle = 0.075;
    let segment: WorldPoint2D[] = [];
    let segIdx = 0;
    let prevWx = -1;

    for (let s = 0; s < steps; s++) {
      // Gently meander tangent using 3D ridge noise so fault lines curve naturally
      const steer = ridgeNoise(px * 3.1 + f * 2.3, py * 3.1 - 1.7, pz * 3.1 + 4.1) * 0.28 - 0.14;
      // Cross product p x t for lateral bend
      const bx = py * tz - pz * ty;
      const by = pz * tx - px * tz;
      const bz = px * ty - py * tx;
      tx += bx * steer;
      ty += by * steer;
      tz += bz * steer;
      const tNorm = Math.hypot(tx, ty, tz) || 1;
      tx /= tNorm;
      ty /= tNorm;
      tz /= tNorm;

      faultPtsX.push(px);
      faultPtsY.push(py);
      faultPtsZ.push(pz);
      faultPtsPolarity.push(polarity);

      const lat = Math.asin(Math.max(-0.98, Math.min(0.98, py)));
      let lon = Math.atan2(pz, px);
      if (lon < 0) lon += Math.PI * 2;
      const wx = (lon / (Math.PI * 2)) * WORLD_SPAN_X;
      const wz = ((lat / Math.PI) + 0.5) * WORLD_SPAN_Z;

      if (prevWx >= 0 && Math.abs(wx - prevWx) > WORLD_SPAN_X * 0.5 && segment.length >= 2) {
        vectorTree.addPolyline({
          id: `fault-${f}-${segIdx++}`,
          type: 'fault',
          faultKind,
          points: segment,
        });
        segment = [];
      }
      segment.push({ x: Math.round(wx), z: Math.round(wz) });
      prevWx = wx;

      // Advance along great-circle step and re-orthonormalize
      const nx = px + tx * stepAngle;
      const ny = py + ty * stepAngle;
      const nz = pz + tz * stepAngle;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      px = nx / nLen;
      py = ny / nLen;
      pz = nz / nLen;

      const dotPT = px * tx + py * ty + pz * tz;
      tx -= dotPT * px;
      ty -= dotPT * py;
      tz -= dotPT * pz;
      const tLen2 = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen2;
      ty /= tLen2;
      tz /= tLen2;
    }

    if (segment.length >= 2) {
      vectorTree.addPolyline({
        id: `fault-${f}-${segIdx}`,
        type: 'fault',
        faultKind,
        points: segment,
      });
    }
  }

  const faultFx = new Float32Array(faultPtsX);
  const faultFy = new Float32Array(faultPtsY);
  const faultFz = new Float32Array(faultPtsZ);
  const faultFp = new Int8Array(faultPtsPolarity);
  const totalFaultPts = faultFx.length;

  // Generate entire 8x4 L0 planet using seamless 360x180 3D spherical noise
  for (let cz = 0; cz < WORLD_L0_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_L0_CHUNKS_X; cx++) {
      const c = chunkTree.getOrCreateChunk(lod, cx, cz);
      c.waterFlags.fill(0);

      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wz = (cz * CHUNK_SIZE + lz) * spacing;
        const lat = ((wz / WORLD_SPAN_Z) - 0.5) * Math.PI; // -pi/2 (North Pole) to +pi/2 (South Pole)
        const cosLat = Math.cos(lat);
        const sy = Math.sin(lat);
        const polarFactor = Math.abs(sy);

        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const wx = (cx * CHUNK_SIZE + lx) * spacing;
          const lon = (wx / WORLD_SPAN_X) * Math.PI * 2;
          const sx = cosLat * Math.cos(lon);
          const sz = cosLat * Math.sin(lon);

          const continent = fbm3D(elevNoise, sx * contFreq, sy * contFreq, sz * contFreq, 5);
          const ridge = ridged3D(ridgeNoise, sx * 4.2 + 7.1, sy * 4.2 - 3.9, sz * 4.2 + 5.3, 4);
          const subRidge = ridged3D(ridgeNoise, sx * 7.5 - 2.4, sy * 7.5 + 6.1, sz * 7.5 - 4.8, 3);
          const mountainMask = fbm3D(maskNoise, sx * 3.1 - 1.7, sy * 3.1 + 4.3, sz * 3.1 - 2.9, 3);
          const moisture = fbm3D(moistNoise, sx * 3.4 + 11.2, sy * 3.4 - 6.7, sz * 3.4 + 8.4, 4) + moistBias;

          // Nearest convergent (red, mountain) and divergent (blue, depression/canyon/lake/ocean) tectonic fault proximity
          let maxRedDot = -1;
          let maxBlueDot = -1;
          for (let k = 0; k < totalFaultPts; k++) {
            const d = sx * faultFx[k] + sy * faultFy[k] + sz * faultFz[k];
            if (faultFp[k] > 0) {
              if (d > maxRedDot) maxRedDot = d;
            } else {
              if (d > maxBlueDot) maxBlueDot = d;
            }
          }
          const redFaultProx = maxRedDot > -1 ? Math.exp(-(1 - maxRedDot) * 260) : 0;
          const blueFaultProx = maxBlueDot > -1 ? Math.exp(-(1 - maxBlueDot) * 260) : 0;

          // Equatorial landmass push + ~50% chance of a continent reaching one pole
          const equatorPush = (1 - polarFactor * 1.45) * 115;
          let polarLobe = 0;
          if (hasPolarContinent && sy * polarSign > 0.25) {
            const latReach = (sy * polarSign - 0.25) / 0.75;
            const lonAlign = 0.5 + 0.5 * Math.cos(lon - polarLon);
            polarLobe = latReach * Math.pow(lonAlign, 1.5) * 280;
          }

          let h = opts.seaLevel + continent * 520 + landOffset + equatorPush + polarLobe;
          // Mountain ranges concentrated mostly along red tectonic fault lines, while blue fault lines carve canyons, rifts, lakes & oceans
          const peakBoost = Math.max(0, ridge - 0.28) * ridgeAmp * (0.14 + 0.36 * Math.max(0, mountainMask + 0.30));
          const redFaultLift = redFaultProx * (220 + ridge * ridgeAmp * 1.15);
          const blueFaultTrench = blueFaultProx * (260 + (0.35 + 0.65 * subRidge) * 780);
          h += peakBoost + redFaultLift - blueFaultTrench;

          // Underwater seamounts & oceanic trenches
          if (h < opts.seaLevel - 30) {
            h += (subRidge - 0.38) * 680;
            h -= Math.max(0, 0.32 - ridge) * 640;
          }

          const height = Math.round(Math.max(-2500, Math.min(6000, h)));
          const idx = lz * CHUNK_SIZE + lx;
          c.heights[idx] = height;

          if (height <= opts.seaLevel - 100 && oceanSeeds.length < 32 && lx === 40 && lz === 40) {
            oceanSeeds.push({ cx, cz, lx, lz });
          }

          // Compute temperature & weather rainfall (0..255) from baseTempC, solar latitude bands, elevation, moisture & orographic lift
          const aboveSea = height - opts.seaLevel;
          const geoLatRad = (0.5 - wz / WORLD_SPAN_Z) * Math.PI; // +pi/2 (North) to -pi/2 (South)
          const solarIncidence = Math.max(0, Math.cos(geoLatRad)); // Equinox 0° declination
          const baseWarmth = Math.pow(solarIncidence, 1.35);
          const temperature = baseWarmth + baseTempOffset - Math.max(0, aboveSea) * 0.00035;
          const coldDryness = Math.max(0, 0.55 - temperature) * 0.65;
          const heatAridity = Math.max(0, temperature - 0.90) * 0.35;
          const equatorAridity = Math.max(0, 0.30 - polarFactor) * 0.30;
          const orographicLift = Math.max(0, ridge - 0.22) * 0.42 + Math.max(0, mountainMask) * 0.16;
          const effectiveMoisture = moisture - equatorAridity - coldDryness - heatAridity;
          const rainNorm = Math.max(0, Math.min(1, 0.44 + effectiveMoisture * 0.65 + orographicLift));
          const rainByte = Math.round(rainNorm * 255);
          c.rainfall[idx] = rainByte;

          // Assign biome from elevation, temperature, and rainfall:
          // Warm equatorial (|lat| <= 15°), Temperate (15°..55°), Cool/Cold (> 55° with sparse/no green vegetation)
          let biome = 1;
          if (aboveSea <= 0) {
            biome = aboveSea < -220 ? 3 : 4;
          } else if (temperature < 0.22 && aboveSea > 15) {
            biome = 7; // Polar & high-latitude snow/ice
          } else if (aboveSea <= 22) {
            biome = 4; // Coastal sand
          } else if (aboveSea > 920) {
            biome = 7; // Alpine snow
          } else if (aboveSea > 420) {
            biome = 3; // Rock
          } else if (temperature < 0.38) {
            biome = rainByte >= 180 && temperature > 0.32 ? 2 : 3; // Cool tundra rock or sparse sheltered boreal forest
          } else if ((rainByte < 78 && temperature > 0.50) || (rainByte < 120 && temperature > 0.95)) {
            biome = 4; // Equatorial, warm-belt & extreme-heat desert
          } else if (rainByte < 78) {
            biome = temperature < 0.44 ? 3 : 1; // Cool dry rock or dry grass
          } else if (rainByte < 135) {
            biome = 1; // Grass
          } else if (rainByte < 195 || temperature <= 0.78) {
            biome = 2; // Forest (temperate)
          } else {
            biome = aboveSea < 75 ? 5 : 6; // Swamp or Jungle (warm equatorial & humid)
          }
          c.biomes[idx] = biome;

          // Track raised convergent fault candidates for volcano placement
          if (redFaultProx > 0.12 && height > opts.seaLevel + 40 && (lx % 3 === 0) && (lz % 3 === 0)) {
            volcanoCandidates.push({
              wx,
              wz,
              cx,
              cz,
              idx,
              score: redFaultProx * 1200 + (height - opts.seaLevel) + rng() * 90,
            });
          }

          // Track a central dry-land spot for starter city
          if (aboveSea > 30 && aboveSea < 450 && polarFactor < 0.5) {
            const dx = Math.abs(wx - WORLD_SPAN_X * 0.5) / WORLD_SPAN_X;
            const dz = Math.abs(wz - WORLD_SPAN_Z * 0.5) / WORLD_SPAN_Z;
            const score = 1 - (dx + dz) - Math.abs(aboveSea - 140) * 0.0005;
            if (score > bestLandScore) {
              bestLandScore = score;
              bestLandX = wx;
              bestLandZ = wz;
            }
          }
        }
      }
    }
  }

  if (oceanSeeds.length === 0) {
    oceanSeeds.push({ cx: 0, cz: 0, lx: 1, lz: 1 });
  }
  flood.propagateFromSeeds(lod, oceanSeeds);

  placeFaultVolcanoes(
    volcanoCandidates,
    Math.max(0, Math.min(12, Math.round(opts.volcanoCount ?? 3))),
    opts.seaLevel,
    chunkTree,
    vectorTree
  );

  vectorTree.addMarker({
    id: 'starter-city-1',
    name: 'Highwatch',
    category: 'city',
    x: bestLandX,
    y: Math.round(chunkTree.getSurfaceHeightAt(lod, bestLandX, bestLandZ, false, opts.seaLevel)),
    z: bestLandZ,
    minLod: 0,
    maxLod: 9,
    locked: false,
  });

  return { seed, chunkTree, vectorTree, oceanSeeds, seaLevel: opts.seaLevel };
}
