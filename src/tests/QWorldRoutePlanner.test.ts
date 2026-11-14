import { describe, it, expect } from 'vitest';
import {
  QWorldChunkTree,
  CHUNK_SIZE,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
} from '../core/QWorldChunkTree';
import { QWorldVectorTree } from '../core/QWorldVectorTree';
import { planRoute, planMultiStopRoute } from '../core/QWorldRoutePlanner';
import { buildMergedRouteNetwork } from '../core/QWorldRouteNetwork';
import { QWorldStorage } from '../core/QWorldStorage';
import { MARKER_PRESETS } from '../core/QWorldEditorTypes';

function createFlatLandWorld(lod: number = 5, cxMax: number = 3, czMax: number = 3): {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  spacing: number;
} {
  const chunkTree = new QWorldChunkTree();
  const spacing = chunkTree.getSampleSpacing(lod);
  for (let cz = 0; cz <= czMax; cz++) {
    for (let cx = 0; cx <= cxMax; cx++) {
      const chunk = chunkTree.getOrCreateChunk(lod, cx, cz, 0);
      chunk.heights.fill(50);
      chunk.biomes.fill(1); // Grass
      chunk.waterFlags.fill(0); // Land
    }
  }
  const vectorTree = new QWorldVectorTree({
    minX: 0,
    maxX: WORLD_SPAN_X,
    minZ: 0,
    maxZ: WORLD_SPAN_Z,
  });
  return { chunkTree, vectorTree, spacing };
}

