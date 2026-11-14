import { WorldBounds, WORLD_SPAN_X } from './QWorldChunkTree';

export interface WorldPoint2D {
  x: number;
  z: number;
}

export interface WorldMarker {
  id: string;
  name: string;
  category: string;
  x: number;
  y?: number;
  z: number;
  minLod: number;
  maxLod: number;
  notes?: string;
  zoomDistance?: number;
  locked?: boolean;
  eruptionActive?: boolean;
  eruptionMagnitude?: number;
}

export interface WorldPolyline {
  id: string;
  type: 'river' | 'road' | 'fault';
  faultKind?: 'mountain' | 'depression';
  points: WorldPoint2D[];
  sourceVolume?: number;
  name?: string;
}

export type RouteState = 'path' | 'road' | 'building' | 'built_road';

export interface TravelTimeEstimate {
  walkingHours: number;
  ridingHours: number;
  vehiclesHours: number;
}

export interface RouteStop {
  markerId?: string;
  label: string;
  x: number;
  z: number;
}

export interface RouteLegMetrics {
  fromLabel: string;
  toLabel: string;
  points: WorldPoint2D[];
  lengthYards: number;
  elevationGainYards: number;
  travelHours: TravelTimeEstimate;
}

export interface WorldRoute {
  id: string;
  name?: string;
  fromMarkerId: string;
  toMarkerId: string;
  stops?: RouteStop[];
  legs?: RouteLegMetrics[];
  travelHours?: TravelTimeEstimate;
  state: RouteState;
  points: WorldPoint2D[];
  lengthYards: number;
  elevationGainYards?: number;
}

interface SpatialEntry<T> {
  bounds: WorldBounds;
  item: T;
}

class QuadTreeNode<T> {
  public readonly bounds: WorldBounds;
  public readonly depth: number;
  public entries: SpatialEntry<T>[] = [];
  public children: QuadTreeNode<T>[] | null = null;

  constructor(bounds: WorldBounds, depth: number) {
    this.bounds = bounds;
    this.depth = depth;
  }

  public insert(entry: SpatialEntry<T>, maxEntries: number, maxDepth: number): void {
    if (!intersects(this.bounds, entry.bounds)) return;

    if (!this.children) {
      this.entries.push(entry);
      if (this.entries.length > maxEntries && this.depth < maxDepth) {
        this.subdivide(maxEntries, maxDepth);
      }
      return;
    }

    for (const child of this.children) {
      child.insert(entry, maxEntries, maxDepth);
    }
  }

  public query(range: WorldBounds, seen: Set<T>, out: T[]): void {
    if (!intersects(this.bounds, range)) return;

    for (const entry of this.entries) {
      if (!seen.has(entry.item) && intersects(entry.bounds, range)) {
        seen.add(entry.item);
        out.push(entry.item);
      }
    }

    if (this.children) {
      for (const child of this.children) {
        child.query(range, seen, out);
      }
    }
  }

  private subdivide(maxEntries: number, maxDepth: number): void {
    const midX = (this.bounds.minX + this.bounds.maxX) * 0.5;
    const midZ = (this.bounds.minZ + this.bounds.maxZ) * 0.5;
    const d = this.depth + 1;

    this.children = [
      new QuadTreeNode<T>({ minX: this.bounds.minX, maxX: midX, minZ: this.bounds.minZ, maxZ: midZ }, d),
      new QuadTreeNode<T>({ minX: midX, maxX: this.bounds.maxX, minZ: this.bounds.minZ, maxZ: midZ }, d),
      new QuadTreeNode<T>({ minX: this.bounds.minX, maxX: midX, minZ: midZ, maxZ: this.bounds.maxZ }, d),
      new QuadTreeNode<T>({ minX: midX, maxX: this.bounds.maxX, minZ: midZ, maxZ: this.bounds.maxZ }, d),
    ];

    const old = this.entries;
    this.entries = [];
    for (const entry of old) {
      for (const child of this.children) {
        child.insert(entry, maxEntries, maxDepth);
      }
    }
  }
}

