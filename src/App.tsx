import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { QWorldBrushEngine, ElevationBrushMode, PolygonActionType } from './core/QWorldBrushEngine';
import { QWorldWaterFlood, OceanSeedCell } from './core/QWorldWaterFlood';
import { WorldPoint2D, WorldMarker, WorldRoute, RouteState, RouteStop } from './core/QWorldVectorTree';
import {
  planMultiStopRoute,
  computeRouteTravelHours,
  formatTravelTime,
  wrapDeltaX,
  wrapX,
} from './core/QWorldRoutePlanner';
import { WORLD_SPAN_X, WORLD_SPAN_Z, TerrainChunk } from './core/QWorldChunkTree';
import { QWorldStorage } from './core/QWorldStorage';
import { QWorldIndexedDb } from './core/QWorldIndexedDb';
import {
  generateStarterWorld,
  createRandomSeed,
  WorldGenOptions,
  DEFAULT_WORLD_GEN_OPTIONS,
} from './core/QWorldStarterGenerator';
import {
  EditorToolMode,
  CameraPresetMode,
  MARKER_PRESETS,
  WeatherLayerToggles,
  DEFAULT_WEATHER_LAYERS,
} from './core/QWorldEditorTypes';
import { TerrainRenderMode } from './core/QWorldTerrainMesh';
import { QWorldToolbar } from './components/QWorldToolbar';
import { RoadSubMode } from './components/QWorldToolOptionsBar';
import { QWorld3DViewport } from './components/QWorld3DViewport';
import { QWorldRightPanel } from './components/QWorldRightPanel';
import { worldCoordsToLatLon, computeSolarDeclinationDeg } from './core/QWorldCelestial';
import { computeAtmosphereField, applyAtmosphereToWorldChunks } from './core/QWorldAtmosphere';
import {
  VolcanoSource,
  computeVolcanicFallout,
  packSkyVeilSyncGrid,
  SyncedVolcanicSky,
} from './core/QWorldVolcanicFallout';
import { QWorldTerrainWorkerClient } from './workers/QWorldTerrainWorkerClient';

const RIGHT_PANEL_WIDTH_KEY = 'adventure2_right_panel_width_v2';

function loadSavedPanelWidth(): number {
  try {
    const raw = localStorage.getItem(RIGHT_PANEL_WIDTH_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return Math.max(300, Math.min(760, parsed));
    }
  } catch {
    // Ignore localStorage unavailability
  }
  return 480;
}

