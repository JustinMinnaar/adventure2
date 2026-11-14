import React, { useState, useEffect } from 'react';
import {
  WorldMarker,
  WorldPoint2D,
  WorldRoute,
  RouteState,
  RouteStop,
} from '../core/QWorldVectorTree';
import { formatTravelTime, HOURS_PER_TRAVEL_DAY } from '../core/QWorldRoutePlanner';
import { EditorToolMode, MARKER_PRESETS } from '../core/QWorldEditorTypes';
import { QWorldToolOptionsBar, QWorldToolOptionsProps, RoadSubMode } from './QWorldToolOptionsBar';
import {
  createRandomSeed,
  WorldGenOptions,
  DEFAULT_WORLD_GEN_OPTIONS,
} from '../core/QWorldStarterGenerator';
import { QWorldWeatherPanel, QWorldWeatherPanelProps } from './QWorldWeatherPanel';

interface QWorldRightPanelProps {
  width: number;
  toolMode: EditorToolMode;
  onToolModeChange: (mode: EditorToolMode) => void;
  markers: WorldMarker[];
  selectedMarker: WorldMarker | null;
  selectedMarkerElevation?: number | null;
  tempPin: WorldPoint2D | null;
  onSelectMarker: (id: string | null) => void;
  onAddMarker: () => void;
  onClearTempPin: () => void;
  onUpdateMarker: (id: string, patch: Partial<WorldMarker>) => void;
  onDeleteMarker: (id: string) => void;
  onShowMarker: (marker: WorldMarker) => void;
  onPanToMarker?: (marker: WorldMarker) => void;
  worldSeed: string;
  worldGenOptions: WorldGenOptions;
  onResetStarterWorld: (seed?: string, options?: WorldGenOptions) => void;
  routes?: WorldRoute[];
  selectedRouteId?: string | null;
  onSelectRoute?: (id: string | null) => void;
  routeFromStop?: RouteStop | null;
  routeViaStops?: RouteStop[];
  routeToStop?: RouteStop | null;
  onSetRouteFromStop?: (stop: RouteStop | null) => void;
  onSetRouteViaStop?: (index: number, stop: RouteStop | null) => void;
  onAddRouteViaSlot?: (stop: RouteStop) => void;
  onSetRouteToStop?: (stop: RouteStop | null) => void;
  onReverseRouteStops?: () => void;
  onClearRouteStops?: () => void;
  routeDraftState?: RouteState;
  onRouteDraftStateChange?: (state: RouteState) => void;
  onPlanRoute?: () => void;
  onReplanRoute?: (routeId: string) => void;
  onUpdateRoute?: (routeId: string, patch: Partial<WorldRoute>) => void;
  onDeleteRoute?: (routeId: string) => void;
  onShowRoute?: (route: WorldRoute) => void;
  onPanToWorldPoint?: (pt: WorldPoint2D) => void;
  routeStatusMsg?: { text: string; isError?: boolean } | null;
  roadSubMode?: RoadSubMode;
  onRoadSubModeChange?: (mode: RoadSubMode) => void;
  mergeRouteNetwork?: boolean;
  onMergeRouteNetworkChange?: (enabled: boolean) => void;
  toolOptions?: Omit<QWorldToolOptionsProps, 'toolMode'>;
  viewAlignment?: 'ns' | 'sun';
  onViewAlignmentChange?: (alignment: 'ns' | 'sun') => void;
  onResetView?: () => void;
  weatherPanelProps?: QWorldWeatherPanelProps;
}

const TOOL_BUTTONS: { mode: EditorToolMode; label: string; icon: string }[] = [
  { mode: 'select', label: 'Select / Pan', icon: '🖐️' },
  { mode: 'elevate', label: 'Elevate', icon: '🏔️' },
  { mode: 'biome', label: 'Biome', icon: '🌲' },
  { mode: 'polygon', label: 'Polygon', icon: '⬡' },
  { mode: 'river', label: 'River', icon: '🌊' },
  { mode: 'road', label: 'Road', icon: '🛤️' },
  { mode: 'marker', label: 'Marker', icon: '📍' },
  { mode: 'weather', label: 'Weather & Fallout', icon: '🌪️' },
  { mode: 'generate', label: 'Generate World', icon: '🌐' },
  { mode: 'help', label: 'Help & Guide', icon: '❓' },
];

