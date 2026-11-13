import React from 'react';
import { EditorToolMode, CameraPresetMode, LOD_LABELS } from '../core/QWorldEditorTypes';
import { TerrainRenderMode } from '../core/QWorldTerrainMesh';

interface QWorldToolbarProps {
  toolMode: EditorToolMode;
  onToolModeChange: (mode: EditorToolMode) => void;
  renderMode: TerrainRenderMode;
  onToggleRenderMode: () => void;
  cameraPreset: CameraPresetMode;
  onCameraPresetChange: (preset: CameraPresetMode) => void;
  activeLod: number;
  storedChunks: number;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  onResetStarterWorld: () => void;
}

const TOOL_BUTTONS: { mode: EditorToolMode; label: string; icon: string }[] = [
  { mode: 'select', label: 'Select / Pan', icon: '🖐️' },
  { mode: 'elevate', label: 'Elevate', icon: '🏔️' },
  { mode: 'biome', label: 'Biome', icon: '🌲' },
  { mode: 'river', label: 'River', icon: '🌊' },
  { mode: 'road', label: 'Road', icon: '🛤️' },
  { mode: 'marker', label: 'Marker', icon: '📍' },
];

export const QWorldToolbar: React.FC<QWorldToolbarProps> = ({
  toolMode,
  onToolModeChange,
  renderMode,
  onToggleRenderMode,
  cameraPreset,
  onCameraPresetChange,
  activeLod,
  storedChunks,
  onExportJson,
  onImportJson,
  onResetStarterWorld,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
        <span style={{ fontWeight: 700, fontSize: '14px', color: '#f8fafc', letterSpacing: '0.02em' }}>
          Adventure2
        </span>
        <div style={{ width: '1px', height: '22px', background: '#334155', margin: '0 4px' }} />

        {TOOL_BUTTONS.map((btn) => {
          const active = toolMode === btn.mode;
          return (
            <button
              key={btn.mode}
              onClick={() => onToolModeChange(btn.mode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                borderRadius: '6px',
                border: active ? '1px solid #38bdf8' : '1px solid #334155',
                background: active ? 'rgba(56, 189, 248, 0.2)' : '#1e293b',
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

        <button
          onClick={onToggleRenderMode}
          style={{
            padding: '5px 10px',
            borderRadius: '6px',
            border: '1px solid #334155',
            background: renderMode === 'heatmap' ? '#7c2d12' : '#1e293b',
            color: '#f8fafc',
            fontSize: '12px',
            cursor: 'pointer',
          }}
          title="Toggle Biome Colors vs. Elevation Heat Map"
        >
          {renderMode === 'heatmap' ? '🌡️ Heat Map' : '🗺️ Biomes'}
        </button>

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

        <button
          onClick={onResetStarterWorld}
          style={secondaryBtnStyle}
          title="Generate a fresh starter continent & ocean"
        >
          New World
        </button>
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