export const App: React.FC = () => {
  const initialRef = useRef<ReturnType<typeof generateStarterWorld> | null>(null);
  if (!initialRef.current) {
    initialRef.current = generateStarterWorld();
  }

  const [worldState, setWorldState] = useState(() => initialRef.current!);
  const [worldGenOptions, setWorldGenOptions] = useState<WorldGenOptions>(DEFAULT_WORLD_GEN_OPTIONS);
  const [revision, setRevision] = useState(0);
  const [terrainRevision, setTerrainRevision] = useState(0);
  const [toolMode, setToolMode] = useState<EditorToolMode>('marker');
  const [renderMode, setRenderMode] = useState<TerrainRenderMode>('normal');
  const [flatWaterSurface, setFlatWaterSurface] = useState(false);
  const [showFaultLines, setShowFaultLines] = useState(true);
  const [worldHours, setWorldHours] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('adventure2_sky_sync_state');
      if (raw) {
        const parsed = JSON.parse(raw) as { worldHours?: number };
        if (typeof parsed.worldHours === 'number' && Number.isFinite(parsed.worldHours)) {
          return parsed.worldHours;
        }
      }
    } catch {
      // Ignore localStorage unavailability
    }
    return 79 * 24 + 12; // Day 80 (Spring Equinox), 12:00 Noon
  });
  const [cameraPreset, setCameraPreset] = useState<CameraPresetMode>('3d');
  const [viewAlignment, setViewAlignment] = useState<'ns' | 'sun'>('ns');
  const [resetViewNonce, setResetViewNonce] = useState(0);
  const [activeLod, setActiveLod] = useState(0);

  const [elevBrushMode, setElevBrushMode] = useState<ElevationBrushMode>('raise');
  const [brushRadiusCells, setBrushRadiusCells] = useState(8);
  const [brushStrength, setBrushStrength] = useState(40);
  const [autoFloodOcean, setAutoFloodOcean] = useState(true);
  const [activeBiomeId, setActiveBiomeId] = useState(2); // Forest
  const [activeMarkerCategory, setActiveMarkerCategory] = useState('city');
  const [riverVolume, setRiverVolume] = useState(3);
  const [draftPoints, setDraftPoints] = useState<WorldPoint2D[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<WorldPoint2D[]>([]);
  const [polygonAmount, setPolygonAmount] = useState(300);

  const [rightPanelWidth, setRightPanelWidth] = useState<number>(loadSavedPanelWidth);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [tempPin, setTempPin] = useState<WorldPoint2D | null>(null);
  const [roadSubMode, setRoadSubMode] = useState<RoadSubMode>('route');
  const [routeFromStop, setRouteFromStop] = useState<RouteStop | null>(null);
  const [routeViaStops, setRouteViaStops] = useState<RouteStop[]>([]);
  const [routeToStop, setRouteToStop] = useState<RouteStop | null>(null);
  const [routeDraftState, setRouteDraftState] = useState<RouteState>('path');
  const [mergeRouteNetwork, setMergeRouteNetwork] = useState(true);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [routeStatusMsg, setRouteStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [weatherLayers, setWeatherLayers] = useState<WeatherLayerToggles>(DEFAULT_WEATHER_LAYERS);
  const [weatherRecalcNonce, setWeatherRecalcNonce] = useState(0);
  const [weatherRevision, setWeatherRevision] = useState(0);
  const [weatherStatusMsg, setWeatherStatusMsg] = useState<string | null>(null);

  const activeRouteStops = useMemo<RouteStop[]>(
    () => [routeFromStop, ...routeViaStops, routeToStop].filter((s): s is RouteStop => s !== null),
    [routeFromStop, routeViaStops, routeToStop]
  );
  const [panToMarkerRequest, setPanToMarkerRequest] = useState<{
    x: number;
    z: number;
    distance?: number;
    nonce: number;
  } | null>(null);
  const cameraTargetRef = useRef({ x: WORLD_SPAN_X * 0.5, z: WORLD_SPAN_Z * 0.5, distance: 950000 });

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth));
    } catch {
      // Ignore localStorage unavailability
    }
  }, [rightPanelWidth]);

  const brushEngineRef = useRef(new QWorldBrushEngine(worldState.chunkTree));
  const waterFloodRef = useRef(new QWorldWaterFlood(worldState.chunkTree, worldState.seaLevel));
  const terrainWorkerClientRef = useRef<QWorldTerrainWorkerClient | null>(null);
  if (!terrainWorkerClientRef.current) {
    terrainWorkerClientRef.current = new QWorldTerrainWorkerClient();
  }

  useEffect(() => {
    return () => {
      terrainWorkerClientRef.current?.dispose();
      terrainWorkerClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    brushEngineRef.current = new QWorldBrushEngine(worldState.chunkTree);
    waterFloodRef.current = new QWorldWaterFlood(worldState.chunkTree, worldState.seaLevel);
    terrainWorkerClientRef.current?.syncWorld(worldState.chunkTree);
  }, [worldState]);

  const volcanoMarkers = useMemo(
    () => worldState.vectorTree.getAllMarkers().filter((m) => m.category === 'volcano'),
    [worldState, revision]
  );

  const volcanoSources = useMemo<VolcanoSource[]>(
    () =>
      volcanoMarkers.map((m) => ({
        id: m.id,
        name: m.name,
        x: m.x,
        z: m.z,
        magnitude: m.eruptionMagnitude ?? 7,
        active: Boolean(m.eruptionActive),
      })),
    [volcanoMarkers]
  );

  const solarDeclBucket = Math.round(computeSolarDeclinationDeg(worldHours) / 2) * 2;
  const atmosphereField = useMemo(
    () =>
      computeAtmosphereField(worldState.chunkTree, {
        seaLevel: worldState.seaLevel,
        solarDeclinationDeg: solarDeclBucket,
        baseTempC: worldGenOptions.baseTempC,
      }),
    [worldState, weatherRecalcNonce, solarDeclBucket, worldGenOptions.baseTempC]
  );

  const volcanicFallout = useMemo(
    () => computeVolcanicFallout(atmosphereField, volcanoSources),
    [atmosphereField, volcanoSources]
  );

  useEffect(() => {
    const useAsh = weatherLayers.renderAshInWorld && volcanoSources.some((v) => v.active);
    terrainWorkerClientRef.current?.syncAtmosphere(
      useAsh ? volcanicFallout.ashFallout : null,
      useAsh ? volcanicFallout.skyVeil : null
    );
    setWeatherRevision((r) => r + 1);
  }, [volcanicFallout, weatherLayers.renderAshInWorld, volcanoSources, worldState]);

  // Load saved world from IndexedDB on startup if present
  useEffect(() => {
    QWorldIndexedDb.loadActiveWorld()
      .then((json) => {
        if (!json) return;
        const restored = QWorldStorage.deserializeFromJson(json);
        const oceanSeeds: OceanSeedCell[] = [{ cx: -1, cz: -1, lx: 1, lz: 1 }];
        const sl = restored.seaLevel ?? 0;
        setWorldState({
          seed: 'SAVED',
          chunkTree: restored.chunkTree,
          vectorTree: restored.vectorTree,
          oceanSeeds,
          seaLevel: sl,
        });
        if (restored.seaLevel !== undefined) {
          setWorldGenOptions((prev) => ({ ...prev, seaLevel: sl }));
        }
        setTerrainRevision((r) => r + 1);
        setRevision((r) => r + 1);
      })
      .catch(() => {
        // Ignore IndexedDB unavailability in restricted contexts
      });
  }, []);

  // Debounced auto-save to IndexedDB on edits
  useEffect(() => {
    if (revision === 0) return;
    const timer = setTimeout(() => {
      const json = QWorldStorage.serializeToJson(
        worldState.chunkTree,
        worldState.vectorTree,
        'Adventure2 World',
        worldState.seaLevel
      );
      QWorldIndexedDb.saveActiveWorld(json).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [revision, worldState]);

  const handleBrushStroke = useCallback(
    (worldX: number, worldZ: number, lod: number) => {
      const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
      const clampedZ = Math.max(0, Math.min(WORLD_SPAN_Z, worldZ));
      const spacing = worldState.chunkTree.getSampleSpacing(lod);
      const radiusWorld = brushRadiusCells * spacing;
      const minGx = Math.floor((wrappedX - radiusWorld) / spacing);
      const maxGx = Math.ceil((wrappedX + radiusWorld) / spacing);
      const minGz = Math.floor((clampedZ - radiusWorld) / spacing);
      const maxGz = Math.ceil((clampedZ + radiusWorld) / spacing);

      if (toolMode === 'elevate') {
        const targetHeight = elevBrushMode === 'flatten' ? worldState.chunkTree.getHeightAt(lod, wrappedX, clampedZ) : 0;
        brushEngineRef.current.applyElevationBrush({
          lod,
          worldX: wrappedX,
          worldZ: clampedZ,
          radiusWorld,
          mode: elevBrushMode,
          strength: brushStrength,
          targetHeight,
        });
        if (autoFloodOcean) {
          waterFloodRef.current.propagateFromSeeds(lod, worldState.oceanSeeds);
          if (lod > 0) {
            worldState.chunkTree.rollupToParent(lod, minGx, maxGx, minGz, maxGz);
          }
        }
      } else if (toolMode === 'biome') {
        brushEngineRef.current.applyBiomeBrush({
          lod,
          worldX: wrappedX,
          worldZ: clampedZ,
          radiusWorld,
          biomeId: activeBiomeId,
        });
      }
      const hierarchyChunks = worldState.chunkTree.collectChunksInGridHierarchy(
        lod,
        minGx,
        maxGx,
        minGz,
        maxGz
      );
      if (hierarchyChunks.length > 0) {
        terrainWorkerClientRef.current?.patchChunks(hierarchyChunks, undefined, undefined, {
          parentLod: lod,
          minGx,
          maxGx,
          minGz,
          maxGz,
        });
      }
      setTerrainRevision((r) => r + 1);
      setRevision((r) => r + 1);
    },
    [worldState, toolMode, elevBrushMode, brushRadiusCells, brushStrength, autoFloodOcean, activeBiomeId]
  );

  const recomputeAndRollupOcean = useCallback(
    (lod: number) => {
      const range = worldState.chunkTree.getStoredChunkRange(lod);
      if (!range) return;
      waterFloodRef.current.recomputeArea(lod, range, worldState.oceanSeeds);
      const lodChunks = worldState.chunkTree.getStoredChunksForLod(lod);
      if (lod > 0) {
        for (const c of lodChunks) {
          worldState.chunkTree.rollupChunksToParent(lod, c.cx, c.cx, c.cz, c.cz);
        }
      }
      const allUpdated: TerrainChunk[] = [];
      for (let l = 0; l <= lod; l++) {
        allUpdated.push(...worldState.chunkTree.getStoredChunksForLod(l));
      }
      terrainWorkerClientRef.current?.patchChunks(allUpdated);
      setTerrainRevision((r) => r + 1);
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleBrushEnd = useCallback(
    (lod: number) => {
      if (toolMode === 'elevate') {
        if (autoFloodOcean) {
          recomputeAndRollupOcean(lod);
        }
        setWeatherRecalcNonce((n) => n + 1);
      }
    },
    [toolMode, autoFloodOcean, recomputeAndRollupOcean]
  );

  const handleMapClick = useCallback(
    (worldX: number, worldZ: number, _lod: number) => {
      if (toolMode === 'marker') {
        setTempPin({ x: worldX, z: worldZ });
        setSelectedMarkerId(null);
      } else if (toolMode === 'river' || (toolMode === 'road' && roadSubMode === 'freehand')) {
        setDraftPoints((pts) => [...pts, { x: worldX, z: worldZ }]);
      } else if (toolMode === 'polygon') {
        setPolygonPoints((pts) => [...pts, { x: worldX, z: worldZ }]);
      }
    },
    [toolMode, roadSubMode]
  );

  const handleAddMarker = useCallback(() => {
    const pos = tempPin ?? { x: cameraTargetRef.current.x, z: cameraTargetRef.current.z };
    const preset = MARKER_PRESETS.find((p) => p.category === activeMarkerCategory) ?? MARKER_PRESETS[0];
    const count = worldState.vectorTree.getMarkerCount() + 1;
    const id = `marker-${Date.now()}-${count}`;
    const snappedElev = Math.round(
      worldState.chunkTree.getSurfaceHeightAt(activeLod, pos.x, pos.z, flatWaterSurface, worldState.seaLevel)
    );
    worldState.vectorTree.addMarker({
      id,
      name: `${preset.label} ${count}`,
      category: preset.category,
      x: pos.x,
      y: snappedElev,
      z: pos.z,
      minLod: Math.min(activeLod, preset.minLod),
      maxLod: preset.maxLod,
      notes: '',
      zoomDistance: cameraTargetRef.current.distance,
      locked: false,
      ...(preset.category === 'volcano' ? { eruptionActive: true, eruptionMagnitude: 7 } : {}),
    });
    setTempPin(null);
    setSelectedMarkerId(id);
    setRevision((r) => r + 1);
  }, [tempPin, activeMarkerCategory, worldState, activeLod, flatWaterSurface]);

  const handleMoveMarker = useCallback(
    (id: string, worldX: number, worldZ: number, terrainY: number) => {
      const existing = worldState.vectorTree.getMarker(id);
      if (!existing || existing.locked) return;
      const wrappedX = ((worldX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
      const clampedZ = Math.max(0, Math.min(WORLD_SPAN_Z, worldZ));
      worldState.vectorTree.updateMarker(id, {
        x: wrappedX,
        z: clampedZ,
        y: Math.round(terrainY),
      });
      setRouteFromStop((prev) => (prev?.markerId === id ? { ...prev, x: wrappedX, z: clampedZ } : prev));
      setRouteViaStops((prev) =>
        prev.some((s) => s.markerId === id)
          ? prev.map((s) => (s.markerId === id ? { ...s, x: wrappedX, z: clampedZ } : s))
          : prev
      );
      setRouteToStop((prev) => (prev?.markerId === id ? { ...prev, x: wrappedX, z: clampedZ } : prev));
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleUpdateMarker = useCallback(
    (id: string, patch: Partial<WorldMarker>) => {
      worldState.vectorTree.updateMarker(id, patch);
      if (patch.name !== undefined) {
        const nextLabel = patch.name;
        setRouteFromStop((prev) => (prev?.markerId === id ? { ...prev, label: nextLabel } : prev));
        setRouteViaStops((prev) =>
          prev.some((s) => s.markerId === id)
            ? prev.map((s) => (s.markerId === id ? { ...s, label: nextLabel } : s))
            : prev
        );
        setRouteToStop((prev) => (prev?.markerId === id ? { ...prev, label: nextLabel } : prev));
      }
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleDeleteMarker = useCallback(
    (id: string) => {
      worldState.vectorTree.removeMarker(id);
      setSelectedMarkerId((prev) => (prev === id ? null : prev));
      setRouteFromStop((prev) => (prev?.markerId === id ? null : prev));
      setRouteViaStops((prev) => prev.filter((s) => s.markerId !== id));
      setRouteToStop((prev) => (prev?.markerId === id ? null : prev));
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleClearRouteStops = useCallback(() => {
    setRouteFromStop(null);
    setRouteViaStops([]);
    setRouteToStop(null);
    setRouteStatusMsg(null);
  }, []);

  const handleAddRouteStopPin = useCallback(
    (stop: RouteStop) => {
      const existingCustomPins = [routeFromStop, ...routeViaStops, routeToStop].filter(
        (s) => s !== null && !s.markerId
      ).length;
      const namedStop: RouteStop = stop.markerId
        ? stop
        : { ...stop, label: `Pin ${existingCustomPins + 1}` };

      if (!routeFromStop) {
        setRouteFromStop(namedStop);
      } else if (!routeToStop) {
        setRouteToStop(namedStop);
      } else {
        setRouteViaStops((prev) => [...prev, routeToStop]);
        setRouteToStop(namedStop);
      }
      setRouteStatusMsg(null);
    },
    [routeFromStop, routeViaStops, routeToStop]
  );

  const handlePlanRoute = useCallback(() => {
    if (activeRouteStops.length < 2) return;

    const resolvedStops: RouteStop[] = activeRouteStops.map((st) => {
      if (!st.markerId) return st;
      const m = worldState.vectorTree.getMarker(st.markerId);
      return m ? { markerId: m.id, label: m.name, x: m.x, z: m.z } : st;
    });

    if (
      resolvedStops.length === 2 &&
      resolvedStops[0].markerId &&
      resolvedStops[0].markerId === resolvedStops[1].markerId
    ) {
      return;
    }

    const planned = planMultiStopRoute({
      chunkTree: worldState.chunkTree,
      vectorTree: worldState.vectorTree,
      stops: resolvedStops,
      routeState: routeDraftState,
      seaLevel: worldState.seaLevel,
    });

    if (!planned.ok) {
      setRouteStatusMsg({
        text: `No overland ${routeDraftState} found between ${planned.fromLabel} and ${planned.toLabel} (blocked by open water).`,
        isError: true,
      });
      return;
    }

    const id = `route-${Date.now()}-${worldState.vectorTree.getRouteCount() + 1}`;
    const routeName = resolvedStops.map((s) => s.label).join(' → ');
    worldState.vectorTree.addRoute({
      id,
      name: routeName,
      fromMarkerId: resolvedStops[0].markerId ?? '',
      toMarkerId: resolvedStops[resolvedStops.length - 1].markerId ?? '',
      state: routeDraftState,
      points: planned.points,
      lengthYards: planned.lengthYards,
      elevationGainYards: planned.elevationGainYards,
      stops: resolvedStops,
      legs: planned.legs,
      travelHours: planned.travelHours,
    });
    setSelectedRouteId(id);
    const distLabel =
      planned.lengthYards >= 1760
        ? `${(planned.lengthYards / 1760).toFixed(2)} mi`
        : `${planned.lengthYards.toLocaleString()} yd`;
    setRouteStatusMsg({
      text: `Planned ${distLabel} ${routeDraftState} · 🚶 ${formatTravelTime(
        planned.travelHours.walkingHours
      )} · 🛞 ${formatTravelTime(planned.travelHours.vehiclesHours)}${
        planned.usedExistingRoad ? ' · joined road' : ''
      }.`,
    });
    setRevision((r) => r + 1);
  }, [activeRouteStops, routeDraftState, worldState]);

  const handleReplanRoute = useCallback(
    (routeId: string) => {
      const existing = worldState.vectorTree.getRoute(routeId);
      if (!existing || existing.points.length < 2) return;

      let stopsToReplan: RouteStop[];
      if (existing.stops && existing.stops.length >= 2) {
        stopsToReplan = existing.stops.map((st) => {
          if (!st.markerId) return st;
          const m = worldState.vectorTree.getMarker(st.markerId);
          return m ? { markerId: m.id, label: m.name, x: m.x, z: m.z } : st;
        });
      } else {
        const fromM = worldState.vectorTree.getMarker(existing.fromMarkerId);
        const toM = worldState.vectorTree.getMarker(existing.toMarkerId);
        const fromPt = fromM ? { x: fromM.x, z: fromM.z } : existing.points[0];
        const toPt = toM ? { x: toM.x, z: toM.z } : existing.points[existing.points.length - 1];
        stopsToReplan = [
          { markerId: fromM?.id, label: fromM?.name ?? 'Origin', x: fromPt.x, z: fromPt.z },
          { markerId: toM?.id, label: toM?.name ?? 'Destination', x: toPt.x, z: toPt.z },
        ];
      }

      const planned = planMultiStopRoute({
        chunkTree: worldState.chunkTree,
        vectorTree: worldState.vectorTree,
        stops: stopsToReplan,
        routeState: existing.state,
        seaLevel: worldState.seaLevel,
        excludeRouteId: routeId,
      });

      if (!planned.ok) {
        setRouteStatusMsg({
          text: `Re-plan blocked between ${planned.fromLabel} and ${planned.toLabel}; kept previous route.`,
          isError: true,
        });
        return;
      }

      worldState.vectorTree.updateRoute(routeId, {
        name: stopsToReplan.map((s) => s.label).join(' → '),
        points: planned.points,
        lengthYards: planned.lengthYards,
        elevationGainYards: planned.elevationGainYards,
        stops: stopsToReplan,
        legs: planned.legs,
        travelHours: planned.travelHours,
      });
      setSelectedRouteId(routeId);
      setRouteStatusMsg({ text: 'Route updated to match current stops, roads, and terrain.' });
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleUpdateRoute = useCallback(
    (routeId: string, patch: Partial<WorldRoute>) => {
      const existing = worldState.vectorTree.getRoute(routeId);
      const nextPatch: Partial<WorldRoute> = { ...patch };
      if (existing && patch.state && patch.state !== existing.state) {
        nextPatch.travelHours = computeRouteTravelHours({
          chunkTree: worldState.chunkTree,
          vectorTree: worldState.vectorTree,
          points: existing.points,
          routeState: patch.state,
          excludeRouteId: routeId,
        });
        if (existing.legs && existing.legs.length > 0) {
          nextPatch.legs = existing.legs.map((leg) => ({
            ...leg,
            travelHours: computeRouteTravelHours({
              chunkTree: worldState.chunkTree,
              vectorTree: worldState.vectorTree,
              points: leg.points,
              routeState: patch.state!,
              excludeRouteId: routeId,
            }),
          }));
        }
      }
      worldState.vectorTree.updateRoute(routeId, nextPatch);
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleDeleteRoute = useCallback(
    (routeId: string) => {
      worldState.vectorTree.removeRoute(routeId);
      setSelectedRouteId((prev) => (prev === routeId ? null : prev));
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleShowRoute = useCallback((route: WorldRoute) => {
    if (route.points.length === 0) return;
    let curX = route.points[0].x;
    let minX = curX;
    let maxX = curX;
    let minZ = route.points[0].z;
    let maxZ = route.points[0].z;
    for (let i = 1; i < route.points.length; i++) {
      curX += wrapDeltaX(route.points[i].x - wrapX(curX));
      if (curX < minX) minX = curX;
      if (curX > maxX) maxX = curX;
      if (route.points[i].z < minZ) minZ = route.points[i].z;
      if (route.points[i].z > maxZ) maxZ = route.points[i].z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    setSelectedRouteId(route.id);
    setPanToMarkerRequest({
      x: wrapX((minX + maxX) * 0.5),
      z: (minZ + maxZ) * 0.5,
      distance: Math.max(350, span * 1.55),
      nonce: Date.now(),
    });
  }, []);

  const handleShowMarker = useCallback((marker: WorldMarker) => {
    setPanToMarkerRequest({
      x: marker.x,
      z: marker.z,
      distance: marker.zoomDistance,
      nonce: Date.now(),
    });
  }, []);

  const handlePanToMarker = useCallback((marker: WorldMarker) => {
    setPanToMarkerRequest({
      x: marker.x,
      z: marker.z,
      nonce: Date.now(),
    });
  }, []);

  const handlePanToWorldPoint = useCallback((pt: WorldPoint2D) => {
    setPanToMarkerRequest({
      x: pt.x,
      z: pt.z,
      nonce: Date.now(),
    });
  }, []);

  const handleCameraDistanceChange = useCallback(
    (distance: number) => {
      if (!selectedMarkerId) return;
      worldState.vectorTree.updateMarker(selectedMarkerId, { zoomDistance: distance });
      setRevision((r) => r + 1);
    },
    [selectedMarkerId, worldState]
  );

  const handleSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const nextWidth = Math.max(300, Math.min(760, window.innerWidth - ev.clientX));
      setRightPanelWidth(nextWidth);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const handleUpdatePolygonVertex = useCallback((index: number, worldX: number, worldZ: number) => {
    setPolygonPoints((pts) => pts.map((p, i) => (i === index ? { x: worldX, z: worldZ } : p)));
  }, []);

  const handleApplyPolygonAction = useCallback(
    (action: PolygonActionType) => {
      if (polygonPoints.length < 3 || !brushEngineRef.current) return;
      brushEngineRef.current.applyPolygonAction({
        lod: activeLod,
        polygon: polygonPoints,
        action,
        amount: polygonAmount,
        biomeId: activeBiomeId,
      });
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of polygonPoints) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      const spacing = worldState.chunkTree.getSampleSpacing(activeLod);
      const minGx = Math.floor(minX / spacing);
      const maxGx = Math.ceil(maxX / spacing);
      const minGz = Math.floor(minZ / spacing);
      const maxGz = Math.ceil(maxZ / spacing);
      if (action !== 'biome' && autoFloodOcean) {
        recomputeAndRollupOcean(activeLod);
      }
      const hierarchyChunks = worldState.chunkTree.collectChunksInGridHierarchy(
        activeLod,
        minGx,
        maxGx,
        minGz,
        maxGz
      );
      terrainWorkerClientRef.current?.patchChunks(hierarchyChunks, undefined, undefined, {
        parentLod: activeLod,
        minGx,
        maxGx,
        minGz,
        maxGz,
      });
      if (action !== 'biome') {
        setWeatherRecalcNonce((n) => n + 1);
      }
      setTerrainRevision((r) => r + 1);
      setRevision((r) => r + 1);
    },
    [polygonPoints, activeLod, polygonAmount, activeBiomeId, autoFloodOcean, recomputeAndRollupOcean, worldState]
  );

  const handleApplyClimateAndFoliage = useCallback(() => {
    const hasActiveEruption = volcanoSources.some((v) => v.active);
    applyAtmosphereToWorldChunks(worldState.chunkTree, atmosphereField, volcanicFallout, {
      seaLevel: worldState.seaLevel,
      baseTempC: worldGenOptions.baseTempC,
      applyAshBiomeDevastation: weatherLayers.renderAshInWorld && hasActiveEruption,
    });
    terrainWorkerClientRef.current?.syncWorld(worldState.chunkTree);
    const useAsh = weatherLayers.renderAshInWorld && hasActiveEruption;
    terrainWorkerClientRef.current?.syncAtmosphere(
      useAsh ? volcanicFallout.ashFallout : null,
      useAsh ? volcanicFallout.skyVeil : null
    );
    setTerrainRevision((r) => r + 1);
    setRevision((r) => r + 1);
    setWeatherRecalcNonce((n) => n + 1);
    setWeatherStatusMsg('Rainfall and foliage maps updated from winds, storms, and ashfall.');
  }, [worldState, atmosphereField, volcanicFallout, volcanoSources, worldGenOptions.baseTempC, weatherLayers.renderAshInWorld]);

  const handleFinishPath = useCallback(() => {
    if (draftPoints.length < 2) return;
    const type = toolMode === 'river' ? 'river' : 'road';
    worldState.vectorTree.addPolyline({
      id: `${type}-${Date.now()}`,
      type,
      points: draftPoints,
      sourceVolume: type === 'river' ? riverVolume : undefined,
    });
    setDraftPoints([]);
    setRevision((r) => r + 1);
  }, [draftPoints, toolMode, riverVolume, worldState]);

  const handleAutoFloodOceanChange = useCallback(
    (enabled: boolean) => {
      setAutoFloodOcean(enabled);
      if (enabled) {
        recomputeAndRollupOcean(activeLod);
      }
    },
    [activeLod, recomputeAndRollupOcean]
  );

  const handleExportJson = () => {
    const json = QWorldStorage.serializeToJson(
      worldState.chunkTree,
      worldState.vectorTree,
      'Adventure2 World',
      worldState.seaLevel
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adventure2-world.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const restored = QWorldStorage.deserializeFromJson(reader.result);
      const sl = restored.seaLevel ?? 0;
      setWorldState({
        seed: 'IMPORTED',
        chunkTree: restored.chunkTree,
        vectorTree: restored.vectorTree,
        oceanSeeds: [{ cx: -1, cz: -1, lx: 1, lz: 1 }],
        seaLevel: sl,
      });
      if (restored.seaLevel !== undefined) {
        setWorldGenOptions((prev) => ({ ...prev, seaLevel: sl }));
      }
      setDraftPoints([]);
      setRouteFromStop(null);
      setRouteViaStops([]);
      setRouteToStop(null);
      setSelectedRouteId(null);
      setRouteStatusMsg(null);
      setTerrainRevision((r) => r + 1);
      setRevision((r) => r + 1);
    };
    reader.readAsText(file);
  };

  const handleResetStarterWorld = (seed?: string, options?: WorldGenOptions) => {
    const nextOpts = options ?? worldGenOptions;
    if (options) setWorldGenOptions(options);
    setWorldState(generateStarterWorld(seed ?? createRandomSeed(), nextOpts));
    setDraftPoints([]);
    setPolygonPoints([]);
    setRouteFromStop(null);
    setRouteViaStops([]);
    setRouteToStop(null);
    setSelectedRouteId(null);
    setRouteStatusMsg(null);
    setTerrainRevision((r) => r + 1);
    setRevision((r) => r + 1);
  };

  const selectedMarker = selectedMarkerId ? (worldState.vectorTree.getMarker(selectedMarkerId) ?? null) : null;
  const selectedMarkerElevation = selectedMarker
    ? Math.round(
        worldState.chunkTree.getSurfaceHeightAt(
          activeLod,
          selectedMarker.x,
          selectedMarker.z,
          flatWaterSurface,
          worldState.seaLevel
        )
      )
    : null;

  const worldHoursRef = useRef(worldHours);
  worldHoursRef.current = worldHours;
  const skySyncChannelRef = useRef<BroadcastChannel | null>(null);

  const buildSkySyncPayload = useCallback(() => {
    const camLatLon = worldCoordsToLatLon(cameraTargetRef.current.x, cameraTargetRef.current.z);
    const markers = worldState.vectorTree.getAllMarkers().map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      ...worldCoordsToLatLon(m.x, m.z),
    }));
    const activePin = selectedMarker
      ? { id: selectedMarker.id, name: selectedMarker.name, ...worldCoordsToLatLon(selectedMarker.x, selectedMarker.z) }
      : tempPin
        ? { id: 'temp-pin', name: 'Temporary Pin', ...worldCoordsToLatLon(tempPin.x, tempPin.z) }
        : null;
    const activeVolcanoes = volcanoSources
      .filter((v) => v.active)
      .map((v) => ({
        name: v.name,
        magnitude: v.magnitude,
        ...worldCoordsToLatLon(v.x, v.z),
      }));
    const volcanicSky: SyncedVolcanicSky = {
      veilGrid36x18:
        weatherLayers.renderAshInWorld && activeVolcanoes.length > 0
          ? packSkyVeilSyncGrid(volcanicFallout.skyVeil)
          : null,
      activeVolcanoes: weatherLayers.renderAshInWorld ? activeVolcanoes : [],
    };
    return {
      type: 'map-state' as const,
      source: 'map' as const,
      camera: camLatLon,
      activePin,
      markers,
      worldHours: worldHoursRef.current,
      volcanicSky,
      updatedAt: Date.now(),
    };
  }, [worldState, selectedMarker, tempPin, volcanoSources, volcanicFallout, weatherLayers.renderAshInWorld]);

  const buildSkySyncPayloadRef = useRef(buildSkySyncPayload);
  buildSkySyncPayloadRef.current = buildSkySyncPayload;

  const handleToolbarWorldHoursChange = useCallback((newHours: number) => {
    const clampedHours = Math.max(0, newHours);
    worldHoursRef.current = clampedHours;
    setWorldHours(clampedHours);
    const now = Date.now();
    const timeMsg = {
      type: 'time-sync' as const,
      source: 'map' as const,
      worldHours: clampedHours,
      updatedAt: now,
    };
    try {
      skySyncChannelRef.current?.postMessage(timeMsg);
    } catch (err: unknown) {
      console.warn('[App] BroadcastChannel postMessage failed:', err);
    }
    try {
      const base = buildSkySyncPayloadRef.current();
      localStorage.setItem(
        'adventure2_sky_sync_state',
        JSON.stringify({ ...base, ...timeMsg })
      );
    } catch (err: unknown) {
      console.warn('[App] localStorage time-sync write failed:', err);
    }
  }, []);

  // Persistent BroadcastChannel & periodic map center / marker / ash sync
  useEffect(() => {
    if (!window.name) {
      window.name = 'adventure2_main_map';
    }
    let channel: BroadcastChannel | null = null;
    const applyIncomingTime = (data: { type?: string; source?: string; worldHours?: number } | null | undefined) => {
      if (!data || data.source === 'map') return;
      const isTimeMsg =
        data.type === 'time-sync' ||
        (data.type !== 'map-state' && (data.source === 'sky' || data.source === 'calendar'));
      if (isTimeMsg && typeof data.worldHours === 'number' && Number.isFinite(data.worldHours)) {
        const nextHours = data.worldHours;
        worldHoursRef.current = nextHours;
        setWorldHours((prev) => (Math.abs(prev - nextHours) < 0.001 ? prev : nextHours));
      }
    };

    try {
      channel = new BroadcastChannel('adventure2_sky_sync');
      skySyncChannelRef.current = channel;
      channel.onmessage = (ev: MessageEvent<{ type?: string; worldHours?: number; source?: string }>) => {
        applyIncomingTime(ev.data);
      };
    } catch (err: unknown) {
      console.warn('[App] BroadcastChannel unavailable:', err);
    }

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'adventure2_sky_sync_state' && ev.newValue) {
        try {
          applyIncomingTime(JSON.parse(ev.newValue) as { type?: string; source?: string; worldHours?: number });
        } catch (err: unknown) {
          console.warn('[App] Storage sync parse warning:', err);
        }
      }
    };
    window.addEventListener('storage', onStorage);

    let lastFingerprint = '';
    const pushSync = () => {
      const payload = buildSkySyncPayloadRef.current();
      const fingerprint = JSON.stringify({
        camera: payload.camera,
        activePin: payload.activePin,
        markers: payload.markers,
        volcanicSky: payload.volcanicSky,
      });
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;
      try {
        localStorage.setItem('adventure2_sky_sync_state', JSON.stringify(payload));
      } catch (err: unknown) {
        console.warn('[App] localStorage map-state write failed:', err);
      }
      try {
        channel?.postMessage(payload);
      } catch (err: unknown) {
        console.warn('[App] BroadcastChannel map-state post failed:', err);
      }
    };
    pushSync();
    const timer = window.setInterval(pushSync, 600);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      skySyncChannelRef.current = null;
      channel?.close();
    };
  }, []);

  const handleOpenSkyTab = useCallback(() => {
    const payload = {
      ...buildSkySyncPayload(),
      worldHours: worldHoursRef.current,
    };
    try {
      localStorage.setItem('adventure2_sky_sync_state', JSON.stringify(payload));
    } catch (err: unknown) {
      console.warn('[App] localStorage write before opening Sky tab failed:', err);
    }
    const target = payload.activePin ?? payload.camera;
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'sky');
    url.searchParams.set('lat', String(target.latitudeDeg));
    url.searchParams.set('lon', String(target.longitudeDeg));
    if (payload.activePin) {
      url.searchParams.set('pin', payload.activePin.name);
    } else {
      url.searchParams.delete('pin');
    }
    window.open(url.toString(), 'adventure2_sky_preview');
  }, [buildSkySyncPayload]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#020617', overflow: 'hidden' }}>
      <QWorldToolbar
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        flatWaterSurface={flatWaterSurface}
        onToggleFlatWaterSurface={() => setFlatWaterSurface((v) => !v)}
        showFaultLines={showFaultLines}
        onToggleFaultLines={() => setShowFaultLines((v) => !v)}
        worldHours={worldHours}
        onWorldHoursChange={handleToolbarWorldHoursChange}
        onOpenSkyTab={handleOpenSkyTab}
        cameraPreset={cameraPreset}
        onCameraPresetChange={setCameraPreset}
        activeLod={activeLod}
        storedChunks={worldState.chunkTree.getStoredChunkCount()}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <QWorld3DViewport
          chunkTree={worldState.chunkTree}
          vectorTree={worldState.vectorTree}
          revision={revision}
          terrainRevision={terrainRevision}
          toolMode={toolMode}
          renderMode={renderMode}
          flatWaterSurface={flatWaterSurface}
          showFaultLines={showFaultLines}
          worldHours={worldHours}
          baseTempC={worldGenOptions.baseTempC}
          seaLevel={worldState.seaLevel}
          cameraPreset={cameraPreset}
          viewAlignment={viewAlignment}
          resetViewNonce={resetViewNonce}
          brushRadiusCells={brushRadiusCells}
          draftPoints={draftPoints}
          polygonPoints={polygonPoints}
          activeLod={activeLod}
          selectedMarkerId={selectedMarkerId}
          selectedRouteId={selectedRouteId}
          routeStops={activeRouteStops}
          mergeRouteNetwork={mergeRouteNetwork}
          roadSubMode={roadSubMode}
          tempPin={tempPin}
          panToMarkerRequest={panToMarkerRequest}
          cameraTargetRef={cameraTargetRef}
          terrainWorkerClient={terrainWorkerClientRef.current}
          weatherLayers={weatherLayers}
          atmosphereField={atmosphereField}
          volcanicFallout={volcanicFallout}
          volcanoSources={volcanoSources}
          weatherRevision={weatherRevision}
          onActiveLodChange={setActiveLod}
          onBrushStroke={handleBrushStroke}
          onBrushEnd={handleBrushEnd}
          onMapClick={handleMapClick}
          onSelectMarker={(id) => {
            setSelectedMarkerId(id);
            setTempPin(null);
            if (id && toolMode !== 'road' && toolMode !== 'weather') setToolMode('marker');
          }}
          onMoveMarker={handleMoveMarker}
          onAddRouteStopPin={handleAddRouteStopPin}
          onPlanRoute={handlePlanRoute}
          onCameraDistanceChange={handleCameraDistanceChange}
          onFinishPath={handleFinishPath}
          onUpdatePolygonVertex={handleUpdatePolygonVertex}
        />

        {/* Resizable Vertical Splitter */}
        <div
          onPointerDown={handleSplitterPointerDown}
          title="Drag to resize side panel"
          style={{
            width: '5px',
            flexShrink: 0,
            cursor: 'col-resize',
            background: '#1e293b',
            borderLeft: '1px solid #334155',
          }}
        />

        <QWorldRightPanel
          width={rightPanelWidth}
          toolMode={toolMode}
          onToolModeChange={(m) => {
            setToolMode(m);
            setDraftPoints([]);
          }}
          viewAlignment={viewAlignment}
          onViewAlignmentChange={setViewAlignment}
          onResetView={() => {
            setCameraPreset('3d');
            setResetViewNonce((n) => n + 1);
          }}
          markers={worldState.vectorTree.getAllMarkers()}
          selectedMarker={selectedMarker}
          selectedMarkerElevation={selectedMarkerElevation}
          tempPin={tempPin}
          onSelectMarker={(id) => {
            setSelectedMarkerId(id);
            if (id) setTempPin(null);
          }}
          onAddMarker={handleAddMarker}
          onClearTempPin={() => setTempPin(null)}
          onUpdateMarker={handleUpdateMarker}
          onDeleteMarker={handleDeleteMarker}
          onShowMarker={handleShowMarker}
          onPanToMarker={handlePanToMarker}
          worldSeed={worldState.seed}
          worldGenOptions={worldGenOptions}
          onResetStarterWorld={handleResetStarterWorld}
          routes={worldState.vectorTree.getAllRoutes()}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          routeFromStop={routeFromStop}
          routeViaStops={routeViaStops}
          routeToStop={routeToStop}
          onSetRouteFromStop={(stop) => {
            setRouteFromStop(stop);
            setRouteStatusMsg(null);
          }}
          onSetRouteViaStop={(idx, stop) => {
            setRouteViaStops((prev) =>
              stop === null ? prev.filter((_, i) => i !== idx) : prev.map((s, i) => (i === idx ? stop : s))
            );
            setRouteStatusMsg(null);
          }}
          onAddRouteViaSlot={(stop) => {
            setRouteViaStops((prev) => [...prev, stop]);
            setRouteStatusMsg(null);
          }}
          onSetRouteToStop={(stop) => {
            setRouteToStop(stop);
            setRouteStatusMsg(null);
          }}
          onReverseRouteStops={() => {
            const tmp = routeFromStop;
            setRouteFromStop(routeToStop);
            setRouteToStop(tmp);
            setRouteViaStops((prev) => [...prev].reverse());
            setRouteStatusMsg(null);
          }}
          onClearRouteStops={handleClearRouteStops}
          mergeRouteNetwork={mergeRouteNetwork}
          onMergeRouteNetworkChange={setMergeRouteNetwork}
          routeDraftState={routeDraftState}
          onRouteDraftStateChange={setRouteDraftState}
          onPlanRoute={handlePlanRoute}
          onReplanRoute={handleReplanRoute}
          onUpdateRoute={handleUpdateRoute}
          onDeleteRoute={handleDeleteRoute}
          onShowRoute={handleShowRoute}
          onPanToWorldPoint={handlePanToWorldPoint}
          routeStatusMsg={routeStatusMsg}
          roadSubMode={roadSubMode}
          onRoadSubModeChange={(m) => {
            setRoadSubMode(m);
            setDraftPoints([]);
          }}
          toolOptions={{
            elevBrushMode,
            onElevBrushModeChange: setElevBrushMode,
            brushRadiusCells,
            onBrushRadiusChange: setBrushRadiusCells,
            brushStrength,
            onBrushStrengthChange: setBrushStrength,
            activeBiomeId,
            onActiveBiomeChange: setActiveBiomeId,
            activeMarkerCategory,
            onActiveMarkerCategoryChange: setActiveMarkerCategory,
            draftPointCount: draftPoints.length,
            onFinishPath: handleFinishPath,
            onCancelPath: () => setDraftPoints([]),
            roadSubMode,
            onRoadSubModeChange: (m) => {
              setRoadSubMode(m);
              setDraftPoints([]);
            },
            routeStopCount: activeRouteStops.length,
            onPlanRoute: handlePlanRoute,
            onClearRouteStops: handleClearRouteStops,
            riverVolume,
            onRiverVolumeChange: setRiverVolume,
            autoFloodOcean,
            onAutoFloodOceanChange: handleAutoFloodOceanChange,
            polygonPointCount: polygonPoints.length,
            polygonAmount,
            onPolygonAmountChange: setPolygonAmount,
            onApplyPolygonAction: handleApplyPolygonAction,
            onUndoPolygonPoint: () => setPolygonPoints((pts) => pts.slice(0, -1)),
            onClearPolygon: () => setPolygonPoints([]),
          }}
          weatherPanelProps={{
            layers: weatherLayers,
            onChangeLayers: (next) => {
              setWeatherLayers(next);
              setWeatherStatusMsg(null);
            },
            volcanoMarkers,
            northLandAshPct: volcanicFallout.northLandAshPct,
            southLandAshPct: volcanicFallout.southLandAshPct,
            statusMsg: weatherStatusMsg,
            onUpdateVolcano: (id, patch) => {
              handleUpdateMarker(id, patch);
              setWeatherStatusMsg(null);
            },
            onPanToVolcano: handlePanToMarker,
            onStartPlaceVolcano: () => {
              setActiveMarkerCategory('volcano');
              setToolMode('marker');
            },
            onRecalculateAtmosphere: () => {
              setWeatherRecalcNonce((n) => n + 1);
              setWeatherStatusMsg('Recalculated planetary winds, storms, and fallout.');
            },
            onApplyClimateAndFoliage: handleApplyClimateAndFoliage,
          }}
        />
      </div>
    </div>
  );
};

export default App;
