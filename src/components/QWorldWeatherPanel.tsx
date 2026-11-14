import React from 'react';
import { WorldMarker } from '../core/QWorldVectorTree';
import { WeatherLayerToggles } from '../core/QWorldEditorTypes';
import { worldCoordsToLatLon } from '../core/QWorldCelestial';

export interface QWorldWeatherPanelProps {
  layers: WeatherLayerToggles;
  onChangeLayers: (next: WeatherLayerToggles) => void;
  volcanoMarkers: WorldMarker[];
  northLandAshPct: number;
  southLandAshPct: number;
  statusMsg: string | null;
  onUpdateVolcano: (id: string, patch: Partial<WorldMarker>) => void;
  onPanToVolcano: (marker: WorldMarker) => void;
  onStartPlaceVolcano: () => void;
  onRecalculateAtmosphere: () => void;
  onApplyClimateAndFoliage: () => void;
}

const LAYER_ITEMS: { key: keyof WeatherLayerToggles; icon: string; label: string; hint: string }[] = [
  { key: 'showHighWind', icon: '💨', label: 'High-Altitude Winds', hint: 'Jet streams & planetary upper-air circulation' },
  { key: 'showSurfaceWind', icon: '🌡️', label: 'Hot & Cold Air Flow', hint: 'Lower air currents deflected by mountain ranges' },
  { key: 'showStormRisk', icon: '🌀', label: 'Hurricanes & Storms', hint: 'Tropical cyclone alleys & colliding weather fronts' },
  { key: 'showFalloutOverlay', icon: '🌋', label: 'Fallout Contours', hint: 'Ash thickness zones & windward mountain pile-ups' },
  { key: 'renderAshInWorld', icon: '🌑', label: 'World Ash & Blight', hint: 'Blanket terrain in soot & char northern forests' },
];

function formatLatitudeBadge(worldX: number, worldZ: number): string {
  const { latitudeDeg } = worldCoordsToLatLon(worldX, worldZ);
  return `${Math.abs(latitudeDeg).toFixed(1)}°${latitudeDeg >= 0 ? 'N' : 'S'}`;
}

export const QWorldWeatherPanel: React.FC<QWorldWeatherPanelProps> = ({
  layers,
  onChangeLayers,
  volcanoMarkers,
  northLandAshPct,
  southLandAshPct,
  statusMsg,
  onUpdateVolcano,
  onPanToVolcano,
  onStartPlaceVolcano,
  onRecalculateAtmosphere,
  onApplyClimateAndFoliage,
}) => {
  const activeCount = volcanoMarkers.filter((v) => v.eruptionActive).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={panelHeaderStyle}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' }}>
          🌪️ Weather & Fallout
        </span>
        <button
          type="button"
          onClick={onRecalculateAtmosphere}
          title="Recalculate winds, storms, and mountain-blocked fallout from current terrain"
          style={actionBtnStyle}
        >
          🔄 Recalculate
        </button>
      </div>

      <div style={scrollBodyStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={sectionHeaderStyle}>Map Overlays (Any View)</div>
          {LAYER_ITEMS.map((item) => {
            const checked = layers[item.key];
            return (
              <label key={item.key} title={item.hint} style={layerRowStyle(checked)}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>
                    {item.icon} {item.label}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: '10px' }}>{item.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onChangeLayers({ ...layers, [item.key]: e.target.checked })}
                  style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </label>
            );
          })}
        </div>

        <div style={hemisphereBoxStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Northern Land Ash</span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: northLandAshPct > 25 ? '#f87171' : '#cbd5e1' }}>
              {northLandAshPct}%
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>Southern Land Ash</span>
            <span style={{ fontSize: '14px', fontWeight: 700, color: southLandAshPct < 15 ? '#4ade80' : '#fb923c' }}>
              {southLandAshPct}%
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <button
            type="button"
            onClick={onApplyClimateAndFoliage}
            style={applyFoliageBtnStyle}
            title="Update world rainfall and vegetation maps from winds, storms, and heavy ashfall"
          >
            🌿 Apply Wind & Ash to Foliage
          </button>
          {statusMsg && <div style={{ fontSize: '11px', color: '#5eead4', textAlign: 'center' }}>{statusMsg}</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={sectionHeaderStyle}>
              Volcanoes ({activeCount}/{volcanoMarkers.length} Erupting)
            </span>
            <button type="button" onClick={onStartPlaceVolcano} style={actionBtnStyle}>
              + Place Volcano
            </button>
          </div>

          {volcanoMarkers.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
              No volcanoes placed yet. Place one on a mountain ridge or generate faults.
            </div>
          ) : (
            volcanoMarkers.map((v) => {
              const active = Boolean(v.eruptionActive);
              const mag = v.eruptionMagnitude ?? 7;
              return (
                <div key={v.id} style={volcanoCardStyle(active)}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={volcanoTitleStyle}>
                      🌋 {v.name}{' '}
                      <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
                        ({formatLatitudeBadge(v.x, v.z)})
                      </span>
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      <button type="button" onClick={() => onPanToVolcano(v)} title="Center view on volcano" style={actionBtnStyle}>
                        🎯
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateVolcano(v.id, { eruptionActive: !active, eruptionMagnitude: mag })}
                        style={eruptBtnStyle(active)}
                      >
                        {active ? 'Erupting' : 'Erupt'}
                      </button>
                    </div>
                  </div>
                  <label style={scaleRowStyle}>
                    <span style={{ whiteSpace: 'nowrap' }}>Scale {mag}/8</span>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={mag}
                      onChange={(e) => onUpdateVolcano(v.id, { eruptionMagnitude: Number(e.target.value) })}
                      style={{ flex: 1, accentColor: '#f97316' }}
                    />
                  </label>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: '1px solid #1e293b',
  background: '#0b1220',
  gap: '8px',
};

const scrollBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#94a3b8',
  fontWeight: 600,
  textTransform: 'uppercase',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: '5px',
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#e2e8f0',
  fontSize: '11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const applyFoliageBtnStyle: React.CSSProperties = {
  ...actionBtnStyle,
  width: '100%',
  padding: '7px 10px',
  background: '#0f766e',
  border: '1px solid #2dd4bf',
  color: '#f8fafc',
  fontWeight: 600,
};

const hemisphereBoxStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '6px',
  padding: '8px',
  borderRadius: '6px',
  background: '#080e1d',
  border: '1px solid #1e293b',
};

const volcanoTitleStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#f8fafc',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const scaleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  fontSize: '11px',
  color: '#cbd5e1',
};

const layerRowStyle = (checked: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '6px 8px',
  borderRadius: '6px',
  border: checked ? '1px solid #38bdf8' : '1px solid #1e293b',
  background: checked ? 'rgba(56, 189, 248, 0.14)' : '#0b1220',
  cursor: 'pointer',
  fontSize: '12px',
});

const volcanoCardStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '8px',
  borderRadius: '6px',
  border: active ? '1px solid #f97316' : '1px solid #1e293b',
  background: active ? 'rgba(249, 115, 22, 0.12)' : '#0b1220',
});

const eruptBtnStyle = (active: boolean): React.CSSProperties => ({
  ...actionBtnStyle,
  background: active ? '#dc2626' : '#1e293b',
  border: active ? '1px solid #fca5a5' : '1px solid #334155',
  color: '#f8fafc',
  fontWeight: 600,
});
