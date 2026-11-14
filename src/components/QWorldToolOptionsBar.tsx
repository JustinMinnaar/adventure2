import React from 'react';
import { EditorToolMode, BIOME_PRESETS, MARKER_PRESETS } from '../core/QWorldEditorTypes';
import { ElevationBrushMode, PolygonActionType } from '../core/QWorldBrushEngine';

export type RoadSubMode = 'route' | 'pins' | 'freehand';

export interface QWorldToolOptionsProps {
  toolMode: EditorToolMode;
  elevBrushMode: ElevationBrushMode;
  onElevBrushModeChange: (m: ElevationBrushMode) => void;
  brushRadiusCells: number;
  onBrushRadiusChange: (r: number) => void;
  brushStrength: number;
  onBrushStrengthChange: (s: number) => void;
  activeBiomeId: number;
  onActiveBiomeChange: (id: number) => void;
  activeMarkerCategory: string;
  onActiveMarkerCategoryChange: (cat: string) => void;
  draftPointCount: number;
  onFinishPath: () => void;
  onCancelPath: () => void;
  roadSubMode?: RoadSubMode;
  onRoadSubModeChange?: (m: RoadSubMode) => void;
  routeStopCount?: number;
  onPlanRoute?: () => void;
  onClearRouteStops?: () => void;
  riverVolume: number;
  onRiverVolumeChange: (v: number) => void;
  autoFloodOcean: boolean;
  onAutoFloodOceanChange: (enabled: boolean) => void;
  polygonPointCount: number;
  polygonAmount: number;
  onPolygonAmountChange: (v: number) => void;
  onApplyPolygonAction: (action: PolygonActionType) => void;
  onUndoPolygonPoint: () => void;
  onClearPolygon: () => void;
}

const ELEV_BUTTONS: { mode: ElevationBrushMode; icon: string; label: string }[] = [
  { mode: 'raise', icon: '⬆️', label: 'Raise' },
  { mode: 'lower', icon: '⬇️', label: 'Lower' },
  { mode: 'flatten', icon: '▬', label: 'Flatten' },
  { mode: 'smooth', icon: '〰️', label: 'Smooth' },
];

