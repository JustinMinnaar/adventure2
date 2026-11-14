import React, { useRef } from 'react';
import { CameraPresetMode, LOD_LABELS } from '../core/QWorldEditorTypes';
import { TerrainRenderMode } from '../core/QWorldTerrainMesh';
import {
  DEFAULT_CELESTIAL_CONFIG,
  NorthernSeasonKey,
  getNorthernSeasonFromWorldHours,
  getNorthernSeasonWorldHours,
} from '../core/QWorldCelestial';

interface QWorldToolbarProps {
  renderMode: TerrainRenderMode;
  onRenderModeChange: (mode: TerrainRenderMode) => void;
  flatWaterSurface: boolean;
  onToggleFlatWaterSurface: () => void;
  showFaultLines: boolean;
  onToggleFaultLines: () => void;
  worldHours: number;
  onWorldHoursChange: (worldHours: number) => void;
  onOpenSkyTab: () => void;
  cameraPreset: CameraPresetMode;
  onCameraPresetChange: (preset: CameraPresetMode) => void;
  activeLod: number;
  storedChunks: number;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
}

const SEASON_BUTTONS: { key: NorthernSeasonKey; label: string; icon: string; title: string }[] = [
  { key: 'spring', label: 'Spr', icon: '🌸', title: 'Northern Spring Equinox (Day 80)' },
  { key: 'summer', label: 'Sum', icon: '☀️', title: 'Northern Summer Solstice (Day 171)' },
  { key: 'autumn', label: 'Aut', icon: '🍂', title: 'Northern Autumn Equinox (Day 263)' },
  { key: 'winter', label: 'Win', icon: '❄️', title: 'Northern Winter Solstice (Day 354)' },
];

const VIEW_MODE_BUTTONS: { mode: 'normal' | 'temp' | 'rain' | 'biomes'; label: string; icon: string; title: string }[] = [
  { mode: 'normal', label: 'Normal', icon: '🌍', title: 'Normal blended terrain & seasonal foliage view' },
  { mode: 'temp', label: 'Temp', icon: '🌡️', title: 'Temperature / thermal climate map' },
  { mode: 'rain', label: 'Rain', icon: '🌧️', title: 'Rainfall, snow & weather map' },
  { mode: 'biomes', label: 'Biomes', icon: '🗺️', title: 'Categorical biome classification map' },
];

