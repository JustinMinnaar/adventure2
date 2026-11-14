import { WORLD_SPAN_X, WORLD_SPAN_Z } from './QWorldChunkTree';
import {
  RouteState,
  WorldPoint2D,
  WorldPolyline,
  WorldRoute,
} from './QWorldVectorTree';

export interface MergedRouteStrand {
  points: WorldPoint2D[];
  state: RouteState;
  trafficCount: number;
  isSelected: boolean;
}

const STATE_RANK: Record<RouteState, number> = {
  path: 1,
  building: 2,
  road: 3,
  built_road: 4,
};

function wrapDeltaX(dx: number): number {
  if (dx > WORLD_SPAN_X * 0.5) return dx - WORLD_SPAN_X;
  if (dx < -WORLD_SPAN_X * 0.5) return dx + WORLD_SPAN_X;
  return dx;
}

function wrapX(x: number): number {
  return ((x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
}

function higherState(a: RouteState, b: RouteState): RouteState {
  return STATE_RANK[b] > STATE_RANK[a] ? b : a;
}

interface GridNode {
  key: string;
  sumX: number;
  sumZ: number;
  samples: number;
  pinnedX?: number;
  pinnedZ?: number;
}

interface GridEdge {
  key: string;
  u: string;
  v: string;
  state: RouteState;
  trafficCount: number;
  isSelected: boolean;
}

/**
 * Merges overlapping routes and manual road polylines into non-overlapping display strands,
 * counting how many distinct routes traverse each segment (`trafficCount`) so busy corridors
 * render progressively thicker.
 */
export function buildMergedRouteNetwork(options: {
  routes: WorldRoute[];
  roadPolylines?: WorldPolyline[];
  cellSize: number;
  cameraTargetX?: number;
  selectedRouteId?: string | null;
}): MergedRouteStrand[] {
  const {
    routes,
    roadPolylines = [],
    cellSize: rawCellSize,
    cameraTargetX = WORLD_SPAN_X * 0.5,
    selectedRouteId = null,
  } = options;

  const cellSize = Math.max(2, rawCellSize);
  const sampleStep = cellSize * 0.5;

  const nodes = new Map<string, GridNode>();
  const edges = new Map<string, GridEdge>();

  const getOrAddNode = (ux: number, uz: number, isEndpoint: boolean): string => {
    const gx = Math.round(ux / cellSize);
    const gz = Math.round(uz / cellSize);
    const key = `${gx},${gz}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, sumX: ux, sumZ: uz, samples: 1 };
      if (isEndpoint) {
        node.pinnedX = ux;
        node.pinnedZ = uz;
      }
      nodes.set(key, node);
    } else {
      node.sumX += ux;
      node.sumZ += uz;
      node.samples += 1;
      if (isEndpoint && node.pinnedX === undefined) {
        node.pinnedX = ux;
        node.pinnedZ = uz;
      }
    }
    return key;
  };

  const ingestPolyline = (
    rawPts: WorldPoint2D[],
    state: RouteState,
    isSelected: boolean,
    pinnedStops?: WorldPoint2D[]
  ) => {
    if (rawPts.length < 2) return;

    // Unwrap X continuously and shift near cameraTargetX
    const unwrapped: { x: number; z: number }[] = [];
    let curX = rawPts[0].x;
    unwrapped.push({ x: curX, z: rawPts[0].z });
    for (let i = 1; i < rawPts.length; i++) {
      curX += wrapDeltaX(rawPts[i].x - wrapX(curX));
      unwrapped.push({ x: curX, z: rawPts[i].z });
    }
    const midX = 0.5 * (unwrapped[0].x + unwrapped[unwrapped.length - 1].x);
    const shiftX = Math.round((cameraTargetX - midX) / WORLD_SPAN_X) * WORLD_SPAN_X;
    for (let i = 0; i < unwrapped.length; i++) {
      unwrapped[i].x += shiftX;
    }

    // Pin explicit stops (e.g., Crossroads, Inns, Cities) so merged junctions stay anchored
    if (pinnedStops) {
      for (const st of pinnedStops) {
        const sx = cameraTargetX + wrapDeltaX(wrapX(st.x) - wrapX(cameraTargetX));
        getOrAddNode(sx, st.z, true);
      }
    }

    const chain: string[] = [];
    const pushNode = (k: string) => {
      if (chain.length === 0 || chain[chain.length - 1] !== k) {
        chain.push(k);
      }
    };

    for (let i = 0; i < unwrapped.length - 1; i++) {
      const a = unwrapped[i];
      const b = unwrapped[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(segLen / sampleStep));
      const startS = i === 0 ? 0 : 1;
      for (let s = startS; s <= steps; s++) {
        const t = s / steps;
        const ux = a.x + (b.x - a.x) * t;
        const uz = Math.max(0, Math.min(WORLD_SPAN_Z, a.z + (b.z - a.z) * t));
        const isEnd = (i === 0 && s === 0) || (i === unwrapped.length - 2 && s === steps);
        pushNode(getOrAddNode(ux, uz, isEnd));
      }
    }

    const seenInRoute = new Set<string>();
    for (let i = 0; i < chain.length - 1; i++) {
      const u = chain[i];
      const v = chain[i + 1];
      if (u === v) continue;
      const eKey = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seenInRoute.has(eKey)) continue;
      seenInRoute.add(eKey);

      const existing = edges.get(eKey);
      if (!existing) {
        edges.set(eKey, {
          key: eKey,
          u: u < v ? u : v,
          v: u < v ? v : u,
          state,
          trafficCount: 1,
          isSelected,
        });
      } else {
        existing.trafficCount += 1;
        existing.state = higherState(existing.state, state);
        if (isSelected) existing.isSelected = true;
      }
    }
  };

  for (const poly of roadPolylines) {
    if (poly.type === 'road' && poly.points.length >= 2) {
      ingestPolyline(poly.points, 'road', false);
    }
  }

  for (const rt of routes) {
    ingestPolyline(rt.points, rt.state, rt.id === selectedRouteId, rt.stops);
  }

  if (edges.size === 0) return [];

  // Build adjacency map for chaining edges with identical visual attributes
  const adj = new Map<string, GridEdge[]>();
  for (const edge of edges.values()) {
    let listU = adj.get(edge.u);
    if (!listU) {
      listU = [];
      adj.set(edge.u, listU);
    }
    listU.push(edge);

    let listV = adj.get(edge.v);
    if (!listV) {
      listV = [];
      adj.set(edge.v, listV);
    }
    listV.push(edge);
  }

  const sameStyle = (a: GridEdge, b: GridEdge) =>
    a.state === b.state && a.trafficCount === b.trafficCount && a.isSelected === b.isSelected;

  const visited = new Set<string>();
  const nodeCoord = (k: string): WorldPoint2D => {
    const n = nodes.get(k)!;
    return {
      x: n.pinnedX !== undefined ? n.pinnedX : n.sumX / n.samples,
      z: n.pinnedZ !== undefined ? n.pinnedZ : n.sumZ / n.samples,
    };
  };

  const strands: MergedRouteStrand[] = [];

  const buildChainFrom = (seedEdge: GridEdge): string[] => {
    visited.add(seedEdge.key);

    // Extend backward from seedEdge.u and forward from seedEdge.v
    const extend = (startNode: string): string[] => {
      const out: string[] = [];
      let cur = startNode;
      while (true) {
        const inc = adj.get(cur) ?? [];
        // Only chain cleanly across degree-2 style-matching interior vertices (stop at true junctions)
        if (inc.length !== 2) break;
        const nextEdge = inc.find((e) => !visited.has(e.key) && sameStyle(e, seedEdge));
        if (!nextEdge) break;
        visited.add(nextEdge.key);
        cur = nextEdge.u === cur ? nextEdge.v : nextEdge.u;
        out.push(cur);
      }
      return out;
    };

    const back = extend(seedEdge.u).reverse();
    const fwd = extend(seedEdge.v);
    return [...back, seedEdge.u, seedEdge.v, ...fwd];
  };

  for (const edge of edges.values()) {
    if (visited.has(edge.key)) continue;
    const nodeKeys = buildChainFrom(edge);
    const pts = nodeKeys.map(nodeCoord);

    // Light smoothing on unpinned interior vertices when multiple routes averaged together
    if (pts.length >= 3 && edge.trafficCount > 1) {
      for (let i = 1; i < pts.length - 1; i++) {
        const n = nodes.get(nodeKeys[i])!;
        if (n.pinnedX !== undefined) continue;
        pts[i] = {
          x: 0.2 * pts[i - 1].x + 0.6 * pts[i].x + 0.2 * pts[i + 1].x,
          z: 0.2 * pts[i - 1].z + 0.6 * pts[i].z + 0.2 * pts[i + 1].z,
        };
      }
    }

    strands.push({
      points: pts,
      state: edge.state,
      trafficCount: edge.trafficCount,
      isSelected: edge.isSelected,
    });
  }

  return strands;
}
