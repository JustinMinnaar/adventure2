import {
  QWorldChunkTree,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from './QWorldChunkTree';
import { getSeaLevelOffsetForTemp } from './QWorldTerrainMesh';
import {
  QWorldVectorTree,
  RouteLegMetrics,
  RouteState,
  RouteStop,
  TravelTimeEstimate,
  WorldPoint2D,
} from './QWorldVectorTree';
import { WATER_OCEAN } from './QWorldWaterFlood';

export const HOURS_PER_TRAVEL_DAY = 8;

export interface PlanRouteOptions {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  from: WorldPoint2D;
  to: WorldPoint2D;
  /** Target state ('path' walks through woods if shorter; 'road' routes around forests over open hills/plains). */
  routeState?: RouteState;
  /** Enclosing-box border ratio (default 0.05 = 5% border around A..B). */
  borderPaddingRatio?: number;
  /** Maximum grid cells along the longest search-box axis (default 160). */
  maxGridCells?: number;
  /** Optional planetary temperature (-5..+5) for sea-level / ice adjustments. */
  planetTemp?: number;
  /** Optional base sea level in yards (default 0). */
  seaLevel?: number;
  /** Optional route ID to ignore when rasterizing existing routes (e.g. re-planning). */
  excludeRouteId?: string;
  /** Automatically retry once with a wider border if blocked by coastlines/cliffs (default true). */
  allowBorderExpansion?: boolean;
}

export interface PlannedRouteResult {
  points: WorldPoint2D[];
  lengthYards: number;
  elevationGainYards: number;
  usedExistingRoad: boolean;
  travelHours: TravelTimeEstimate;
}

export interface PlanMultiStopRouteOptions {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  stops: RouteStop[];
  routeState?: RouteState;
  planetTemp?: number;
  seaLevel?: number;
  excludeRouteId?: string;
}

export type MultiStopRouteResult =
  | {
      ok: true;
      points: WorldPoint2D[];
      legs: RouteLegMetrics[];
      lengthYards: number;
      elevationGainYards: number;
      travelHours: TravelTimeEstimate;
      usedExistingRoad: boolean;
    }
  | {
      ok: false;
      blockedLegIndex: number;
      fromLabel: string;
      toLabel: string;
    };

/**
 * Peasant / Footpath A* terrain difficulty:
 * Peasants can walk through forests (1.38x) reasonably well, so footpaths cut through woods
 * when going around is significantly longer, while avoiding swamps and sheer cliffs.
 */
export const PATH_BIOME_DIFFICULTY: Record<number, number> = {
  0: 1.0,  // Default plains
  1: 1.0,  // Grass / open hills
  2: 1.15, // Forest (peasants walk briskly on woodland footpaths)
  3: 1.55, // Rock / highland
  4: 1.3,  // Sand
  5: 2.8,  // Swamp
  6: 2.1,  // Jungle
  7: 2.0,  // Snow
  8: 0.95, // Farmland
};

/**
 * Engineered Road / Wagon A* terrain difficulty:
 * Clearing timber, stumps, and hauling wagons through forest (5.2x) or swamp (7.8x) is much
 * harder than crossing open grassland or rolling open hills (~1.0x - 1.3x), so roads naturally
 * route around forests unless forced through by an explicit waypoint pin.
 */
export const ROAD_BIOME_DIFFICULTY: Record<number, number> = {
  0: 1.0,  // Default plains
  1: 1.0,  // Grass / open hills
  2: 5.2,  // Forest (roads strongly prefer skirting around forests!)
  3: 2.6,  // Rock / highland
  4: 2.1,  // Sand
  5: 7.8,  // Swamp
  6: 6.8,  // Jungle
  7: 3.8,  // Snow
  8: 0.95, // Farmland
};

// Base speeds in yards per hour (1 mile = 1,760 yd; 8-hour travel day)
const ROAD_WALK_YD_PER_HR = 4840;     // 2.75 mph = 22 mi/day on road
const TRAIL_WALK_YD_PER_HR = 4700;    // 2.67 mph = 21.4 mi/day on beaten path
const ROAD_RIDE_YD_PER_HR = 8800;     // 5.0 mph = 40 mi/day on road
const TRAIL_RIDE_YD_PER_HR = 7040;    // 4.0 mph = 32 mi/day on open grass
const ROAD_VEHICLE_YD_PER_HR = 5280;  // 3.0 mph = 24 mi/day on road

const TRAIL_WALK_BIOME_SPEED_MULT: Record<number, number> = {
  0: 1.0,
  1: 1.0,
  2: 0.95, // Beaten forest footpath: ~20.3 mi/day (almost as fast on foot as open ground!)
  3: 0.78,
  4: 0.82,
  5: 0.48,
  6: 0.62,
  7: 0.6,
  8: 1.0,
};

const TRAIL_RIDE_BIOME_SPEED_MULT: Record<number, number> = {
  0: 0.95,
  1: 0.95,
  2: 0.42, // Forest: branches & roots slow horses (~13.4 mi/day)
  3: 0.55,
  4: 0.72,
  5: 0.25,
  6: 0.28,
  7: 0.42,
  8: 0.98,
};

const TRAIL_VEHICLE_BIOME_SPEED_MULT: Record<number, number> = {
  0: 0.55, // Open plains/hills: ~13.2 mi/day off-road
  1: 0.55,
  2: 0.125, // Forest without road: ~3.0 mi/day (8x slower than road — wagons crawl!)
  3: 0.22,
  4: 0.24,
  5: 0.06,
  6: 0.07,
  7: 0.15,
  8: 0.62,
};

const ENGINEERED_ROAD_BIOME_MAINTENANCE: Record<number, number> = {
  0: 1.0,
  1: 1.0,
  2: 0.88,
  3: 0.86,
  4: 0.9,
  5: 0.76,
  6: 0.78,
  7: 0.8,
  8: 1.0,
};

export function wrapX(x: number): number {
  return ((x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
}

export function wrapDeltaX(dx: number): number {
  if (dx > WORLD_SPAN_X * 0.5) return dx - WORLD_SPAN_X;
  if (dx < -WORLD_SPAN_X * 0.5) return dx + WORLD_SPAN_X;
  return dx;
}

/**
 * Formats travel hours into a concise human-readable label (8 hours = 1 travel day).
 */
export function formatTravelTime(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 min';
  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} min`;
  }
  const days = hours / HOURS_PER_TRAVEL_DAY;
  if (days < 1) {
    return `${hours.toFixed(1)} hr`;
  }
  if (days < 10) {
    return `${days.toFixed(1)} d`;
  }
  return `${Math.round(days)} d`;
}

class BinaryMinHeap {
  private nodes: Int32Array;
  private priorities: Float64Array;
  private length = 0;

  constructor(capacity: number) {
    const cap = Math.max(16, capacity);
    this.nodes = new Int32Array(cap);
    this.priorities = new Float64Array(cap);
  }

  public get size(): number {
    return this.length;
  }

  public push(node: number, priority: number): void {
    if (this.length >= this.nodes.length) {
      const nextCap = this.nodes.length * 2;
      const nextNodes = new Int32Array(nextCap);
      const nextPrios = new Float64Array(nextCap);
      nextNodes.set(this.nodes);
      nextPrios.set(this.priorities);
      this.nodes = nextNodes;
      this.priorities = nextPrios;
    }

    let i = this.length++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.nodes[i] = this.nodes[parent];
      this.priorities[i] = this.priorities[parent];
      i = parent;
    }
    this.nodes[i] = node;
    this.priorities[i] = priority;
  }

  public pop(): number {
    const top = this.nodes[0];
    const lastIdx = --this.length;
    if (lastIdx > 0) {
      const node = this.nodes[lastIdx];
      const prio = this.priorities[lastIdx];
      let i = 0;
      const half = lastIdx >> 1;
      while (i < half) {
        let left = (i << 1) + 1;
        const right = left + 1;
        if (right < lastIdx && this.priorities[right] < this.priorities[left]) {
          left = right;
        }
        if (prio <= this.priorities[left]) break;
        this.nodes[i] = this.nodes[left];
        this.priorities[i] = this.priorities[left];
        i = left;
      }
      this.nodes[i] = node;
      this.priorities[i] = prio;
    }
    return top;
  }
}

function chooseSamplingLod(chunkTree: QWorldChunkTree, stepYards: number): number {
  for (let lod = 9; lod >= 0; lod--) {
    if (chunkTree.getSampleSpacing(lod) <= stepYards) {
      return lod;
    }
  }
  return 0;
}

/**
 * Computes travel time in hours for Walking, Riding, and Vehicles along a 2D world polyline,
 * factoring in route state ('path' vs 'road'), biome difficulty, slope grade, and any shared
 * engineered road segments in `vectorTree`.
 */
export function computeRouteTravelHours(options: {
  chunkTree: QWorldChunkTree;
  vectorTree?: QWorldVectorTree;
  points: WorldPoint2D[];
  routeState: RouteState;
  excludeRouteId?: string;
}): TravelTimeEstimate {
  const { chunkTree, vectorTree, points, routeState, excludeRouteId } = options;
  if (points.length < 2) {
    return { walkingHours: 0, ridingHours: 0, vehiclesHours: 0 };
  }

  // Unwrap polyline X coordinates continuously
  const unwrapped: { x: number; z: number }[] = [];
  let curX = wrapX(points[0].x);
  unwrapped.push({ x: curX, z: points[0].z });
  let minX = curX;
  let maxX = curX;
  let minZ = points[0].z;
  let maxZ = points[0].z;

  for (let i = 1; i < points.length; i++) {
    curX += wrapDeltaX(wrapX(points[i].x) - wrapX(curX));
    const cz = points[i].z;
    unwrapped.push({ x: curX, z: cz });
    if (curX < minX) minX = curX;
    if (curX > maxX) maxX = curX;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;
  }

  const totalSpan = Math.max(1, Math.hypot(maxX - minX, maxZ - minZ));
  const sampleStep = Math.max(4, Math.min(250, totalSpan / 180));
  const lod = chooseSamplingLod(chunkTree, sampleStep);

  const routeIsEngineeredRoad = routeState === 'road' || routeState === 'built_road';

  // Build spatial hash of existing engineered roads if route itself is only a 'path' / 'building'
  const roadCellSize = Math.max(8, sampleStep * 1.25);
  const existingRoadBuckets = new Set<string>();
  if (!routeIsEngineeredRoad && vectorTree) {
    const midX = 0.5 * (minX + maxX);
    const markSegment = (p0: WorldPoint2D, p1: WorldPoint2D) => {
      const ux0 = midX + wrapDeltaX(wrapX(p0.x) - wrapX(midX));
      const ux1 = ux0 + wrapDeltaX(wrapX(p1.x) - wrapX(p0.x));
      const segLen = Math.hypot(ux1 - ux0, p1.z - p0.z);
      const steps = Math.max(1, Math.ceil(segLen / (roadCellSize * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const gx = Math.round((ux0 + (ux1 - ux0) * t) / roadCellSize);
        const gz = Math.round((p0.z + (p1.z - p0.z) * t) / roadCellSize);
        existingRoadBuckets.add(`${gx},${gz}`);
      }
    };

    for (const poly of vectorTree.getAllPolylines()) {
      if (poly.type === 'road' && poly.points.length >= 2) {
        for (let i = 0; i < poly.points.length - 1; i++) {
          markSegment(poly.points[i], poly.points[i + 1]);
        }
      }
    }
    for (const rt of vectorTree.getAllRoutes()) {
      if (rt.id === excludeRouteId) continue;
      if ((rt.state === 'road' || rt.state === 'built_road') && rt.points.length >= 2) {
        for (let i = 0; i < rt.points.length - 1; i++) {
          markSegment(rt.points[i], rt.points[i + 1]);
        }
      }
    }
  }

  let walkingHours = 0;
  let ridingHours = 0;
  let vehiclesHours = 0;

  let prevX = unwrapped[0].x;
  let prevZ = unwrapped[0].z;
  let prevH = chunkTree.getSurfaceHeightAt(lod, wrapX(prevX), prevZ, false);

  for (let i = 0; i < unwrapped.length - 1; i++) {
    const a = unwrapped[i];
    const b = unwrapped[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 1e-3) continue;

    const subSteps = Math.max(1, Math.ceil(segLen / sampleStep));
    for (let s = 1; s <= subSteps; s++) {
      const t = s / subSteps;
      const ux = a.x + (b.x - a.x) * t;
      const uz = Math.max(0, Math.min(WORLD_SPAN_Z, a.z + (b.z - a.z) * t));
      const dHoriz = Math.hypot(ux - prevX, uz - prevZ);
      if (dHoriz < 1e-4) continue;

      const wx = wrapX(ux);
      const curH = chunkTree.getSurfaceHeightAt(lod, wx, uz, false);
      const biome = chunkTree.getBiomeAt(lod, wx, uz);
      const dh = curH - prevH;
      const grade = Math.abs(dh) / dHoriz;

      let onRoad = routeIsEngineeredRoad;
      if (!onRoad && existingRoadBuckets.size > 0) {
        const gx = Math.round(ux / roadCellSize);
        const gz = Math.round(uz / roadCellSize);
        onRoad = existingRoadBuckets.has(`${gx},${gz}`);
      }

      const pavedBonus = routeState === 'built_road' ? 1.15 : routeState === 'building' ? 0.72 : 1.0;

      const walkSlope = 1 / (1 + (dh > 0 ? 10 : 6) * grade * grade);
      const rideSlope = 1 / (1 + (dh > 0 ? 16 : 12) * grade * grade);
      const vehSlope = 1 / (1 + (dh > 0 ? 32 : 20) * grade * grade);

      let walkSpeed: number;
      let rideSpeed: number;
      let vehSpeed: number;

      if (onRoad) {
        const maint = (ENGINEERED_ROAD_BIOME_MAINTENANCE[biome] ?? 1.0) * pavedBonus;
        walkSpeed = ROAD_WALK_YD_PER_HR * maint * walkSlope;
        rideSpeed = ROAD_RIDE_YD_PER_HR * maint * rideSlope;
        vehSpeed = ROAD_VEHICLE_YD_PER_HR * maint * vehSlope;
      } else {
        const buildingBoost = routeState === 'building' ? 1.45 : 1.0;
        walkSpeed =
          TRAIL_WALK_YD_PER_HR * (TRAIL_WALK_BIOME_SPEED_MULT[biome] ?? 1.0) * walkSlope;
        rideSpeed =
          TRAIL_RIDE_YD_PER_HR * (TRAIL_RIDE_BIOME_SPEED_MULT[biome] ?? 0.9) * rideSlope;
        vehSpeed =
          ROAD_VEHICLE_YD_PER_HR *
          Math.min(0.85, (TRAIL_VEHICLE_BIOME_SPEED_MULT[biome] ?? 0.4) * buildingBoost) *
          vehSlope;
      }

      walkingHours += dHoriz / Math.max(120, walkSpeed);
      ridingHours += dHoriz / Math.max(120, rideSpeed);
      vehiclesHours += dHoriz / Math.max(80, vehSpeed);

      prevX = ux;
      prevZ = uz;
      prevH = curH;
    }
  }

  return {
    walkingHours: Math.round(walkingHours * 100) / 100,
    ridingHours: Math.round(ridingHours * 100) / 100,
    vehiclesHours: Math.round(vehiclesHours * 100) / 100,
  };
}

function simplifyUnwrappedPolyline(
  pts: { x: number; z: number; h: number; onRoad: boolean }[],
  epsilon: number,
  maxElevDev: number,
  samplePoint: (x: number, z: number) => { h: number; isBlocked: boolean; biome: number }
): { x: number; z: number; h: number; onRoad: boolean }[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].onRoad !== pts[i - 1].onRoad || pts[i].onRoad !== pts[i + 1].onRoad) {
      keep[i] = 1;
    }
  }

  const epsSq = epsilon * epsilon;
  const stack: [number, number][] = [];

  let segStart = 0;
  for (let i = 1; i < pts.length; i++) {
    if (keep[i]) {
      if (i - segStart > 1) {
        stack.push([segStart, i]);
      }
      segStart = i;
    }
  }

  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a <= 1) continue;
    const ax = pts[a].x;
    const az = pts[a].z;
    const ah = pts[a].h;
    const abx = pts[b].x - ax;
    const abz = pts[b].z - az;
    const abh = pts[b].h - ah;
    const abLenSq = abx * abx + abz * abz;

    let maxScore = -1;
    let splitIdx = -1;

    for (let i = a + 1; i < b; i++) {
      let dSq: number;
      let t = 0.5;
      if (abLenSq <= 1e-9) {
        const dx = pts[i].x - ax;
        const dz = pts[i].z - az;
        dSq = dx * dx + dz * dz;
      } else {
        t = Math.max(0, Math.min(1, ((pts[i].x - ax) * abx + (pts[i].z - az) * abz) / abLenSq));
        const projX = ax + abx * t;
        const projZ = az + abz * t;
        const dx = pts[i].x - projX;
        const dz = pts[i].z - projZ;
        dSq = dx * dx + dz * dz;
      }

      const chordSample = samplePoint(ax + abx * t, az + abz * t);
      const vertexSample = samplePoint(pts[i].x, pts[i].z);
      const elevDiff = Math.abs(chordSample.h - (ah + abh * t));
      // Prevent chord simplification from cutting across forests/swamps when the A* path skirted around them
      const cutsIntoHardBiome =
        (chordSample.biome === 2 || chordSample.biome === 5 || chordSample.biome === 6) &&
        vertexSample.biome !== chordSample.biome;
      const violatesTerrain = chordSample.isBlocked || elevDiff > maxElevDev || cutsIntoHardBiome;
      if (dSq > epsSq || violatesTerrain) {
        const score = dSq / Math.max(1e-6, epsSq) + (violatesTerrain ? 10 + elevDiff : 0);
        if (score > maxScore) {
          maxScore = score;
          splitIdx = i;
        }
      }
    }

    if (splitIdx !== -1) {
      keep[splitIdx] = 1;
      stack.push([a, splitIdx], [splitIdx, b]);
    }
  }

  const out: { x: number; z: number; h: number; onRoad: boolean }[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

function runBoundedAStar(
  options: PlanRouteOptions,
  borderRatio: number
): PlannedRouteResult | null {
  const {
    chunkTree,
    vectorTree,
    from,
    to,
    routeState = 'path',
    maxGridCells = 160,
    planetTemp = 0,
    seaLevel = 0,
    excludeRouteId,
  } = options;

  const isPlanningRoad = routeState !== 'path';
  const biomeDifficultyTable = isPlanningRoad ? ROAD_BIOME_DIFFICULTY : PATH_BIOME_DIFFICULTY;

  const startX = wrapX(from.x);
  const startZ = Math.max(0, Math.min(WORLD_SPAN_Z, from.z));
  const rawDx = wrapDeltaX(wrapX(to.x) - startX);
  const endX = startX + rawDx;
  const endZ = Math.max(0, Math.min(WORLD_SPAN_Z, to.z));

  const spanX = Math.abs(endX - startX);
  const spanZ = Math.abs(endZ - startZ);
  const directDist = Math.hypot(spanX, spanZ);

  if (directDist < 1e-3) {
    return {
      points: [
        { x: startX, z: startZ },
        { x: wrapX(endX), z: endZ },
      ],
      lengthYards: 0,
      elevationGainYards: 0,
      usedExistingRoad: false,
      travelHours: { walkingHours: 0, ridingHours: 0, vehiclesHours: 0 },
    };
  }

  // Enclosing rect around A and B:
  // Roads use a wider lateral buffer (0.42 D) so they can sweep cleanly around broad forests onto open hills/plains.
  const lateralFloor = isPlanningRoad ? 0.42 : 0.26;
  const minCorridorPad = Math.max(12, directDist * Math.max(borderRatio, lateralFloor));
  const padX = Math.max(spanX * borderRatio, minCorridorPad);
  const padZ = Math.max(spanZ * borderRatio, minCorridorPad);

  const minX = Math.min(startX, endX) - padX;
  const maxX = Math.max(startX, endX) + padX;
  const minZ = Math.max(0, Math.min(startZ, endZ) - padZ);
  const maxZ = Math.min(WORLD_SPAN_Z, Math.max(startZ, endZ) + padZ);

  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxZ - minZ);
  const longestSpan = Math.max(boxW, boxH);
  const clampedMaxCells = Math.max(32, Math.min(240, maxGridCells));
  const step = Math.max(1, longestSpan / clampedMaxCells);

  const cols = Math.max(3, Math.ceil(boxW / step) + 1);
  const rows = Math.max(3, Math.ceil(boxH / step) + 1);
  const totalCells = cols * rows;

  const lod = chooseSamplingLod(chunkTree, step);
  const seaOffset = getSeaLevelOffsetForTemp(planetTemp);
  const effectiveSeaLevel = seaLevel + seaOffset;

  const startCol = Math.max(0, Math.min(cols - 1, Math.round((startX - minX) / step)));
  const startRow = Math.max(0, Math.min(rows - 1, Math.round((startZ - minZ) / step)));
  const goalCol = Math.max(0, Math.min(cols - 1, Math.round((endX - minX) / step)));
  const goalRow = Math.max(0, Math.min(rows - 1, Math.round((endZ - minZ) / step)));

  const startIdx = startRow * cols + startCol;
  const goalIdx = goalRow * cols + goalCol;

  const heights = new Float32Array(totalCells);
  const biomes = new Uint8Array(totalCells);
  const blocked = new Uint8Array(totalCells);
  const coastalPenalty = new Float32Array(totalCells);
  const roadMult = new Float32Array(totalCells);
  roadMult.fill(1.0);
  const roadSnapX = new Float64Array(totalCells);
  const roadSnapZ = new Float64Array(totalCells);
  const riverMask = new Uint8Array(totalCells);

  for (let r = 0; r < rows; r++) {
    const wz = Math.min(WORLD_SPAN_Z, minZ + r * step);
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      const idx = rowOff + c;
      const wx = wrapX(minX + c * step);
      const h = chunkTree.getSurfaceHeightAt(lod, wx, wz, false);
      const b = chunkTree.getBiomeAt(lod, wx, wz);
      const wFlag = chunkTree.getWaterAt(lod, wx, wz);

      heights[idx] = h;
      biomes[idx] = b;

      const baseIsOcean = wFlag === WATER_OCEAN;
      const isOcean =
        seaOffset > 0
          ? baseIsOcean || h <= effectiveSeaLevel
          : seaOffset < 0
            ? baseIsOcean && h <= effectiveSeaLevel
            : baseIsOcean;

      if (isOcean) {
        const distStartCells = Math.hypot(c - startCol, r - startRow);
        const distGoalCells = Math.hypot(c - goalCol, r - goalRow);
        if (distStartCells <= 1.5 || distGoalCells <= 1.5) {
          coastalPenalty[idx] = 5.0;
        } else {
          blocked[idx] = 1;
        }
      }
    }
  }

  blocked[startIdx] = 0;
  blocked[goalIdx] = 0;

  const midX = (minX + maxX) * 0.5;
  let minPossibleMult = 0.95;

  const rasterizeSegment = (
    p0: WorldPoint2D,
    p1: WorldPoint2D,
    mult: number,
    isRiver: boolean
  ) => {
    const ux0 = midX + wrapDeltaX(wrapX(p0.x) - midX);
    const uz0 = p0.z;
    const ux1 = ux0 + wrapDeltaX(wrapX(p1.x) - wrapX(p0.x));
    const uz1 = p1.z;

    if (
      Math.max(ux0, ux1) < minX - step * 2 ||
      Math.min(ux0, ux1) > maxX + step * 2 ||
      Math.max(uz0, uz1) < minZ - step * 2 ||
      Math.min(uz0, uz1) > maxZ + step * 2
    ) {
      return;
    }

    const gx0 = (ux0 - minX) / step;
    const gz0 = (uz0 - minZ) / step;
    const gx1 = (ux1 - minX) / step;
    const gz1 = (uz1 - minZ) / step;

    const samples = Math.max(1, Math.ceil(Math.max(Math.abs(gx1 - gx0), Math.abs(gz1 - gz0)) * 2.5));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const gx = gx0 + (gx1 - gx0) * t;
      const gz = gz0 + (gz1 - gz0) * t;
      const wx = ux0 + (ux1 - ux0) * t;
      const wz = uz0 + (uz1 - uz0) * t;

      const c = Math.round(gx);
      const r = Math.round(gz);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const idx = r * cols + c;

      if (isRiver) {
        riverMask[idx] = 1;
      } else {
        if (mult < minPossibleMult) minPossibleMult = mult;
        if (mult < roadMult[idx]) {
          roadMult[idx] = mult;
          roadSnapX[idx] = wx;
          roadSnapZ[idx] = wz;
          blocked[idx] = 0;
        }
        const neighbors: [number, number][] = [
          [c - 1, r],
          [c + 1, r],
          [c, r - 1],
          [c, r + 1],
        ];
        for (const [nc, nr] of neighbors) {
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (Math.hypot(nc - gx, nr - gz) <= 0.72) {
            const nIdx = nr * cols + nc;
            if (mult < roadMult[nIdx]) {
              roadMult[nIdx] = mult;
              roadSnapX[nIdx] = wx;
              roadSnapZ[nIdx] = wz;
            }
          }
        }
      }
    }
  };

  for (const poly of vectorTree.getAllPolylines()) {
    if (poly.points.length < 2) continue;
    if (poly.type === 'road') {
      const mult = isPlanningRoad ? 0.35 : 0.55;
      for (let i = 0; i < poly.points.length - 1; i++) {
        rasterizeSegment(poly.points[i], poly.points[i + 1], mult, false);
      }
    } else if (poly.type === 'river') {
      for (let i = 0; i < poly.points.length - 1; i++) {
        rasterizeSegment(poly.points[i], poly.points[i + 1], 1.0, true);
      }
    }
  }

  for (const route of vectorTree.getAllRoutes()) {
    if (route.id === excludeRouteId || route.points.length < 2) continue;
    // CRITICAL: When laying a permanent 'road', ignore peasant 'path' trails so roads
    // never blindly follow footpaths straight through dense forests!
    if (isPlanningRoad && route.state === 'path') continue;

    let mult = 0.7;
    if (route.state === 'built_road') mult = isPlanningRoad ? 0.25 : 0.45;
    else if (route.state === 'road') mult = isPlanningRoad ? 0.35 : 0.55;
    else if (route.state === 'building') mult = isPlanningRoad ? 0.5 : 0.65;
    else mult = 0.7;

    for (let i = 0; i < route.points.length - 1; i++) {
      rasterizeSegment(route.points[i], route.points[i + 1], mult, false);
    }
  }

  // 8-way A* search
  const gScore = new Float64Array(totalCells);
  gScore.fill(Infinity);
  const closed = new Uint8Array(totalCells);
  const parent = new Int32Array(totalCells);
  parent.fill(-1);

  const open = new BinaryMinHeap(cols + rows);
  gScore[startIdx] = 0;
  const startH = Math.hypot(goalCol - startCol, goalRow - startRow) * step * minPossibleMult;
  open.push(startIdx, startH);

  const dCols = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dRows = [-1, -1, -1, 0, 0, 1, 1, 1];
  const dFactors = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  let reached = false;

  while (open.size > 0) {
    const u = open.pop();
    if (u === goalIdx) {
      reached = true;
      break;
    }
    if (closed[u]) continue;
    closed[u] = 1;

    const uCol = u % cols;
    const uRow = (u - uCol) / cols;
    const uHeight = heights[u];
    const uG = gScore[u];

    for (let dir = 0; dir < 8; dir++) {
      const nCol = uCol + dCols[dir];
      const nRow = uRow + dRows[dir];
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;

      const v = nRow * cols + nCol;
      if (closed[v] || blocked[v]) continue;

      if (dFactors[dir] > 1.1) {
        if (blocked[uRow * cols + nCol] && blocked[nRow * cols + uCol]) {
          continue;
        }
      }

      const horizDist = step * dFactors[dir];
      const dh = heights[v] - uHeight;
      const grade = Math.abs(dh) / horizDist;

      const vRoadMult = roadMult[v];
      const uRoadMult = roadMult[u];
      const onEngineeredRoad = vRoadMult <= 0.56 && uRoadMult <= 0.56;
      const onAnyRoad = vRoadMult < 0.99 && uRoadMult < 0.99;

      const surfaceMult = onAnyRoad
        ? Math.max(vRoadMult, uRoadMult)
        : (biomeDifficultyTable[biomes[v]] ?? 1.0) + coastalPenalty[v];

      // Gentle open hills (grade 0.05..0.12) add only ~10-35% cost, whereas steep mountain slopes
      // (grade > 0.35..0.45) ramp up sharply so both roads and paths contour around peaks.
      const kSlope = onEngineeredRoad
        ? 14
        : isPlanningRoad
          ? dh > 0
            ? 56
            : 38
          : dh > 0
            ? 52
            : 34;
      let slopeFactor = 1 + kSlope * grade * grade;
      const steepThreshold = isPlanningRoad ? 0.36 : 0.46;
      if (!onEngineeredRoad && grade > steepThreshold) {
        const excess = grade - steepThreshold;
        slopeFactor += excess * excess * (isPlanningRoad ? 210 : 160);
      }

      const riverPenalty = riverMask[v] && !onEngineeredRoad ? step * (isPlanningRoad ? 5.5 : 3.2) : 0;

      const tentativeG = uG + horizDist * surfaceMult * slopeFactor + riverPenalty;
      if (tentativeG < gScore[v]) {
        gScore[v] = tentativeG;
        parent[v] = u;
        const hDist = Math.hypot(goalCol - nCol, goalRow - nRow) * step * minPossibleMult;
        open.push(v, tentativeG + hDist);
      }
    }
  }

  if (!reached) {
    return null;
  }

  const rawIndices: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    rawIndices.push(cur);
    if (cur === startIdx) break;
    cur = parent[cur];
  }
  rawIndices.reverse();

  let usedExistingRoad = false;
  const sampleHeight = (ux: number, uz: number) =>
    chunkTree.getSurfaceHeightAt(lod, wrapX(ux), Math.max(0, Math.min(WORLD_SPAN_Z, uz)), false);

  const rawPts: { x: number; z: number; h: number; onRoad: boolean; cellIdx: number }[] = rawIndices.map((idx, i) => {
    if (i === 0) {
      return { x: startX, z: startZ, h: sampleHeight(startX, startZ), onRoad: false, cellIdx: idx };
    }
    if (i === rawIndices.length - 1) {
      return { x: endX, z: endZ, h: sampleHeight(endX, endZ), onRoad: false, cellIdx: idx };
    }
    const rMult = roadMult[idx];
    if (rMult < 0.99) {
      usedExistingRoad = true;
      const rx = roadSnapX[idx];
      const rz = roadSnapZ[idx];
      return { x: rx, z: rz, h: sampleHeight(rx, rz), onRoad: true, cellIdx: idx };
    }
    const c = idx % cols;
    const r = (idx - c) / cols;
    const cx = minX + c * step;
    const cz = minZ + r * step;
    return { x: cx, z: cz, h: heights[idx], onRoad: false, cellIdx: idx };
  });

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < rawPts.length - 1; i++) {
      if (rawPts[i].onRoad) continue;
      const prev = rawPts[i - 1];
      const next = rawPts[i + 1];
      const candX = 0.25 * prev.x + 0.5 * rawPts[i].x + 0.25 * next.x;
      const candZ = 0.25 * prev.z + 0.5 * rawPts[i].z + 0.25 * next.z;
      const cc = Math.round((candX - minX) / step);
      const cr = Math.round((candZ - minZ) / step);
      if (cc >= 0 && cc < cols && cr >= 0 && cr < rows) {
        const cIdx = cr * cols + cc;
        if (!blocked[cIdx]) {
          const curDiff = biomeDifficultyTable[biomes[rawPts[i].cellIdx]] ?? 1.0;
          const candDiff = biomeDifficultyTable[biomes[cIdx]] ?? 1.0;
          const candH = sampleHeight(candX, candZ);
          const avgNeighborH = 0.5 * (prev.h + next.h);
          if (
            candDiff <= curDiff + 0.05 &&
            candH <= Math.max(rawPts[i].h, avgNeighborH) + Math.max(3, step * 0.04)
          ) {
            rawPts[i].x = candX;
            rawPts[i].z = candZ;
            rawPts[i].h = candH;
            rawPts[i].cellIdx = cIdx;
          }
        }
      }
    }
  }

  const simplified = simplifyUnwrappedPolyline(
    rawPts,
    step * 0.2,
    Math.max(5, step * 0.08),
    (ux, uz) => {
      const cc = Math.round((ux - minX) / step);
      const cr = Math.round((uz - minZ) / step);
      const inBounds = cc >= 0 && cc < cols && cr >= 0 && cr < rows;
      const isBlocked = inBounds ? blocked[cr * cols + cc] === 1 : true;
      const biome = inBounds ? biomes[cr * cols + cc] : 0;
      return { h: sampleHeight(ux, uz), isBlocked, biome };
    }
  );

  let lengthYards = 0;
  let elevationGainYards = 0;
  const maxMeasureStep = Math.max(4, Math.min(step * 0.5, 250));
  let prevSampleH = chunkTree.getSurfaceHeightAt(lod, wrapX(simplified[0].x), simplified[0].z, false);

  for (let i = 0; i < simplified.length - 1; i++) {
    const a = simplified[i];
    const b = simplified[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    lengthYards += segLen;

    const subSteps = Math.max(1, Math.ceil(segLen / maxMeasureStep));
    for (let s = 1; s <= subSteps; s++) {
      const t = s / subSteps;
      const sx = wrapX(a.x + (b.x - a.x) * t);
      const sz = Math.max(0, Math.min(WORLD_SPAN_Z, a.z + (b.z - a.z) * t));
      const sh = chunkTree.getSurfaceHeightAt(lod, sx, sz, false);
      if (sh > prevSampleH) {
        elevationGainYards += sh - prevSampleH;
      }
      prevSampleH = sh;
    }
  }

  const points: WorldPoint2D[] = simplified.map((p) => ({
    x: Math.round(wrapX(p.x) * 100) / 100,
    z: Math.round(Math.max(0, Math.min(WORLD_SPAN_Z, p.z)) * 100) / 100,
  }));

  const travelHours = computeRouteTravelHours({
    chunkTree,
    vectorTree,
    points,
    routeState,
    excludeRouteId,
  });

  return {
    points,
    lengthYards: Math.round(lengthYards),
    elevationGainYards: Math.round(elevationGainYards),
    usedExistingRoad,
    travelHours,
  };
}

/**
 * Plans a single leg between `from` and `to`, respecting `routeState` terrain difficulty
 * ('path' walks through woods when shorter; 'road' skirts around forests over open hills/plains).
 */
export function planRoute(options: PlanRouteOptions): PlannedRouteResult | null {
  const baseRatio = options.borderPaddingRatio ?? 0.05;
  const firstAttempt = runBoundedAStar(options, baseRatio);
  if (firstAttempt) {
    return firstAttempt;
  }

  if (options.allowBorderExpansion !== false && baseRatio < 0.65) {
    return runBoundedAStar(options, 0.7);
  }

  return null;
}

/**
 * Plans a multi-step route across 2, 3, or more stops (markers or map waypoint pins),
 * computing per-step and total distance + travel times for Walking, Riding, and Vehicles.
 */
export function planMultiStopRoute(options: PlanMultiStopRouteOptions): MultiStopRouteResult {
  const {
    chunkTree,
    vectorTree,
    stops,
    routeState = 'path',
    planetTemp = 0,
    seaLevel = 0,
    excludeRouteId,
  } = options;

  if (stops.length < 2) {
    return {
      ok: false,
      blockedLegIndex: 0,
      fromLabel: stops[0]?.label ?? 'Origin',
      toLabel: 'Destination',
    };
  }

  const legs: RouteLegMetrics[] = [];
  const allPoints: WorldPoint2D[] = [];
  let totalLengthYards = 0;
  let totalElevGainYards = 0;
  let totalWalking = 0;
  let totalRiding = 0;
  let totalVehicles = 0;
  let anyUsedExistingRoad = false;

  for (let i = 0; i < stops.length - 1; i++) {
    const stopA = stops[i];
    const stopB = stops[i + 1];

    const legRes = planRoute({
      chunkTree,
      vectorTree,
      from: { x: stopA.x, z: stopA.z },
      to: { x: stopB.x, z: stopB.z },
      routeState,
      planetTemp,
      seaLevel,
      excludeRouteId,
    });

    if (!legRes) {
      return {
        ok: false,
        blockedLegIndex: i,
        fromLabel: stopA.label,
        toLabel: stopB.label,
      };
    }

    if (legRes.usedExistingRoad) anyUsedExistingRoad = true;

    legs.push({
      fromLabel: stopA.label,
      toLabel: stopB.label,
      points: legRes.points,
      lengthYards: legRes.lengthYards,
      elevationGainYards: legRes.elevationGainYards,
      travelHours: legRes.travelHours,
    });

    if (i === 0) {
      allPoints.push(...legRes.points);
    } else {
      allPoints.push(...legRes.points.slice(1));
    }

    totalLengthYards += legRes.lengthYards;
    totalElevGainYards += legRes.elevationGainYards;
    totalWalking += legRes.travelHours.walkingHours;
    totalRiding += legRes.travelHours.ridingHours;
    totalVehicles += legRes.travelHours.vehiclesHours;
  }

  return {
    ok: true,
    points: allPoints,
    legs,
    lengthYards: Math.round(totalLengthYards),
    elevationGainYards: Math.round(totalElevGainYards),
    travelHours: {
      walkingHours: Math.round(totalWalking * 100) / 100,
      ridingHours: Math.round(totalRiding * 100) / 100,
      vehiclesHours: Math.round(totalVehicles * 100) / 100,
    },
    usedExistingRoad: anyUsedExistingRoad,
  };
}