function intersects(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function computePointsBounds(points: WorldPoint2D[]): WorldBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let crossesSeam = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    if (i > 0 && Math.abs(p.x - points[i - 1].x) > WORLD_SPAN_X * 0.5) {
      crossesSeam = true;
    }
  }
  if (crossesSeam) {
    minX = 0;
    maxX = WORLD_SPAN_X;
  }
  return { minX, maxX, minZ, maxZ };
}

export class QWorldVectorTree {
  private readonly worldBounds: WorldBounds;
  private markerRoot: QuadTreeNode<WorldMarker>;
  private readonly polylineRoot: QuadTreeNode<WorldPolyline>;
  private routeRoot: QuadTreeNode<WorldRoute>;
  private readonly markers = new Map<string, WorldMarker>();
  private readonly polylines = new Map<string, WorldPolyline>();
  private readonly routes = new Map<string, WorldRoute>();

  constructor(worldBounds: WorldBounds) {
    this.worldBounds = worldBounds;
    this.markerRoot = new QuadTreeNode<WorldMarker>(worldBounds, 0);
    this.polylineRoot = new QuadTreeNode<WorldPolyline>(worldBounds, 0);
    this.routeRoot = new QuadTreeNode<WorldRoute>(worldBounds, 0);
  }

  public addMarker(marker: WorldMarker): void {
    this.markers.set(marker.id, marker);
    this.markerRoot.insert(
      { bounds: { minX: marker.x, maxX: marker.x, minZ: marker.z, maxZ: marker.z }, item: marker },
      16,
      8
    );
  }

  public getMarker(id: string): WorldMarker | undefined {
    return this.markers.get(id);
  }

  public updateMarker(id: string, patch: Partial<WorldMarker>): WorldMarker | undefined {
    const existing = this.markers.get(id);
    if (!existing) return undefined;
    const posChanged =
      (patch.x !== undefined && patch.x !== existing.x) ||
      (patch.z !== undefined && patch.z !== existing.z);
    Object.assign(existing, patch);
    if (posChanged) {
      this.rebuildMarkerIndex();
    }
    return existing;
  }

  public removeMarker(id: string): boolean {
    if (!this.markers.delete(id)) return false;
    this.rebuildMarkerIndex();
    return true;
  }

  private rebuildMarkerIndex(): void {
    this.markerRoot = new QuadTreeNode<WorldMarker>(this.worldBounds, 0);
    for (const m of this.markers.values()) {
      this.markerRoot.insert(
        { bounds: { minX: m.x, maxX: m.x, minZ: m.z, maxZ: m.z }, item: m },
        16,
        8
      );
    }
  }

  public addPolyline(poly: WorldPolyline): void {
    this.polylines.set(poly.id, poly);
    const bounds = computePointsBounds(poly.points);
    if (bounds) {
      this.polylineRoot.insert({ bounds, item: poly }, 16, 8);
    }
  }

  public addRoute(route: WorldRoute): void {
    this.routes.set(route.id, route);
    const bounds = computePointsBounds(route.points);
    if (bounds) {
      this.routeRoot.insert({ bounds, item: route }, 16, 8);
    }
  }

  public getRoute(id: string): WorldRoute | undefined {
    return this.routes.get(id);
  }

  public updateRoute(id: string, patch: Partial<WorldRoute>): WorldRoute | undefined {
    const existing = this.routes.get(id);
    if (!existing) return undefined;
    const pointsChanged = patch.points !== undefined;
    Object.assign(existing, patch);
    if (pointsChanged) {
      this.rebuildRouteIndex();
    }
    return existing;
  }

  public removeRoute(id: string): boolean {
    if (!this.routes.delete(id)) return false;
    this.rebuildRouteIndex();
    return true;
  }