describe('QWorldRoutePlanner & Network', () => {
  it('contours around a steep mountain peak between markers A and B', () => {
    const lod = 5; // 81 yd spacing -> 1 chunk = 6,561 yd
    const { chunkTree, vectorTree, spacing } = createFlatLandWorld(lod, 2, 2);
    const chunk = chunkTree.getOrCreateChunk(lod, 1, 1, 0);

    const peakLx = 40;
    const peakLz = 40;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const dist = Math.hypot(lx - peakLx, lz - peakLz);
        if (dist < 14) {
          const h = 50 + Math.round((1 - dist / 14) * 1400);
          chunk.heights[lz * CHUNK_SIZE + lx] = h;
          chunk.biomes[lz * CHUNK_SIZE + lx] = 3; // Rock
        }
      }
    }

    const origin = CHUNK_SIZE * spacing;
    const peakWorldX = origin + peakLx * spacing;
    const peakWorldZ = origin + peakLz * spacing;

    const from = { x: origin + 12 * spacing, z: peakWorldZ };
    const to = { x: origin + 68 * spacing, z: peakWorldZ };

    const res = planRoute({ chunkTree, vectorTree, from, to, routeState: 'path' });
    expect(res).not.toBeNull();
    expect(res!.points.length).toBeGreaterThan(2);

    let maxOffsetFromCenterline = 0;
    let minDistToSummit = Infinity;
    for (const pt of res!.points) {
      maxOffsetFromCenterline = Math.max(maxOffsetFromCenterline, Math.abs(pt.z - peakWorldZ));
      minDistToSummit = Math.min(minDistToSummit, Math.hypot(pt.x - peakWorldX, pt.z - peakWorldZ));
    }

    expect(maxOffsetFromCenterline).toBeGreaterThan(6 * spacing);
    expect(minDistToSummit).toBeGreaterThan(6 * spacing);
    expect(res!.elevationGainYards).toBeLessThan(350);
  });

  it('sends footpaths through forests while routing wagon roads around forests over open hills, inverting walk vs vehicle times', () => {
    const lod = 4; // 243 yd spacing -> 1 chunk = 19,683 yd (~11.2 mi)
    const { chunkTree, vectorTree, spacing } = createFlatLandWorld(lod, 2, 2);
    const chunk = chunkTree.getOrCreateChunk(lod, 1, 1, 0);
    const origin = CHUNK_SIZE * spacing;

    // Paint a dense forest block right between A (lx=12, lz=40) and B (lx=68, lz=40)
    // spanning lx = 24..56, lz = 26..54 (radius ~14 cells), with gentle open hills north of lz=26
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = lz * CHUNK_SIZE + lx;
        if (lx >= 24 && lx <= 56 && lz >= 27 && lz <= 53) {
          chunk.biomes[idx] = 2; // Forest
        } else if (lz < 27) {
          // Gentle open rolling hill north of the forest
          chunk.heights[idx] = 50 + Math.round(Math.sin((lx / CHUNK_SIZE) * Math.PI) * 85);
          chunk.biomes[idx] = 1; // Open Grass hill
        }
      }
    }

    const from = { x: origin + 12 * spacing, z: origin + 40 * spacing };
    const to = { x: origin + 68 * spacing, z: origin + 40 * spacing };

    // 1. Peasant 'path' cuts straight through the forest
    const forestPath = planRoute({ chunkTree, vectorTree, from, to, routeState: 'path' });
    expect(forestPath).not.toBeNull();
    vectorTree.addRoute({
      id: 'peasant-path',
      fromMarkerId: 'a',
      toMarkerId: 'b',
      state: 'path',
      points: forestPath!.points,
      lengthYards: forestPath!.lengthYards,
      travelHours: forestPath!.travelHours,
    });

    const pathMaxLatOffset = Math.max(
      ...forestPath!.points.map((p) => Math.abs(p.z - (origin + 40 * spacing)))
    );
    expect(pathMaxLatOffset).toBeLessThan(6 * spacing); // Stays near centerline through forest

    // 2. Permanent 'road' planned afterward ignores the peasant footpath and routes AROUND the forest!
    const outerRoad = planRoute({ chunkTree, vectorTree, from, to, routeState: 'road' });
    expect(outerRoad).not.toBeNull();

    const roadMaxLatOffset = Math.max(
      ...outerRoad!.points.map((p) => Math.abs(p.z - (origin + 40 * spacing)))
    );
    expect(roadMaxLatOffset).toBeGreaterThan(13 * spacing); // Sweeps outside lz=27..53 forest!
    expect(outerRoad!.lengthYards).toBeGreaterThan(forestPath!.lengthYards);

    // 3. Travel times:
    // - Vehicles (wagons) are MUCH faster on the longer road around the forest than crawling through the forest path!
    expect(outerRoad!.travelHours.vehiclesHours).toBeLessThan(forestPath!.travelHours.vehiclesHours * 0.65);
    // - Walkers are faster taking the shorter footpath through the forest than walking all the way around!
    expect(forestPath!.travelHours.walkingHours).toBeLessThan(outerRoad!.travelHours.walkingHours);
  });

  it('plans multi-stop routes across 3+ places/pins with per-step walking, riding, and vehicle times', () => {
    const lod = 5;
    const { chunkTree, vectorTree, spacing } = createFlatLandWorld(lod, 2, 2);
    const origin = CHUNK_SIZE * spacing;

    const multi = planMultiStopRoute({
      chunkTree,
      vectorTree,
      routeState: 'road',
      stops: [
        { markerId: 'm-city', label: 'Highwatch', x: origin + 10 * spacing, z: origin + 20 * spacing },
        { markerId: 'm-cross', label: 'Old Oak Cross-Roads', x: origin + 40 * spacing, z: origin + 35 * spacing },
        { markerId: 'm-inn', label: 'Wayfarer Inn', x: origin + 70 * spacing, z: origin + 20 * spacing },
      ],
    });

    expect(multi.ok).toBe(true);
    if (!multi.ok) return;
    expect(multi.legs).toHaveLength(2);
    expect(multi.legs[0].fromLabel).toBe('Highwatch');
    expect(multi.legs[0].toLabel).toBe('Old Oak Cross-Roads');
    expect(multi.legs[1].toLabel).toBe('Wayfarer Inn');
    expect(multi.travelHours.ridingHours).toBeLessThan(multi.travelHours.walkingHours);
    expect(multi.travelHours.walkingHours).toBeGreaterThan(0);
    expect(multi.travelHours.vehiclesHours).toBeGreaterThan(0);
  });

  it('merges overlapping route segments and increments trafficCount for busier trunk roads', () => {
    const pStart = { x: 10_000, z: 10_000 };
    const pCross = { x: 15_000, z: 10_000 };
    const pNorth = { x: 20_000, z: 7_000 };
    const pEast = { x: 20_000, z: 10_000 };
    const pSouth = { x: 20_000, z: 13_000 };

    const strands = buildMergedRouteNetwork({
      cellSize: 100,
      routes: [
        {
          id: 'r1',
          fromMarkerId: 'a',
          toMarkerId: 'n',
          state: 'road',
          points: [pStart, pCross, pNorth],
          lengthYards: 10_800,
        },
        {
          id: 'r2',
          fromMarkerId: 'a',
          toMarkerId: 'e',
          state: 'road',
          points: [pStart, pCross, pEast],
          lengthYards: 10_000,
        },
        {
          id: 'r3',
          fromMarkerId: 'a',
          toMarkerId: 's',
          state: 'path',
          points: [pStart, pCross, pSouth],
          lengthYards: 10_800,
        },
      ],
    });

    const busyTrunk = strands.find((s) => s.trafficCount === 3);
    expect(busyTrunk).toBeDefined();
    // Mixed 'path' + 'road' trunk promotes to 'road'
    expect(busyTrunk!.state).toBe('road');

    const singleBranches = strands.filter((s) => s.trafficCount === 1);
    expect(singleBranches.length).toBeGreaterThanOrEqual(3);
  });

  it('includes Cross-Roads, Inn, and Village presets and persists multi-stop routes in QWorldStorage', () => {
    expect(MARKER_PRESETS.some((p) => p.category === 'crossroads')).toBe(true);
    expect(MARKER_PRESETS.some((p) => p.category === 'inn')).toBe(true);
    expect(MARKER_PRESETS.some((p) => p.category === 'village')).toBe(true);

    const { chunkTree, vectorTree } = createFlatLandWorld(5, 1, 1);
    vectorTree.addRoute({
      id: 'route-1',
      name: 'Highwatch → Cross-Roads → Town 2',
      fromMarkerId: 'm-a',
      toMarkerId: 'm-b',
      stops: [
        { markerId: 'm-a', label: 'Highwatch', x: 1000, z: 1000 },
        { markerId: 'm-c', label: 'Cross-Roads', x: 2500, z: 1800 },
        { markerId: 'm-b', label: 'Town 2', x: 4200, z: 2200 },
      ],
      travelHours: { walkingHours: 0.8, ridingHours: 0.5, vehiclesHours: 0.9 },
      state: 'road',
      points: [
        { x: 1000, z: 1000 },
        { x: 2500, z: 1800 },
        { x: 4200, z: 2200 },
      ],
      lengthYards: 3450,
      elevationGainYards: 95,
    });

    const json = QWorldStorage.serializeToJson(chunkTree, vectorTree, 'Route Test');
    const restored = QWorldStorage.deserializeFromJson(json);
    const restoredRoute = restored.vectorTree.getRoute('route-1');
    expect(restoredRoute?.stops).toHaveLength(3);
    expect(restoredRoute?.travelHours?.vehiclesHours).toBe(0.9);
  });
});