export const QWorldToolbar: React.FC<QWorldToolbarProps> = ({
  renderMode,
  onRenderModeChange,
  flatWaterSurface,
  onToggleFlatWaterSurface,
  showFaultLines,
  onToggleFaultLines,
  worldHours,
  onWorldHoursChange,
  onOpenSkyTab,
  cameraPreset,
  onCameraPresetChange,
  activeLod,
  storedChunks,
  onExportJson,
  onImportJson,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const normalizedMode =
    renderMode === 'biome'
      ? 'normal'
      : renderMode === 'heatmap'
        ? 'temp'
        : renderMode;

  return (
    <div
      style={{
        height: '46px',
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        gap: '10px',
        zIndex: 20,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={onOpenSkyTab}
          title="Open Celestial Sky Preview in a new tab"
          style={{
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '7px',
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#f8fafc',
            fontSize: '15px',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          🌙
        </button>
        <button
          onClick={() => window.open('/?view=calendar', 'adventure2_calendar')}
          title="Open World Calendar in a new tab"
          style={{
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '7px',
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#f8fafc',
            fontSize: '15px',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          📅
        </button>
        <div style={{ width: '1px', height: '22px', background: '#334155', margin: '0 2px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {VIEW_MODE_BUTTONS.map((btn) => {
            const active = normalizedMode === btn.mode;
            return (
              <button
                key={btn.mode}
                onClick={() => onRenderModeChange(btn.mode)}
                title={btn.title}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 9px',
                  borderRadius: '6px',
                  border: active ? '1px solid #38bdf8' : '1px solid #334155',
                  background: active ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
                  color: active ? '#f8fafc' : '#cbd5e1',
                  fontSize: '12px',
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                <span>{btn.icon}</span>
                <span>{btn.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ width: '1px', height: '22px', background: '#334155', margin: '0 2px' }} />

        <button
          onClick={onToggleFlatWaterSurface}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 9px',
            borderRadius: '6px',
            border: flatWaterSurface ? '1px solid #38bdf8' : '1px solid #334155',
            background: flatWaterSurface ? 'rgba(14, 116, 144, 0.55)' : '#1e293b',
            color: '#f8fafc',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          title={flatWaterSurface ? 'Sea surface shown flat at sea level (click for seabed depth)' : 'Seabed depth shown (click for flat sea surface)'}
        >
          <span>🌊</span>
          <span>{flatWaterSurface ? 'Sea' : 'Seabed'}</span>
        </button>

        <button
          onClick={onToggleFaultLines}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 9px',
            borderRadius: '6px',
            border: showFaultLines ? '1px solid #ef4444' : '1px solid #334155',
            background: showFaultLines ? 'rgba(153, 27, 27, 0.5)' : '#1e293b',
            color: '#f8fafc',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          title="Show or hide tectonic fault lines"
        >
          <span>🌋</span>
          <span>Faults</span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: '5px',
            background: '#1e293b',
            border: '1px solid #334155',
            fontSize: '11px',
            color: '#38bdf8',
            fontFamily: 'monospace',
          }}
        >
          {LOD_LABELS[activeLod] ?? `L${activeLod}`} • {storedChunks} chunks
        </span>

        {(() => {
          const hoursPerDay = DEFAULT_CELESTIAL_CONFIG.hoursPerDay;
          const daysPerYear = DEFAULT_CELESTIAL_CONFIG.daysPerYear;
          const activeSeason = getNorthernSeasonFromWorldHours(worldHours);
          const localHour = Math.floor(((worldHours % hoursPerDay) + hoursPerDay) % hoursPerDay);
          const dayFloor = Math.floor(worldHours / hoursPerDay);
          const dayOfYear = ((dayFloor % daysPerYear) + daysPerYear) % daysPerYear + 1;
          const hh = String(localHour).padStart(2, '0');
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: '1px solid #334155',
                  background: '#1e293b',
                }}
                title="Northern Hemisphere Seasons (Solar Calendar)"
              >
                {SEASON_BUTTONS.map((sb, idx) => {
                  const isActive = activeSeason === sb.key;
                  return (
                    <button
                      key={sb.key}
                      onClick={() => onWorldHoursChange(getNorthernSeasonWorldHours(sb.key, worldHours))}
                      title={sb.title}
                      style={{
                        padding: '5px 7px',
                        border: 'none',
                        borderLeft: idx > 0 ? '1px solid #334155' : 'none',
                        background: isActive ? '#0284c7' : '#1e293b',
                        color: isActive ? '#ffffff' : '#cbd5e1',
                        fontSize: '11px',
                        fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <span>{sb.icon}</span>
                      <span>{sb.label}</span>
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  border: '1px solid #334155',
                  background: '#1e293b',
                }}
                title={`Solar Time: Day ${dayOfYear}/${daysPerYear}, ${hh}:00 (controls planetary day/night shadow)`}
              >
                <button
                  onClick={() => onWorldHoursChange(Math.max(0, worldHours - 2))}
                  style={{
                    padding: '5px 7px',
                    border: 'none',
                    borderRight: '1px solid #334155',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="Step back 2 hours"
                >
                  −2h
                </button>
                <span
                  style={{
                    padding: '5px 7px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#fde68a',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🕒 {hh}:00 • D{dayOfYear}
                </span>
                <button
                  onClick={() => onWorldHoursChange(worldHours + 2)}
                  style={{
                    padding: '5px 7px',
                    border: 'none',
                    borderLeft: '1px solid #334155',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="Step forward 2 hours"
                >
                  +2h
                </button>
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid #334155' }}>
          {(['3d', 'topdown', 'people'] as CameraPresetMode[]).map((preset) => {
            const active = cameraPreset === preset;
            const label = preset === '3d' ? '3D' : preset === 'topdown' ? 'Top' : 'People';
            return (
              <button
                key={preset}
                onClick={() => onCameraPresetChange(preset)}
                style={{
                  padding: '5px 8px',
                  border: 'none',
                  background: active ? '#0284c7' : '#1e293b',
                  color: '#f8fafc',
                  fontSize: '11px',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <button onClick={onExportJson} style={secondaryBtnStyle}>
          Export
        </button>
        <button onClick={() => fileInputRef.current?.click()} style={secondaryBtnStyle}>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportJson(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '5px 9px',
  borderRadius: '6px',
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#cbd5e1',
  fontSize: '12px',
  cursor: 'pointer',
};