  private rebuildRouteIndex(): void {
    this.routeRoot = new QuadTreeNode<WorldRoute>(this.worldBounds, 0);
    for (const r of this.routes.values()) {
      const bounds = computePointsBounds(r.points);
      if (bounds) {
        this.routeRoot.insert({ bounds, item: r }, 16, 8);
      }
    }
  }

  public getMarkerCount(): number {
    return this.markers.size;
  }

  public getRouteCount(): number {
    return this.routes.size;
  }

  public getAllMarkers(): WorldMarker[] {
    return Array.from(this.markers.values());
  }

  public getAllPolylines(): WorldPolyline[] {
    return Array.from(this.polylines.values());
  }

  public getAllRoutes(): WorldRoute[] {
    return Array.from(this.routes.values());
  }

  public queryVisible(
    bounds: WorldBounds,
    lod: number
  ): { markers: WorldMarker[]; polylines: WorldPolyline[]; routes: WorldRoute[] } {
    const rawMarkers: WorldMarker[] = [];
    const rawPolylines: WorldPolyline[] = [];
    const rawRoutes: WorldRoute[] = [];
    this.markerRoot.query(bounds, new Set<WorldMarker>(), rawMarkers);
    this.polylineRoot.query(bounds, new Set<WorldPolyline>(), rawPolylines);
    this.routeRoot.query(bounds, new Set<WorldRoute>(), rawRoutes);

    const markers = rawMarkers.filter((m) => lod >= m.minLod && lod <= m.maxLod);
    return { markers, polylines: rawPolylines, routes: rawRoutes };
  }

  public recalculateRiverFlows(snapThreshold: number = 10): Map<string, number> {
    const rivers = Array.from(this.polylines.values()).filter((p) => p.type === 'river' && p.points.length >= 2);
    const flows = new Map<string, number>();
    if (rivers.length === 0) return flows;

    // Spatial hash bucket for river start points: O(N) confluence matching
    const cellSize = Math.max(1, snapThreshold * 2);
    const startBuckets = new Map<string, WorldPolyline[]>();
    for (const r of rivers) {
      const sp = r.points[0];
      const key = `${Math.floor(sp.x / cellSize)},${Math.floor(sp.z / cellSize)}`;
      const list = startBuckets.get(key);
      if (list) list.push(r);
      else startBuckets.set(key, [r]);
    }

    const incoming = new Map<string, string[]>();
    for (const r of rivers) incoming.set(r.id, []);

    const threshSq = snapThreshold * snapThreshold;
    for (const up of rivers) {
      const ep = up.points[up.points.length - 1];
      const bx = Math.floor(ep.x / cellSize);
      const bz = Math.floor(ep.z / cellSize);

      let matched = false;
      for (let dz = -1; dz <= 1 && !matched; dz++) {
        for (let dx = -1; dx <= 1 && !matched; dx++) {
          const candidates = startBuckets.get(`${bx + dx},${bz + dz}`);
          if (!candidates) continue;
          for (const down of candidates) {
            if (down.id === up.id) continue;
            const sp = down.points[0];
            const distSq = (ep.x - sp.x) * (ep.x - sp.x) + (ep.z - sp.z) * (ep.z - sp.z);
            if (distSq <= threshSq) {
              incoming.get(down.id)!.push(up.id);
              matched = true;
              break;
            }
          }
        }
      }
    }

    const riverMap = new Map(rivers.map((r) => [r.id, r]));
    const compute = (id: string, visiting: Set<string>): number => {
      if (flows.has(id)) return flows.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);

      const r = riverMap.get(id)!;
      const ups = incoming.get(id) || [];
      let total = r.sourceVolume ?? (ups.length === 0 ? 1 : 0);
      for (const uid of ups) {
        total += compute(uid, visiting);
      }
      visiting.delete(id);
      flows.set(id, total);
      return total;
    };

    for (const r of rivers) compute(r.id, new Set<string>());
    return flows;
  }
}