export const QWorldToolOptionsBar: React.FC<QWorldToolOptionsProps> = ({
  toolMode,
  elevBrushMode,
  onElevBrushModeChange,
  brushRadiusCells,
  onBrushRadiusChange,
  brushStrength,
  onBrushStrengthChange,
  activeBiomeId,
  onActiveBiomeChange,
  activeMarkerCategory,
  onActiveMarkerCategoryChange,
  draftPointCount,
  onFinishPath,
  onCancelPath,
  roadSubMode = 'route',
  onRoadSubModeChange,
  routeStopCount = 0,
  onPlanRoute,
  onClearRouteStops,
  riverVolume,
  onRiverVolumeChange,
  autoFloodOcean,
  onAutoFloodOceanChange,
  polygonPointCount,
  polygonAmount,
  onPolygonAmountChange,
  onApplyPolygonAction,
  onUndoPolygonPoint,
  onClearPolygon,
}) => {
  if (toolMode === 'generate') return null;

  return (
    <div style={sectionStyle}>
      {toolMode === 'select' && (
        <span style={hintStyle}>
          Drag: Pan • Right/Alt+drag: Orbit • Scroll: Zoom (L0–L9) • Alt+0–9: Jump LOD • WASD: Move
        </span>
      )}

      {toolMode === 'elevate' && (
        <>
          <div style={iconRowStyle}>
            {ELEV_BUTTONS.map((btn) => (
              <button
                key={btn.mode}
                type="button"
                onClick={() => onElevBrushModeChange(btn.mode)}
                title={btn.label}
                aria-label={btn.label}
                style={iconBtnStyle(elevBrushMode === btn.mode)}
              >
                {btn.icon}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onAutoFloodOceanChange(!autoFloodOcean)}
              title={`Auto Flood Ocean: ${autoFloodOcean ? 'On' : 'Off'}`}
              aria-label="Flood Ocean"
              style={iconBtnStyle(autoFloodOcean)}
            >
              🌊
            </button>
          </div>
          <label style={sliderLabelStyle}>
            <span>Radius: {brushRadiusCells}</span>
            <input
              type="range"
              min={2}
              max={28}
              value={brushRadiusCells}
              onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <label style={sliderLabelStyle}>
            <span>Strength: {brushStrength}</span>
            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={brushStrength}
              onChange={(e) => onBrushStrengthChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
        </>
      )}

      {toolMode === 'biome' && (
        <>
          <div style={iconRowStyle}>
            {BIOME_PRESETS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onActiveBiomeChange(b.id)}
                title={b.name}
                aria-label={b.name}
                style={{
                  ...iconBtnStyle(activeBiomeId === b.id),
                  boxShadow: `inset 0 -3px 0 ${b.color}`,
                }}
              >
                {b.icon}
              </button>
            ))}
          </div>
          <label style={sliderLabelStyle}>
            <span>Radius: {brushRadiusCells}</span>
            <input
              type="range"
              min={2}
              max={28}
              value={brushRadiusCells}
              onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
        </>
      )}

      {toolMode === 'polygon' && (
        <>
          <span style={hintStyle}>
            Click to add vertices • Drag spheres to adjust ({polygonPointCount} pts)
          </span>
          <label style={sliderLabelStyle}>
            <span>Height: {polygonAmount} yd</span>
            <input
              type="range"
              min={50}
              max={1500}
              step={25}
              value={polygonAmount}
              onChange={(e) => onPolygonAmountChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <div style={iconRowStyle}>
            {polygonPointCount >= 3 && (
              <>
                <button
                  type="button"
                  onClick={() => onApplyPolygonAction('slope-raise')}
                  title="Slope Raise"
                  aria-label="Slope Raise"
                  style={iconBtnStyle(true)}
                >
                  🏔️
                </button>
                <button
                  type="button"
                  onClick={() => onApplyPolygonAction('lower')}
                  title="Lower"
                  aria-label="Lower"
                  style={iconBtnStyle(false)}
                >
                  ⬇️
                </button>
                <button
                  type="button"
                  onClick={() => onApplyPolygonAction('flatten')}
                  title="Flatten"
                  aria-label="Flatten"
                  style={iconBtnStyle(false)}
                >
                  ▬
                </button>
                <button
                  type="button"
                  onClick={() => onApplyPolygonAction('biome')}
                  title={`Fill ${BIOME_PRESETS.find((b) => b.id === activeBiomeId)?.name ?? 'Biome'}`}
                  aria-label="Fill Biome"
                  style={iconBtnStyle(false)}
                >
                  🎨
                </button>
              </>
            )}
            {polygonPointCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={onUndoPolygonPoint}
                  title="Undo Point"
                  aria-label="Undo Point"
                  style={iconBtnStyle(false)}
                >
                  ↩️
                </button>
                <button
                  type="button"
                  onClick={onClearPolygon}
                  title="Clear Polygon"
                  aria-label="Clear Polygon"
                  style={iconBtnStyle(false)}
                >
                  🗑️
                </button>
              </>
            )}
          </div>
        </>
      )}

      {toolMode === 'river' && (
        <>
          <span style={hintStyle}>
            Click map to add river vertices ({draftPointCount} pts). Right-click or Enter to finish.
          </span>
          <label style={sliderLabelStyle}>
            <span>Volume: {riverVolume}</span>
            <input
              type="range"
              min={1}
              max={20}
              value={riverVolume}
              onChange={(e) => onRiverVolumeChange(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <div style={iconRowStyle}>
            {draftPointCount >= 2 && (
              <button
                type="button"
                onClick={onFinishPath}
                title="Finish River"
                aria-label="Finish River"
                style={iconBtnStyle(true)}
              >
                ✅
              </button>
            )}
            {draftPointCount > 0 && (
              <button
                type="button"
                onClick={onCancelPath}
                title="Cancel River"
                aria-label="Cancel River"
                style={iconBtnStyle(false)}
              >
                ✖️
              </button>
            )}
          </div>
        </>
      )}

      {toolMode === 'road' && (
        <>
          <div style={iconRowStyle}>
            <button
              type="button"
              onClick={() => onRoadSubModeChange?.('route')}
              title="Places (2–3+)"
              aria-label="Places"
              style={iconBtnStyle(roadSubMode === 'route')}
            >
              🧭
            </button>
            <button
              type="button"
              onClick={() => onRoadSubModeChange?.('pins')}
              title="Click Pins"
              aria-label="Click Pins"
              style={iconBtnStyle(roadSubMode === 'pins')}
            >
              📌
            </button>
            <button
              type="button"
              onClick={() => onRoadSubModeChange?.('freehand')}
              title="Freehand Road"
              aria-label="Freehand Road"
              style={iconBtnStyle(roadSubMode === 'freehand')}
            >
              ✏️
            </button>
            {roadSubMode === 'pins' && routeStopCount >= 2 && (
              <button
                type="button"
                onClick={onPlanRoute}
                title="Plan Route"
                aria-label="Plan Route"
                style={iconBtnStyle(true)}
              >
                ✅
              </button>
            )}
            {roadSubMode === 'pins' && routeStopCount > 0 && (
              <button
                type="button"
                onClick={onClearRouteStops}
                title="Clear Pins"
                aria-label="Clear Pins"
                style={iconBtnStyle(false)}
              >
                🗑️
              </button>
            )}
            {roadSubMode === 'freehand' && draftPointCount >= 2 && (
              <button
                type="button"
                onClick={onFinishPath}
                title="Finish Road"
                aria-label="Finish Road"
                style={iconBtnStyle(true)}
              >
                ✅
              </button>
            )}
            {roadSubMode === 'freehand' && draftPointCount > 0 && (
              <button
                type="button"
                onClick={onCancelPath}
                title="Cancel Road"
                aria-label="Cancel Road"
                style={iconBtnStyle(false)}
              >
                ✖️
              </button>
            )}
          </div>
          <span style={hintStyle}>
            {roadSubMode === 'route'
              ? 'Click markers & Set From / Via / To • Path cuts through woods; Road routes around forests'
              : roadSubMode === 'pins'
                ? `Click markers or map points to add stops (${routeStopCount} stops). Right-click or Enter to plan.`
                : `Click map to add road vertices (${draftPointCount} pts). Right-click or Enter to finish.`}
          </span>
        </>
      )}

      {toolMode === 'marker' && (
        <>
          <div style={iconRowStyle}>
            {MARKER_PRESETS.map((m) => (
              <button
                key={m.category}
                type="button"
                onClick={() => onActiveMarkerCategoryChange(m.category)}
                title={m.label}
                aria-label={m.label}
                style={iconBtnStyle(activeMarkerCategory === m.category)}
              >
                {m.icon}
              </button>
            ))}
          </div>
          <span style={hintStyle}>Click map to place marker • Drag unlocked markers to move</span>
        </>
      )}
    </div>
  );
};

const sectionStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderTop: '1px solid #1e293b',
  background: '#080e1d',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flexShrink: 0,
};

const iconRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
};

const iconBtnStyle = (active: boolean): React.CSSProperties => ({
  width: '32px',
  height: '30px',
  borderRadius: '6px',
  border: active ? '1px solid #38bdf8' : '1px solid #334155',
  background: active ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
  color: '#f8fafc',
  fontSize: '15px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
});

const hintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  lineHeight: 1.35,
};

const sliderLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  fontSize: '11px',
  color: '#cbd5e1',
};
