import React, { useState, useRef, useEffect, useCallback } from 'react';
import { QWorldBrushEngine, ElevationBrushMode } from './core/QWorldBrushEngine';
import { QWorldWaterFlood, OceanSeedCell } from './core/QWorldWaterFlood';
import { WorldPoint2D } from './core/QWorldVectorTree';
import { QWorldStorage } from './core/QWorldStorage';
import { QWorldIndexedDb } from './core/QWorldIndexedDb';
import { generateStarterWorld } from './core/QWorldStarterGenerator';
import { EditorToolMode, CameraPresetMode, MARKER_PRESETS } from './core/QWorldEditorTypes';
import { TerrainRenderMode } from './core/QWorldTerrainMesh';
import { QWorldToolbar } from './components/QWorldToolbar';
import { QWorldToolOptionsBar } from './components/QWorldToolOptionsBar';
import { QWorld3DViewport } from './components/QWorld3DViewport';

export const App: React.FC = () => {
  const initialRef = useRef<ReturnType<typeof generateStarterWorld> | null>(null);
  if (!initialRef.current) {
    initialRef.current = generateStarterWorld();
  }

  const [worldState, setWorldState] = useState(() => initialRef.current!);
  const [revision, setRevision] = useState(0);
  const [toolMode, setToolMode] = useState<EditorToolMode>('elevate');
  const [renderMode, setRenderMode] = useState<TerrainRenderMode>('biome');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetMode>('3d');
  const [activeLod, setActiveLod] = useState(0);

  const [elevBrushMode, setElevBrushMode] = useState<ElevationBrushMode>('raise');
  const [brushRadiusCells, setBrushRadiusCells] = useState(8);
  const [brushStrength, setBrushStrength] = useState(40);
  const [autoFloodOcean, setAutoFloodOcean] = useState(true);
  const [activeBiomeId, setActiveBiomeId] = useState(2); // Forest
  const [activeMarkerCategory, setActiveMarkerCategory] = useState('city');
  const [riverVolume, setRiverVolume] = useState(3);
  const [draftPoints, setDraftPoints] = useState<WorldPoint2D[]>([]);

  const brushEngineRef = useRef(new QWorldBrushEngine(worldState.chunkTree));
  const waterFloodRef = useRef(new QWorldWaterFlood(worldState.chunkTree, 0));

  useEffect(() => {
    brushEngineRef.current = new QWorldBrushEngine(worldState.chunkTree);
    waterFloodRef.current = new QWorldWaterFlood(worldState.chunkTree, 0);
  }, [worldState]);

  // Load saved world from IndexedDB on startup if present
  useEffect(() => {
    QWorldIndexedDb.loadActiveWorld()
      .then((json) => {
        if (!json) return;
        const restored = QWorldStorage.deserializeFromJson(json);
        const oceanSeeds: OceanSeedCell[] = [{ cx: -1, cz: -1, lx: 1, lz: 1 }];
        setWorldState({
          chunkTree: restored.chunkTree,
          vectorTree: restored.vectorTree,
          oceanSeeds,
        });
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
      const json = QWorldStorage.serializeToJson(worldState.chunkTree, worldState.vectorTree, 'Adventure2 World');
      QWorldIndexedDb.saveActiveWorld(json).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [revision, worldState]);

  const handleBrushStroke = useCallback(
    (worldX: number, worldZ: number, lod: number) => {
      const spacing = worldState.chunkTree.getSampleSpacing(lod);
      const radiusWorld = brushRadiusCells * spacing;

      if (toolMode === 'elevate') {
        const targetHeight = elevBrushMode === 'flatten' ? worldState.chunkTree.getHeightAt(lod, worldX, worldZ) : 0;
        brushEngineRef.current.applyElevationBrush({
          lod,
          worldX,
          worldZ,
          radiusWorld,
          mode: elevBrushMode,
          strength: brushStrength,
          targetHeight,
        });
        if (autoFloodOcean) {
          waterFloodRef.current.propagateFromSeeds(lod, worldState.oceanSeeds);
        }
      } else if (toolMode === 'biome') {
        brushEngineRef.current.applyBiomeBrush({
          lod,
          worldX,
          worldZ,
          radiusWorld,
          biomeId: activeBiomeId,
        });
      }
      setRevision((r) => r + 1);
    },
    [worldState, toolMode, elevBrushMode, brushRadiusCells, brushStrength, autoFloodOcean, activeBiomeId]
  );

  const recomputeAndRollupOcean = useCallback(
    (lod: number) => {
      const range = { minCx: -2, maxCx: 2, minCz: -2, maxCz: 2 };
      waterFloodRef.current.recomputeArea(lod, range, worldState.oceanSeeds);
      worldState.chunkTree.rollupChunksToParent(lod, range.minCx, range.maxCx, range.minCz, range.maxCz);
      setRevision((r) => r + 1);
    },
    [worldState]
  );

  const handleBrushEnd = useCallback(
    (lod: number) => {
      if (toolMode === 'elevate' && autoFloodOcean) {
        recomputeAndRollupOcean(lod);
      }
    },
    [toolMode, autoFloodOcean, recomputeAndRollupOcean]
  );

  const handleMapClick = useCallback(
    (worldX: number, worldZ: number, lod: number) => {
      if (toolMode === 'marker') {
        const preset = MARKER_PRESETS.find((p) => p.category === activeMarkerCategory) ?? MARKER_PRESETS[0];
        const count = worldState.vectorTree.getMarkerCount() + 1;
        worldState.vectorTree.addMarker({
          id: `marker-${Date.now()}-${count}`,
          name: `${preset.label} ${count}`,
          category: preset.category,
          x: worldX,
          z: worldZ,
          minLod: Math.min(lod, preset.minLod),
          maxLod: preset.maxLod,
        });
        setRevision((r) => r + 1);
      } else if (toolMode === 'river' || toolMode === 'road') {
        setDraftPoints((pts) => [...pts, { x: worldX, z: worldZ }]);
      }
    },
    [toolMode, activeMarkerCategory, worldState]
  );

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
    const json = QWorldStorage.serializeToJson(worldState.chunkTree, worldState.vectorTree, 'Adventure2 World');
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
      setWorldState({
        chunkTree: restored.chunkTree,
        vectorTree: restored.vectorTree,
        oceanSeeds: [{ cx: -1, cz: -1, lx: 1, lz: 1 }],
      });
      setDraftPoints([]);
      setRevision((r) => r + 1);
    };
    reader.readAsText(file);
  };

  const handleResetStarterWorld = () => {
    setWorldState(generateStarterWorld());
    setDraftPoints([]);
    setRevision((r) => r + 1);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#020617', overflow: 'hidden' }}>
      <QWorldToolbar
        toolMode={toolMode}
        onToolModeChange={(m) => {
          setToolMode(m);
          setDraftPoints([]);
        }}
        renderMode={renderMode}
        onToggleRenderMode={() => setRenderMode((m) => (m === 'biome' ? 'heatmap' : 'biome'))}
        cameraPreset={cameraPreset}
        onCameraPresetChange={setCameraPreset}
        activeLod={activeLod}
        storedChunks={worldState.chunkTree.getStoredChunkCount()}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onResetStarterWorld={handleResetStarterWorld}
      />

      <QWorldToolOptionsBar
        toolMode={toolMode}
        elevBrushMode={elevBrushMode}
        onElevBrushModeChange={setElevBrushMode}
        brushRadiusCells={brushRadiusCells}
        onBrushRadiusChange={setBrushRadiusCells}
        brushStrength={brushStrength}
        onBrushStrengthChange={setBrushStrength}
        activeBiomeId={activeBiomeId}
        onActiveBiomeChange={setActiveBiomeId}
        activeMarkerCategory={activeMarkerCategory}
        onActiveMarkerCategoryChange={setActiveMarkerCategory}
        draftPointCount={draftPoints.length}
        onFinishPath={handleFinishPath}
        onCancelPath={() => setDraftPoints([])}
        riverVolume={riverVolume}
        onRiverVolumeChange={setRiverVolume}
        autoFloodOcean={autoFloodOcean}
        onAutoFloodOceanChange={handleAutoFloodOceanChange}
      />

      <QWorld3DViewport
        chunkTree={worldState.chunkTree}
        vectorTree={worldState.vectorTree}
        revision={revision}
        toolMode={toolMode}
        renderMode={renderMode}
        cameraPreset={cameraPreset}
        brushRadiusCells={brushRadiusCells}
        draftPoints={draftPoints}
        activeLod={activeLod}
        onActiveLodChange={setActiveLod}
        onBrushStroke={handleBrushStroke}
        onBrushEnd={handleBrushEnd}
        onMapClick={handleMapClick}
        onFinishPath={handleFinishPath}
      />
    </div>
  );
};

export default App;