export const QWorldRightPanel: React.FC<QWorldRightPanelProps> = ({
  width,
  toolMode,
  onToolModeChange,
  markers,
  selectedMarker,
  selectedMarkerElevation = null,
  tempPin,
  onSelectMarker,
  onAddMarker,
  onClearTempPin,
  onUpdateMarker,
  onDeleteMarker,
  onShowMarker,
  onPanToMarker,
  worldSeed,
  worldGenOptions,
  onResetStarterWorld,
  routes = [],
  selectedRouteId = null,
  onSelectRoute,
  routeFromStop = null,
  routeViaStops = [],
  routeToStop = null,
  onSetRouteFromStop,
  onSetRouteViaStop,
  onAddRouteViaSlot,
  onSetRouteToStop,
  onReverseRouteStops,
  onClearRouteStops,
  routeDraftState = 'path',
  onRouteDraftStateChange,
  onPlanRoute,
  onReplanRoute,
  onUpdateRoute,
  onDeleteRoute,
  onShowRoute,
  onPanToWorldPoint,
  routeStatusMsg = null,
  roadSubMode = 'route',
  onRoadSubModeChange,
  mergeRouteNetwork = true,
  onMergeRouteNetworkChange,
  toolOptions,
  viewAlignment = 'ns',
  onViewAlignmentChange,
  onResetView,
  weatherPanelProps,
}) => {
  const [seedDraft, setSeedDraft] = useState(worldSeed);
  const [genDraft, setGenDraft] = useState<WorldGenOptions>(worldGenOptions);

  useEffect(() => {
    setSeedDraft(worldSeed);
  }, [worldSeed]);

  useEffect(() => {
    setGenDraft(worldGenOptions);
  }, [worldGenOptions]);

  const activeToolMeta = TOOL_BUTTONS.find((t) => t.mode === toolMode) ?? TOOL_BUTTONS[0];

  const makeStopFromSelectedMarker = (): RouteStop | null => {
    if (!selectedMarker) return null;
    return {
      markerId: selectedMarker.id,
      label: selectedMarker.name,
      x: selectedMarker.x,
      z: selectedMarker.z,
    };
  };

  const activeStopsCount =
    (routeFromStop ? 1 : 0) + routeViaStops.length + (routeToStop ? 1 : 0);
  const sameEndpoints =
    routeFromStop &&
    routeToStop &&
    routeViaStops.length === 0 &&
    ((routeFromStop.markerId && routeFromStop.markerId === routeToStop.markerId) ||
      (Math.abs(routeFromStop.x - routeToStop.x) < 1 && Math.abs(routeFromStop.z - routeToStop.z) < 1));
  const canPlanRoute = Boolean(routeFromStop && routeToStop && !sameEndpoints);

  const formatYards = (yards: number): string => {
    if (yards >= 1760) {
      return `${(yards / 1760).toFixed(2)} mi (${yards.toLocaleString()} yd)`;
    }
    return `${yards.toLocaleString()} yd`;
  };

  const formatDetailedHoursTitle = (modeName: string, hours: number): string => {
    const days = hours / HOURS_PER_TRAVEL_DAY;
    return `${modeName}: ${hours.toFixed(1)} hr (${days.toFixed(2)} travel days @ 8 hr/day)`;
  };

  const renderMarkerLabel = (m: WorldMarker | null, fallback: string) => {
    if (!m) {
      return <span style={{ color: '#64748b', fontStyle: 'italic' }}>{fallback}</span>;
    }
    const preset = MARKER_PRESETS.find((p) => p.category === m.category);
    return (
      <span style={{ color: '#f8fafc', fontWeight: 600 }}>
        {preset?.icon ?? '📍'} {m.name}
      </span>
    );
  };

  const renderStopLabel = (stop: RouteStop | null, fallback: string) => {
    if (!stop) {
      return <span style={{ color: '#64748b', fontStyle: 'italic' }}>{fallback}</span>;
    }
    if (stop.markerId) {
      const m = markers.find((mk) => mk.id === stop.markerId);
      if (m) return renderMarkerLabel(m, fallback);
    }
    return (
      <span style={{ color: '#bae6fd', fontWeight: 600 }}>
        📌 {stop.label}
      </span>
    );
  };

  return (
    <aside
      style={{
        width: `${width}px`,
        flexShrink: 0,
        height: '100%',
        background: '#0f172a',
        borderLeft: '1px solid #1e293b',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Icon-Button Bar for Tools */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: '3px',
          padding: '6px 8px',
          borderBottom: '1px solid #1e293b',
          background: '#080e1d',
          flexShrink: 0,
        }}
      >
        {TOOL_BUTTONS.map((btn) => {
          const active = toolMode === btn.mode;
          return (
            <button
              key={btn.mode}
              type="button"
              onClick={() => onToolModeChange(btn.mode)}
              title={btn.label}
              aria-label={btn.label}
              style={{
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                border: active ? '1px solid #38bdf8' : '1px solid #334155',
                background: active ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
                color: active ? '#f8fafc' : '#cbd5e1',
                fontSize: '15px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {btn.icon}
            </button>
          );
        })}
      </div>

      {/* Tool Page Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {toolMode === 'marker' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {selectedMarker ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Marker Page Top Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                  padding: '8px 10px',
                  borderBottom: '1px solid #1e293b',
                  background: '#0b1220',
                }}
              >
                <button
                  onClick={() => onSelectMarker(null)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '5px',
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#cbd5e1',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                  title="Back to Markers list"
                >
                  ← Markers
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => onUpdateMarker(selectedMarker.id, { locked: !selectedMarker.locked })}
                    aria-label={selectedMarker.locked ? 'Unlock marker position' : 'Lock marker position'}
                    aria-pressed={!!selectedMarker.locked}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: selectedMarker.locked ? '1px solid #f59e0b' : '1px solid #334155',
                      background: selectedMarker.locked ? 'rgba(245, 158, 11, 0.22)' : '#1e293b',
                      color: selectedMarker.locked ? '#fde68a' : '#cbd5e1',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                    title={
                      selectedMarker.locked
                        ? 'Position locked — click to allow dragging on map'
                        : 'Lock marker position to prevent dragging'
                    }
                  >
                    {selectedMarker.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    onClick={() => onShowMarker(selectedMarker)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '5px',
                      border: '1px solid #0ea5e9',
                      background: '#0369a1',
                      color: '#f8fafc',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Pan and zoom the map to this marker"
                  >
                    🎯 Show
                  </button>
                  <button
                    onClick={() => onDeleteMarker(selectedMarker.id)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: '1px solid #7f1d1d',
                      background: '#450a0a',
                      color: '#fecaca',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                    title="Delete marker"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Marker Details Form */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '12px',
                  overflowY: 'auto',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Title
                  </label>
                  <input
                    type="text"
                    value={selectedMarker.name}
                    onChange={(e) => onUpdateMarker(selectedMarker.id, { name: e.target.value })}
                    placeholder="Marker title..."
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      color: '#f8fafc',
                      fontSize: '13px',
                      fontWeight: 600,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Type
                  </label>
                  <select
                    value={selectedMarker.category}
                    onChange={(e) => {
                      const preset = MARKER_PRESETS.find((p) => p.category === e.target.value);
                      onUpdateMarker(selectedMarker.id, {
                        category: e.target.value,
                        minLod: preset ? Math.min(selectedMarker.minLod, preset.minLod) : selectedMarker.minLod,
                        maxLod: preset ? preset.maxLod : selectedMarker.maxLod,
                      });
                    }}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      color: '#f8fafc',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  >
                    {MARKER_PRESETS.map((p) => (
                      <option key={p.category} value={p.category}>
                        {p.icon} {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#94a3b8',
                    background: '#020617',
                    border: '1px solid #1e293b',
                    borderRadius: '5px',
                    padding: '5px 8px',
                  }}
                >
                  <span>
                    X: {Math.round(selectedMarker.x)} · Z: {Math.round(selectedMarker.z)} · Elev:{' '}
                    {Math.round(selectedMarkerElevation ?? selectedMarker.y ?? 0)} yd
                  </span>
                  <span>
                    {selectedMarker.locked ? '🔒 Locked · ' : ''}Zoom:{' '}
                    {selectedMarker.zoomDistance !== undefined
                      ? `${Math.round(selectedMarker.zoomDistance).toLocaleString()} yd`
                      : 'auto'}
                  </span>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '180px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Notes
                  </label>
                  <textarea
                    value={selectedMarker.notes ?? ''}
                    onChange={(e) => onUpdateMarker(selectedMarker.id, { notes: e.target.value })}
                    placeholder="Write lore, NPCs, hooks, travel notes..."
                    style={{
                      flex: 1,
                      resize: 'none',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      color: '#e2e8f0',
                      fontSize: '13px',
                      lineHeight: 1.5,
                      outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Markers List Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderBottom: '1px solid #1e293b',
                  background: '#0b1220',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                  📍 Markers ({markers.length})
                </span>
                <button
                  onClick={onAddMarker}
                  title={
                    tempPin
                      ? 'Create marker at temporary pin'
                      : 'Create marker at current map center'
                  }
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: tempPin ? '1px solid #38bdf8' : '1px solid #334155',
                    background: tempPin ? '#0284c7' : '#1e293b',
                    color: '#f8fafc',
                    fontSize: '14px',
                    fontWeight: 700,
                    lineHeight: 1.1,
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>

              {tempPin && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    padding: '7px 10px',
                    background: 'rgba(14, 116, 144, 0.22)',
                    borderBottom: '1px solid rgba(56, 189, 248, 0.35)',
                    fontSize: '11px',
                    color: '#bae6fd',
                  }}
                >
                  <span>
                    📌 Pin at ({Math.round(tempPin.x)}, {Math.round(tempPin.z)}) — click <strong>+</strong> to add
                  </span>
                  <button
                    onClick={onClearTempPin}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                    title="Clear temporary pin"
                  >
                    ✕
                  </button>
                </div>
              )}

              {!tempPin && (
                <div
                  style={{
                    padding: '7px 10px',
                    borderBottom: '1px solid #1e293b',
                    fontSize: '11px',
                    color: '#94a3b8',
                  }}
                >
                  Click a marker to open it, drag unlocked markers to reposition, or click the map to drop a pin and press <strong>+</strong>.
                </div>
              )}

              {/* Markers List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {markers.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: '#64748b' }}>
                    No markers yet.
                  </div>
                ) : (
                  markers.map((m) => {
                    const preset = MARKER_PRESETS.find((p) => p.category === m.category);
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          width: '100%',
                          padding: '6px 8px 6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #1e293b',
                          background: '#020617',
                          color: '#e2e8f0',
                          boxSizing: 'border-box',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectMarker(m.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flex: 1,
                            minWidth: 0,
                            textAlign: 'left',
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: '14px' }}>{preset?.icon ?? '📍'}</span>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#f8fafc',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {m.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {preset?.label ?? m.category}
                              {m.notes ? ' · 📝' : ''}
                            </div>
                          </div>
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPanToMarker?.(m);
                            }}
                            aria-label={`Pan to ${m.name}`}
                            title="Pan map to marker (keep current zoom)"
                            style={{
                              padding: '3px 6px',
                              borderRadius: '4px',
                              border: '1px solid #1e293b',
                              background: '#0f172a',
                              color: '#94a3b8',
                              fontSize: '11px',
                              lineHeight: 1,
                              cursor: 'pointer',
                            }}
                          >
                            👁️
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateMarker(m.id, { locked: !m.locked });
                            }}
                            aria-label={m.locked ? `Unlock ${m.name}` : `Lock ${m.name}`}
                            aria-pressed={!!m.locked}
                            title={
                              m.locked
                                ? 'Position locked — click to allow dragging on map'
                                : 'Lock marker position to prevent dragging'
                            }
                            style={{
                              padding: '3px 6px',
                              borderRadius: '4px',
                              border: m.locked ? '1px solid rgba(245, 158, 11, 0.6)' : '1px solid #1e293b',
                              background: m.locked ? 'rgba(245, 158, 11, 0.18)' : '#0f172a',
                              color: m.locked ? '#fde68a' : '#94a3b8',
                              fontSize: '11px',
                              lineHeight: 1,
                              cursor: 'pointer',
                            }}
                          >
                            {m.locked ? '🔒' : '🔓'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectMarker(m.id)}
                            aria-label={`Open ${m.name}`}
                            style={{
                              padding: '2px 4px',
                              border: 'none',
                              background: 'transparent',
                              fontSize: '12px',
                              color: '#64748b',
                              cursor: 'pointer',
                            }}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
            </div>
            {toolOptions && <QWorldToolOptionsBar toolMode={toolMode} {...toolOptions} />}
          </div>
        ) : toolMode === 'road' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                padding: '9px 10px',
                borderBottom: '1px solid #1e293b',
                background: '#0b1220',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                🛤️ Roads & Routes
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => onRoadSubModeChange?.('route')}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '5px',
                    border: roadSubMode === 'route' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: roadSubMode === 'route' ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
                    color: '#f8fafc',
                    fontSize: '11px',
                    fontWeight: roadSubMode === 'route' ? 600 : 400,
                    cursor: 'pointer',
                  }}
                  title="Select 2 or 3+ marker places (From / Via / To)"
                >
                  🧭 Places
                </button>
                <button
                  type="button"
                  onClick={() => onRoadSubModeChange?.('pins')}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '5px',
                    border: roadSubMode === 'pins' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: roadSubMode === 'pins' ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
                    color: '#f8fafc',
                    fontSize: '11px',
                    fontWeight: roadSubMode === 'pins' ? 600 : 400,
                    cursor: 'pointer',
                  }}
                  title="Click markers or terrain points on the map to chain multi-step waypoints"
                >
                  📌 Pins
                </button>
                <button
                  type="button"
                  onClick={() => onRoadSubModeChange?.('freehand')}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '5px',
                    border: roadSubMode === 'freehand' ? '1px solid #38bdf8' : '1px solid #334155',
                    background: roadSubMode === 'freehand' ? 'rgba(56, 189, 248, 0.22)' : '#1e293b',
                    color: '#f8fafc',
                    fontSize: '11px',
                    fontWeight: roadSubMode === 'freehand' ? 600 : 400,
                    cursor: 'pointer',
                  }}
                  title="Click points on map to draw manual road segments"
                >
                  ✏️ Draw
                </button>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Currently Selected Map Marker / Pin Mode Banner */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border:
                    roadSubMode === 'pins'
                      ? '1px solid rgba(251, 191, 36, 0.45)'
                      : selectedMarker
                        ? '1px solid rgba(56, 189, 248, 0.45)'
                        : '1px solid #1e293b',
                  background:
                    roadSubMode === 'pins'
                      ? 'rgba(245, 158, 11, 0.12)'
                      : selectedMarker
                        ? 'rgba(14, 116, 144, 0.16)'
                        : '#0b1220',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {roadSubMode === 'pins' ? (
                    <span style={{ color: '#fde68a', fontSize: '11px' }}>
                      📌 <strong>Pin Mode:</strong> Click markers or terrain points on the map to add steps (e.g. through or around a forest).
                    </span>
                  ) : selectedMarker ? (
                    <>
                      <span style={{ color: '#94a3b8', marginRight: '5px' }}>Selected:</span>
                      {renderMarkerLabel(selectedMarker, '')}
                    </>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                      Click a marker on the map & click <strong>Set</strong> below, or switch to <strong>📌 Pins</strong> to click steps on the map.
                    </span>
                  )}
                </div>
                {selectedMarker && roadSubMode !== 'pins' && (
                  <button
                    type="button"
                    onClick={() => onPanToMarker?.(selectedMarker)}
                    title={`Pan to ${selectedMarker.name}`}
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      border: '1px solid #334155',
                      background: '#1e293b',
                      color: '#cbd5e1',
                      fontSize: '11px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    👁️
                  </button>
                )}
              </div>

              {/* Route Planner Box */}
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #1e293b',
                  background: '#0b1220',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '7px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Plan Route ({Math.max(2, activeStopsCount)} Stops)
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {selectedMarker && routeViaStops.length >= 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const st = makeStopFromSelectedMarker();
                          if (st) onAddRouteViaSlot?.(st);
                        }}
                        title={`Add ${selectedMarker.name} as an additional Via stop`}
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid #38bdf8',
                          background: 'rgba(56, 189, 248, 0.16)',
                          color: '#e0f2fe',
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        + Via
                      </button>
                    )}
                    {(routeFromStop || routeToStop) && (
                      <button
                        type="button"
                        onClick={() => onReverseRouteStops?.()}
                        title="Reverse route direction"
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid #334155',
                          background: '#1e293b',
                          color: '#cbd5e1',
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        ⇅ Reverse
                      </button>
                    )}
                    {activeStopsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onClearRouteStops?.()}
                        title="Clear all stops"
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid #334155',
                          background: '#1e293b',
                          color: '#94a3b8',
                          fontSize: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* FROM field */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '38px', fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>
                    From
                  </span>
                  <div
                    onClick={() => {
                      if (routeFromStop) onPanToWorldPoint?.({ x: routeFromStop.x, z: routeFromStop.z });
                    }}
                    title={routeFromStop ? `Click to pan to ${routeFromStop.label}` : undefined}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      fontSize: '12px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: routeFromStop ? 'pointer' : 'default',
                    }}
                  >
                    {renderStopLabel(routeFromStop, '— Start place —')}
                  </div>
                  <button
                    type="button"
                    disabled={!selectedMarker}
                    onClick={() => {
                      const st = makeStopFromSelectedMarker();
                      if (st) onSetRouteFromStop?.(st);
                    }}
                    title={
                      selectedMarker
                        ? `Set From to ${selectedMarker.name}`
                        : 'Select a marker on the map first'
                    }
                    style={{
                      ...secondaryBtnStyle,
                      padding: '4px 8px',
                      opacity: selectedMarker ? 1 : 0.45,
                      cursor: selectedMarker ? 'pointer' : 'not-allowed',
                      border: selectedMarker ? '1px solid #38bdf8' : '1px solid #334155',
                      color: selectedMarker ? '#f8fafc' : '#94a3b8',
                    }}
                  >
                    Set
                  </button>
                  {routeFromStop && (
                    <button
                      type="button"
                      onClick={() => onSetRouteFromStop?.(null)}
                      title="Clear From stop"
                      style={{ ...secondaryBtnStyle, padding: '4px 6px' }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* VIA field(s) — always shows at least 1 optional 3rd-place Via slot */}
                {routeViaStops.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '38px', fontSize: '12px', color: '#64748b', flexShrink: 0 }}>
                      Via
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '5px 8px',
                        borderRadius: '6px',
                        border: '1px dashed #1e293b',
                        background: '#020617',
                        fontSize: '12px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {renderStopLabel(null, '— Optional 3rd place —')}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedMarker}
                      onClick={() => {
                        const st = makeStopFromSelectedMarker();
                        if (st) onAddRouteViaSlot?.(st);
                      }}
                      title={
                        selectedMarker
                          ? `Route via ${selectedMarker.name}`
                          : 'Select a marker on the map to add an intermediate Via stop'
                      }
                      style={{
                        ...secondaryBtnStyle,
                        padding: '4px 8px',
                        opacity: selectedMarker ? 1 : 0.45,
                        cursor: selectedMarker ? 'pointer' : 'not-allowed',
                        border: selectedMarker ? '1px solid #38bdf8' : '1px solid #334155',
                        color: selectedMarker ? '#f8fafc' : '#94a3b8',
                      }}
                    >
                      Set
                    </button>
                  </div>
                ) : (
                  routeViaStops.map((viaStop, idx) => (
                    <div key={`via-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '38px', fontSize: '11px', color: '#94a3b8', flexShrink: 0 }}>
                        {routeViaStops.length === 1 ? 'Via' : `Via ${idx + 1}`}
                      </span>
                      <div
                        onClick={() => onPanToWorldPoint?.({ x: viaStop.x, z: viaStop.z })}
                        title={`Click to pan to ${viaStop.label}`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          padding: '5px 8px',
                          borderRadius: '6px',
                          border: '1px solid #334155',
                          background: '#020617',
                          fontSize: '12px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {renderStopLabel(viaStop, '— Via —')}
                      </div>
                      <button
                        type="button"
                        disabled={!selectedMarker}
                        onClick={() => {
                          const st = makeStopFromSelectedMarker();
                          if (st) onSetRouteViaStop?.(idx, st);
                        }}
                        title={
                          selectedMarker
                            ? `Replace with ${selectedMarker.name}`
                            : 'Select a marker on the map first'
                        }
                        style={{
                          ...secondaryBtnStyle,
                          padding: '4px 8px',
                          opacity: selectedMarker ? 1 : 0.45,
                          cursor: selectedMarker ? 'pointer' : 'not-allowed',
                          border: selectedMarker ? '1px solid #38bdf8' : '1px solid #334155',
                          color: selectedMarker ? '#f8fafc' : '#94a3b8',
                        }}
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetRouteViaStop?.(idx, null)}
                        title="Remove Via stop"
                        style={{ ...secondaryBtnStyle, padding: '4px 6px' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}

                {/* TO field */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '38px', fontSize: '12px', color: '#94a3b8', flexShrink: 0 }}>
                    To
                  </span>
                  <div
                    onClick={() => {
                      if (routeToStop) onPanToWorldPoint?.({ x: routeToStop.x, z: routeToStop.z });
                    }}
                    title={routeToStop ? `Click to pan to ${routeToStop.label}` : undefined}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      fontSize: '12px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: routeToStop ? 'pointer' : 'default',
                    }}
                  >
                    {renderStopLabel(routeToStop, '— End place —')}
                  </div>
                  <button
                    type="button"
                    disabled={!selectedMarker}
                    onClick={() => {
                      const st = makeStopFromSelectedMarker();
                      if (st) onSetRouteToStop?.(st);
                    }}
                    title={
                      selectedMarker
                        ? `Set To to ${selectedMarker.name}`
                        : 'Select a marker on the map first'
                    }
                    style={{
                      ...secondaryBtnStyle,
                      padding: '4px 8px',
                      opacity: selectedMarker ? 1 : 0.45,
                      cursor: selectedMarker ? 'pointer' : 'not-allowed',
                      border: selectedMarker ? '1px solid #38bdf8' : '1px solid #334155',
                      color: selectedMarker ? '#f8fafc' : '#94a3b8',
                    }}
                  >
                    Set
                  </button>
                  {routeToStop && (
                    <button
                      type="button"
                      onClick={() => onSetRouteToStop?.(null)}
                      title="Clear To stop"
                      style={{ ...secondaryBtnStyle, padding: '4px 6px' }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {sameEndpoints && (
                  <div style={{ fontSize: '11px', color: '#fbbf24' }}>
                    Choose two different places (or add a Via stop between them).
                  </div>
                )}

                {/* Initial State selector */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>Lay as</span>
                  <div style={{ display: 'flex', gap: '4px', flex: 1, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => onRouteDraftStateChange?.('path')}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '5px',
                        border: routeDraftState === 'path' ? '1px solid #fbbf24' : '1px solid #334155',
                        background: routeDraftState === 'path' ? 'rgba(251, 191, 36, 0.18)' : '#1e293b',
                        color: routeDraftState === 'path' ? '#fef3c7' : '#cbd5e1',
                        fontSize: '11px',
                        fontWeight: routeDraftState === 'path' ? 600 : 400,
                        cursor: 'pointer',
                      }}
                      title="Footpath (dotted): peasants walk through woods if shorter"
                    >
                      ┈ Path (Foot)
                    </button>
                    <button
                      type="button"
                      onClick={() => onRouteDraftStateChange?.('road')}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '5px',
                        border: routeDraftState === 'road' ? '1px solid #f59e0b' : '1px solid #334155',
                        background: routeDraftState === 'road' ? 'rgba(245, 158, 11, 0.22)' : '#1e293b',
                        color: routeDraftState === 'road' ? '#fef3c7' : '#cbd5e1',
                        fontSize: '11px',
                        fontWeight: routeDraftState === 'road' ? 600 : 400,
                        cursor: 'pointer',
                      }}
                      title="Wagon Road (solid): routes around dense forests over open hills & plains"
                    >
                      ─ Road (Wagon)
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!canPlanRoute}
                  onClick={() => onPlanRoute?.()}
                  style={{
                    ...secondaryBtnStyle,
                    marginTop: '4px',
                    padding: '7px 12px',
                    background: canPlanRoute ? '#0284c7' : '#1e293b',
                    border: canPlanRoute ? '1px solid #38bdf8' : '1px solid #334155',
                    color: canPlanRoute ? '#f8fafc' : '#64748b',
                    fontWeight: 600,
                    cursor: canPlanRoute ? 'pointer' : 'not-allowed',
                  }}
                >
                  🧭 Plan {routeDraftState === 'path' ? 'Path' : 'Road'}
                </button>

                {routeStatusMsg && (
                  <div
                    style={{
                      fontSize: '11px',
                      lineHeight: 1.35,
                      color: routeStatusMsg.isError ? '#fca5a5' : '#7dd3fc',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      background: routeStatusMsg.isError
                        ? 'rgba(239, 68, 68, 0.12)'
                        : 'rgba(56, 189, 248, 0.1)',
                    }}
                  >
                    {routeStatusMsg.text}
                  </div>
                )}
              </div>

              {/* Planned Routes List + Merge Network Toggle */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Routes ({routes.length})
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    title="Merge shared road segments and draw busier trunk corridors thicker"
                  >
                    <input
                      type="checkbox"
                      checked={mergeRouteNetwork}
                      onChange={(e) => onMergeRouteNetworkChange?.(e.target.checked)}
                      style={{ accentColor: '#38bdf8', margin: 0, cursor: 'pointer' }}
                    />
                    Merge Network
                  </label>
                </div>

                {routes.length === 0 ? (
                  <div
                    style={{
                      padding: '14px 10px',
                      borderRadius: '6px',
                      border: '1px dashed #1e293b',
                      color: '#64748b',
                      fontSize: '12px',
                      textAlign: 'center',
                    }}
                  >
                    No planned routes yet. Set 2–3+ places above or click pins on the map.
                  </div>
                ) : (
                  routes.map((rt) => {
                    const mA = markers.find((m) => m.id === rt.fromMarkerId);
                    const mB = markers.find((m) => m.id === rt.toMarkerId);
                    const title = rt.name || `${mA?.name ?? 'Origin'} → ${mB?.name ?? 'Destination'}`;
                    const isSelected = selectedRouteId === rt.id;

                    return (
                      <div
                        key={rt.id}
                        onClick={() => onSelectRoute?.(isSelected ? null : rt.id)}
                        style={{
                          padding: '8px 9px',
                          borderRadius: '7px',
                          border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                          background: isSelected ? 'rgba(56, 189, 248, 0.12)' : '#0b1220',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                          <div
                            style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#f8fafc',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={title}
                          >
                            {rt.state === 'path' ? '┈ ' : '─ '}
                            {title}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onShowRoute?.(rt);
                              }}
                              title="Show route on map"
                              style={{
                                padding: '2px 5px',
                                borderRadius: '4px',
                                border: '1px solid #334155',
                                background: '#1e293b',
                                color: '#cbd5e1',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              🎯
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onReplanRoute?.(rt.id);
                              }}
                              title="Re-plan route along updated terrain, forests & roads"
                              style={{
                                padding: '2px 5px',
                                borderRadius: '4px',
                                border: '1px solid #334155',
                                background: '#1e293b',
                                color: '#cbd5e1',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              🔄
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteRoute?.(rt.id);
                              }}
                              title="Delete route"
                              style={{
                                padding: '2px 5px',
                                borderRadius: '4px',
                                border: '1px solid #334155',
                                background: '#1e293b',
                                color: '#fca5a5',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                          <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {formatYards(rt.lengthYards)}
                            {rt.elevationGainYards !== undefined ? ` · ↗ +${rt.elevationGainYards} yd` : ''}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateRoute?.(rt.id, { state: 'path' });
                              }}
                              title="Set state to Path (dotted footpath)"
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                border: rt.state === 'path' ? '1px solid #fbbf24' : '1px solid #334155',
                                background: rt.state === 'path' ? 'rgba(251, 191, 36, 0.2)' : '#1e293b',
                                color: rt.state === 'path' ? '#fef3c7' : '#94a3b8',
                                fontSize: '10px',
                                fontWeight: rt.state === 'path' ? 600 : 400,
                                cursor: 'pointer',
                              }}
                            >
                              ┈ Path
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateRoute?.(rt.id, { state: 'road' });
                              }}
                              title="Promote to permanent Road (solid surface for wagons & riders)"
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                border: rt.state === 'road' ? '1px solid #f59e0b' : '1px solid #334155',
                                background: rt.state === 'road' ? 'rgba(245, 158, 11, 0.24)' : '#1e293b',
                                color: rt.state === 'road' ? '#fef3c7' : '#94a3b8',
                                fontSize: '10px',
                                fontWeight: rt.state === 'road' ? 600 : 400,
                                cursor: 'pointer',
                              }}
                            >
                              ─ Road
                            </button>
                          </div>
                        </div>

                        {/* Travel Times: Walking, Riding, Vehicles */}
                        {rt.travelHours && (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(3, 1fr)',
                              gap: '4px',
                              padding: '4px 6px',
                              borderRadius: '5px',
                              background: '#020617',
                              border: '1px solid #1e293b',
                              fontSize: '10px',
                              fontFamily: 'monospace',
                            }}
                          >
                            <div
                              title={formatDetailedHoursTitle('Walking (foot)', rt.travelHours.walkingHours)}
                              style={{ color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              🚶 {formatTravelTime(rt.travelHours.walkingHours)}
                            </div>
                            <div
                              title={formatDetailedHoursTitle('Riding (horse)', rt.travelHours.ridingHours)}
                              style={{ color: '#bae6fd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            >
                              🐎 {formatTravelTime(rt.travelHours.ridingHours)}
                            </div>
                            <div
                              title={formatDetailedHoursTitle('Vehicles (wagon/cart)', rt.travelHours.vehiclesHours)}
                              style={{
                                color:
                                  rt.travelHours.vehiclesHours > rt.travelHours.walkingHours * 1.4
                                    ? '#fca5a5'
                                    : '#fde68a',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              🛞 {formatTravelTime(rt.travelHours.vehiclesHours)}
                            </div>
                          </div>
                        )}

                        {/* Multi-step Leg Breakdown (shown when 2+ steps exist) */}
                        {rt.legs && rt.legs.length > 1 && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              paddingTop: '4px',
                              borderTop: '1px dashed #1e293b',
                              fontSize: '10px',
                              color: '#94a3b8',
                            }}
                          >
                            {rt.legs.map((leg, lIdx) => (
                              <div
                                key={lIdx}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '1px',
                                  padding: '2px 4px',
                                  borderRadius: '4px',
                                  background: 'rgba(15, 23, 42, 0.5)',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                                  <span
                                    style={{
                                      color: '#cbd5e1',
                                      fontWeight: 600,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {lIdx + 1}. {leg.fromLabel} → {leg.toLabel}
                                  </span>
                                  <span style={{ fontFamily: 'monospace', flexShrink: 0 }}>
                                    {leg.lengthYards >= 1760
                                      ? `${(leg.lengthYards / 1760).toFixed(1)} mi`
                                      : `${leg.lengthYards} yd`}
                                  </span>
                                </div>
                                <div style={{ fontFamily: 'monospace', color: '#64748b' }}>
                                  🚶 {formatTravelTime(leg.travelHours.walkingHours)} · 🐎{' '}
                                  {formatTravelTime(leg.travelHours.ridingHours)} · 🛞{' '}
                                  {formatTravelTime(leg.travelHours.vehiclesHours)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {toolOptions && <QWorldToolOptionsBar toolMode={toolMode} {...toolOptions} />}
          </div>
        ) : toolMode === 'generate' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderBottom: '1px solid #1e293b',
                background: '#0b1220',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                🌐 Generate World
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
                  World Seed
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={seedDraft}
                    onChange={(e) => setSeedDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const nextSeed = seedDraft.trim() || createRandomSeed();
                        setSeedDraft(nextSeed);
                        onResetStarterWorld(nextSeed, genDraft);
                      }
                    }}
                    placeholder="Enter seed..."
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#020617',
                      color: '#f8fafc',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nextSeed = createRandomSeed();
                      setSeedDraft(nextSeed);
                      onResetStarterWorld(nextSeed, genDraft);
                    }}
                    style={secondaryBtnStyle}
                    title="Roll a random seed & generate immediately"
                  >
                    🎲
                  </button>
                </div>
              </div>

              {(
                [
                  { key: 'waterAmount', label: 'Water Amount', min: 0, max: 100, step: 5, suffix: '%' },
                  { key: 'seaLevel', label: 'Ocean Height', min: 500, max: 1500, step: 10, suffix: ' yd' },
                  { key: 'continentScale', label: 'Continent Size', min: 0, max: 100, step: 5, suffix: '%' },
                  { key: 'mountainIntensity', label: 'Mountain Ranges', min: 0, max: 100, step: 5, suffix: '%' },
                  { key: 'volcanoCount', label: 'Volcanoes (Faults)', min: 0, max: 12, step: 1, suffix: '' },
                  { key: 'greenery', label: 'Greenery & Rain', min: 0, max: 100, step: 5, suffix: '%' },
                  { key: 'baseTempC', label: 'Base Temp', min: 0, max: 50, step: 1, suffix: '°C' },
                ] as const
              ).map((cfg) => {
                const curVal = genDraft[cfg.key] ?? DEFAULT_WORLD_GEN_OPTIONS[cfg.key] ?? 0;
                return (
                <label
                  key={cfg.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '12px',
                    color: '#cbd5e1',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{cfg.label}</span>
                    <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
                      {curVal}
                      {cfg.suffix}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={cfg.min}
                    max={cfg.max}
                    step={cfg.step}
                    value={curVal}
                    onChange={(e) => {
                      const nextOpts = { ...genDraft, [cfg.key]: Number(e.target.value) };
                      setGenDraft(nextOpts);
                      const nextSeed = seedDraft.trim() || worldSeed;
                      onResetStarterWorld(nextSeed, nextOpts);
                    }}
                    style={{ width: '100%', accentColor: '#38bdf8' }}
                  />
                </label>
                );
              })}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '6px',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setGenDraft(DEFAULT_WORLD_GEN_OPTIONS);
                    const nextSeed = seedDraft.trim() || worldSeed;
                    onResetStarterWorld(nextSeed, DEFAULT_WORLD_GEN_OPTIONS);
                  }}
                  style={secondaryBtnStyle}
                  title="Reset generation sliders to defaults"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextSeed = seedDraft.trim() || createRandomSeed();
                    setSeedDraft(nextSeed);
                    onResetStarterWorld(nextSeed, genDraft);
                  }}
                  style={{
                    ...secondaryBtnStyle,
                    background: '#0284c7',
                    border: '1px solid #38bdf8',
                    color: '#f8fafc',
                    fontWeight: 600,
                  }}
                >
                  Generate World
                </button>
              </div>
            </div>
          </div>
        ) : toolMode === 'weather' && weatherPanelProps ? (
          <QWorldWeatherPanel {...weatherPanelProps} />
        ) : toolMode === 'help' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderBottom: '1px solid #1e293b',
                background: '#0b1220',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                ❓ World &amp; Climate Guide
              </span>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontSize: '12px',
                lineHeight: 1.5,
                color: '#cbd5e1',
              }}
            >
              <div style={helpCardStyle}>
                <div style={helpHeadingStyle}>☀️ Sun Position &amp; Day/Night Shadow</div>
                <p style={{ margin: 0 }}>
                  Sunlight sweeps East-to-West as the planet rotates through the 24-hour day (<strong>12:00</strong> places
                  the Sun over the 0° Prime Meridian; <strong>00:00</strong> places it at 180° on the opposite side).
                </p>
                <p style={{ margin: '6px 0 0' }}>
                  At <strong>Spring/Autumn Equinox</strong> (🌸 Spr / 🍂 Aut), the Sun sits directly over the equator,
                  making the day/night shadow line straight vertical between <strong>N</strong> and <strong>S</strong>.
                  At <strong>Winter/Summer Solstice</strong> (❄️ Win / ☀️ Sum), the <strong>23.4°</strong> axial tilt
                  angles the shadow diagonally: in Northern Winter, the <strong>N</strong> pole enters 24-hour polar
                  night while the <strong>S</strong> pole receives 24-hour polar daylight (and the reverse in Summer).
                </p>
              </div>

              <div style={helpCardStyle}>
                <div style={helpHeadingStyle}>🧭 Planet View Alignment</div>
                <p style={{ margin: 0 }}>
                  In <strong>Select / Pan</strong> mode, you can switch how the globe is framed:
                </p>
                <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                  <li>
                    <strong>🧭 N/S Aligned</strong>: Keeps North straight up and South straight down (classic map view)
                    while the sunlight angle tilts across the seasons.
                  </li>
                  <li>
                    <strong>☀️ Sun-Aligned</strong>: Rotates the view so sunlight comes horizontally from the side and the
                    planet&apos;s <strong>N–S</strong> spin axis visibly tilts ±23.4°.
                  </li>
                  <li>
                    <strong>🌍 Reset View</strong>: Snaps the camera back to the full-world globe view.
                  </li>
                </ul>
              </div>

              <div style={helpCardStyle}>
                <div style={helpHeadingStyle}>🌡️ Latitude Climate Bands &amp; Base Temp</div>
                <p style={{ margin: 0 }}>
                  Generated worlds follow solar latitude bands: the equatorial <strong>1/6</strong> (±15°) is warm,
                  mid-latitudes (<strong>15°–55°</strong>) are temperate, and polar zones (<strong>&gt; 55°</strong>)
                  are cool to freezing with sparse or no green vegetation.
                </p>
                <p style={{ margin: '6px 0 0' }}>
                  Use <strong>Base Temp</strong> (0°C Ice to 50°C Extreme, default 10°C) in <strong>Generate World</strong>{' '}
                  to shift the planet&apos;s baseline temperature, which directly drives rainfall and biome/foliage
                  generation.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderBottom: '1px solid #1e293b',
                background: '#0b1220',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                {activeToolMeta.icon} {activeToolMeta.label}
              </span>
            </div>
            {toolMode === 'select' && (
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid #1e293b',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
                  PLANET VIEW &amp; ALIGNMENT
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => onViewAlignmentChange?.('ns')}
                    title="Keep North/South poles upright (standard map orientation)"
                    style={{
                      ...secondaryBtnStyle,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      background: viewAlignment === 'ns' ? '#0284c7' : '#1e293b',
                      border: viewAlignment === 'ns' ? '1px solid #38bdf8' : '1px solid #334155',
                      color: viewAlignment === 'ns' ? '#ffffff' : '#cbd5e1',
                      fontWeight: viewAlignment === 'ns' ? 600 : 500,
                    }}
                  >
                    <span>🧭</span>
                    <span>N/S Aligned</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onViewAlignmentChange?.('sun')}
                    title="Rotate view to align sunlight horizontally and tilt the N/S spin axis"
                    style={{
                      ...secondaryBtnStyle,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      background: viewAlignment === 'sun' ? '#0284c7' : '#1e293b',
                      border: viewAlignment === 'sun' ? '1px solid #38bdf8' : '1px solid #334155',
                      color: viewAlignment === 'sun' ? '#ffffff' : '#cbd5e1',
                      fontWeight: viewAlignment === 'sun' ? 600 : 500,
                    }}
                  >
                    <span>☀️</span>
                    <span>Sun-Aligned</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onResetView?.()}
                  title="Reset camera to full-world globe view"
                  style={{
                    ...secondaryBtnStyle,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    width: '100%',
                  }}
                >
                  <span>🌍</span>
                  <span>Reset View (Full World)</span>
                </button>
              </div>
            )}
            {toolOptions && <QWorldToolOptionsBar toolMode={toolMode} {...toolOptions} />}
            <div style={{ flex: 1 }} />
          </div>
        )}
      </div>
    </aside>
  );
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#cbd5e1',
  fontSize: '12px',
  cursor: 'pointer',
};

const helpCardStyle: React.CSSProperties = {
  background: '#0b1220',
  border: '1px solid #1e293b',
  borderRadius: '8px',
  padding: '10px 12px',
};

const helpHeadingStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: '#38bdf8',
  marginBottom: '6px',
};
