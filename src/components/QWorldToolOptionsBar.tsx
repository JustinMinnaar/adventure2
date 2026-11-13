import React from 'react';
import { EditorToolMode, BIOME_PRESETS, MARKER_PRESETS } from '../core/QWorldEditorTypes';
import { ElevationBrushMode } from '../core/QWorldBrushEngine';

interface QWorldToolOptionsBarProps {
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
  riverVolume: number;
  onRiverVolumeChange: (v: number) => void;
  autoFloodOcean: boolean;
  onAutoFloodOceanChange: (enabled: boolean) => void;
}

export const QWorldToolOptionsBar: React.FC<QWorldToolOptionsBarProps> = ({
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
  riverVolume,
  onRiverVolumeChange,
  autoFloodOcean,
  onAutoFloodOceanChange,
}) => {
  if (toolMode === 'select') {
    return (
      <div style={barStyle}>
        <span style={hintStyle}>
          Drag to Pan • Right-drag / Alt+drag to Orbit • Scroll to Zoom (Continent L0 ↔ People L5) • WASD to Move
        </span>
      </div>
    );
  }

  return (
    <div style={barStyle}>
      {toolMode === 'elevate' && (
        <>
          {(['raise', 'lower', 'flatten', 'smooth'] as ElevationBrushMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onElevBrushModeChange(m)}
              style={pillBtnStyle(elevBrushMode === m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          <label style={sliderLabelStyle}>
            Radius: {brushRadiusCells}
            <input
              type="range"
              min={2}
              max={28}
              value={brushRadiusCells}
              onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
            />
          </label>
          <label style={sliderLabelStyle}>
            Strength: {brushStrength}
            <input
              type="range"
              min={5}
              max={150}
              step={5}
              value={brushStrength}
              onChange={(e) => onBrushStrengthChange(Number(e.target.value))}
            />
          </label>
          <label
            style={{ ...pillBtnStyle(autoFloodOcean), gap: '6px' }}
            title="Automatically recompute ocean flooding after each elevation change"
          >
            <input
              type="checkbox"
              checked={autoFloodOcean}
              onChange={(e) => onAutoFloodOceanChange(e.target.checked)}
              style={{ accentColor: '#38bdf8', cursor: 'pointer', margin: 0 }}
            />
            🌊 Flood Ocean
          </label>
        </>
      )}

      {toolMode === 'biome' && (
        <>
          {BIOME_PRESETS.map((b) => (
            <button
              key={b.id}
              onClick={() => onActiveBiomeChange(b.id)}
              style={pillBtnStyle(activeBiomeId === b.id)}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  background: b.color,
                  marginRight: '4px',
                }}
              />
              {b.icon} {b.name}
            </button>
          ))}
          <label style={sliderLabelStyle}>
            Radius: {brushRadiusCells}
            <input
              type="range"
              min={2}
              max={28}
              value={brushRadiusCells}
              onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
            />
          </label>
        </>
      )}

      {(toolMode === 'river' || toolMode === 'road') && (
        <>
          <span style={hintStyle}>
            Click map to add {toolMode} vertices ({draftPointCount} pts). Right-click or Enter to finish.
          </span>
          {toolMode === 'river' && (
            <label style={sliderLabelStyle}>
              Volume: {riverVolume}
              <input
                type="range"
                min={1}
                max={20}
                value={riverVolume}
                onChange={(e) => onRiverVolumeChange(Number(e.target.value))}
              />
            </label>
          )}
          {draftPointCount >= 2 && (
            <button onClick={onFinishPath} style={pillBtnStyle(true)}>
              Finish
            </button>
          )}
          {draftPointCount > 0 && (
            <button onClick={onCancelPath} style={pillBtnStyle(false)}>
              Cancel
            </button>
          )}
        </>
      )}

      {toolMode === 'marker' && (
        <>
          {MARKER_PRESETS.map((m) => (
            <button
              key={m.category}
              onClick={() => onActiveMarkerCategoryChange(m.category)}
              style={pillBtnStyle(activeMarkerCategory === m.category)}
            >
              {m.icon} {m.label}
            </button>
          ))}
          <span style={hintStyle}>Click map to place marker</span>
        </>
      )}
    </div>
  );
};

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: '56px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(15, 23, 42, 0.9)',
  backdropFilter: 'blur(8px)',
  border: '1px solid #334155',
  borderRadius: '8px',
  padding: '6px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  zIndex: 15,
  flexWrap: 'wrap',
  maxWidth: '92vw',
};

const hintStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
};

const sliderLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  color: '#cbd5e1',
};

const pillBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 9px',
  borderRadius: '5px',
  border: active ? '1px solid #38bdf8' : '1px solid #334155',
  background: active ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
  color: '#f8fafc',
  fontSize: '11px',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
});
