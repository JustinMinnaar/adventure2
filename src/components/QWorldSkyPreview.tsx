import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CelestialWorldConfig,
  DEFAULT_CELESTIAL_CONFIG,
  CelestialSnapshot,
  CelestialOmen,
  UpcomingOmenEvent,
  getOmenLore,
  computeCelestialSnapshot,
  computeCometSkyVisibility,
  computeDailySkyArc,
  scanUpcomingOmens,
  findAdjacentEclipse,
  EclipseProjection,
  starRaDecToHorizontal,
  computeStarPinpointLuminance,
  computeStarTwinkleFactor,
  formatClockHour,
  azimuthToCompass,
  SkyVectorHorizontal,
} from '../core/QWorldCelestial';
import {
  WORLD_CONSTELLATIONS,
  projectConstellationArtPoint,
  FixedStar,
  buildConsistentStarCatalog,
  GALAXY_CLOUD,
  GalaxyCloudNode,
  GALAXY_CORE_RA_DEG,
  GALAXY_CORE_DEC_DEG,
  COLOURED_NEBULA,
} from '../core/QWorldConstellations';
import { skyPerfMonitor, PerfSnapshot } from '../core/QWorldPerfMonitor';
import {
  SyncedVolcanicSky,
  VolcanicSkySample,
  sampleSyncedVolcanicSky,
} from '../core/QWorldVolcanicFallout';
import { getQWorldSkyMistTextures } from '../core/QWorldSkyMistTextures';

type SkyProjectionMode = 'ground' | 'surround';
type FocusedView = 'none' | 'preview' | 'dome' | 'orbit';

interface SyncedPin {
  id: string;
  name: string;
  category?: string;
  latitudeDeg: number;
  longitudeDeg: number;
}

interface SkySyncPayload {
  type?: 'time-sync' | 'map-state';
  source?: string;
  camera?: { latitudeDeg: number; longitudeDeg: number };
  activePin?: SyncedPin | null;
  markers?: SyncedPin[];
  worldHours?: number;
  volcanicSky?: SyncedVolcanicSky;
  updatedAt?: number;
}

const DEG_TO_RAD = Math.PI / 180;

function wrapAngleDiffDeg(azDeg: number, centerAzDeg: number): number {
  let d = ((azDeg - centerAzDeg + 540) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

function drawPhaseMoonDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  phaseFraction: number,
  limbAngleRad: number,
  options: {
    litColor: string;
    darkColor: string;
    rimColor?: string;
    mottle?: boolean;
  }
) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = options.darkColor;
  ctx.beginPath();
  ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
  ctx.fill();

  const f = Math.max(0, Math.min(1, phaseFraction));
  if (f > 0.006) {
    ctx.save();
    ctx.rotate(-limbAngleRad);
    ctx.fillStyle = options.litColor;
    ctx.beginPath();
    ctx.arc(0, 0, radiusPx, -Math.PI * 0.5, Math.PI * 0.5, false);

    const k = 2 * f - 1;
    const rx = Math.abs(k) * radiusPx;
    if (rx < 0.35) {
      ctx.lineTo(0, -radiusPx);
    } else if (k > 0) {
      ctx.ellipse(0, 0, rx, radiusPx, 0, Math.PI * 0.5, -Math.PI * 0.5, false);
    } else {
      ctx.ellipse(0, 0, rx, radiusPx, 0, Math.PI * 0.5, -Math.PI * 0.5, true);
    }
    ctx.closePath();
    ctx.fill();

    if (options.mottle) {
      ctx.clip();
      ctx.fillStyle = 'rgba(100, 116, 139, 0.22)';
      ctx.beginPath();
      ctx.arc(-radiusPx * 0.22, -radiusPx * 0.25, radiusPx * 0.28, 0, Math.PI * 2);
      ctx.arc(radiusPx * 0.18, radiusPx * 0.12, radiusPx * 0.22, 0, Math.PI * 2);
      ctx.arc(-radiusPx * 0.05, radiusPx * 0.36, radiusPx * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (options.rimColor) {
    ctx.strokeStyle = options.rimColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

const SPEED_OPTIONS: { label: string; hoursPerSec: number }[] = [
  { label: '1s/s', hoursPerSec: 1 / 3600 },
  { label: '1m/s', hoursPerSec: 1 / 60 },
  { label: '15m/s', hoursPerSec: 0.25 },
  { label: '1h/s', hoursPerSec: 1 },
  { label: '4h/s', hoursPerSec: 4 },
  { label: '1d/s', hoursPerSec: 24 },
];

function readInitialObserver(): {
  lat: number;
  lon: number;
  pinName: string | null;
  markers: SyncedPin[];
  worldHours: number;
  volcanicSky: SyncedVolcanicSky | null;
} {
  const params = new URLSearchParams(window.location.search);
  const urlLat = Number(params.get('lat'));
  const urlLon = Number(params.get('lon'));
  const urlPin = params.get('pin');

  let stored: (SkySyncPayload & { worldHours?: number }) | null = null;
  try {
    const raw = localStorage.getItem('adventure2_sky_sync_state');
    if (raw) stored = JSON.parse(raw) as SkySyncPayload & { worldHours?: number };
  } catch (err) {
    console.warn('Sky Preview storage read unavailable:', err);
  }

  const lat = Number.isFinite(urlLat) ? urlLat : (stored?.activePin?.latitudeDeg ?? stored?.camera?.latitudeDeg ?? 42);
  const lon = Number.isFinite(urlLon) ? urlLon : (stored?.activePin?.longitudeDeg ?? stored?.camera?.longitudeDeg ?? 0);
  const worldHours =
    typeof stored?.worldHours === 'number' && Number.isFinite(stored.worldHours)
      ? stored.worldHours
      : 79 * 24 + 12;

  return {
    lat,
    lon,
    pinName: urlPin ?? stored?.activePin?.name ?? null,
    markers: stored?.markers ?? [],
    worldHours,
    volcanicSky: stored?.volcanicSky ?? null,
  };
}

export const QWorldSkyPreview: React.FC = () => {
  const initialObs = useMemo(() => readInitialObserver(), []);
  const [config, setConfig] = useState<CelestialWorldConfig>(DEFAULT_CELESTIAL_CONFIG);
  const [worldHours, setWorldHours] = useState<number>(initialObs.worldHours);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speedHoursPerSec, setSpeedHoursPerSec] = useState<number>(1);
  const [eclipseAutoAction, setEclipseAutoAction] = useState<'off' | 'slow' | 'pause'>('slow');
  const handledEclipseStartRef = useRef<number | null>(null);
  const lastLocalEditRef = useRef<number>(Date.now());

  const [projectionMode, setProjectionMode] = useState<SkyProjectionMode>('ground');
  const [focusedView, setFocusedView] = useState<FocusedView>('none');
  const [hideFocusHud, setHideFocusHud] = useState<boolean>(false);
  const [showArcs, setShowArcs] = useState<boolean>(true);
  const [showConstellations, setShowConstellations] = useState<boolean>(true);
  const [showMythicArt, setShowMythicArt] = useState<boolean>(true);
  const [showBodyNames, setShowBodyNames] = useState<boolean>(true);
  const [showGlareWashout, setShowGlareWashout] = useState<boolean>(true);
  const [showVolcanoGlow, setShowVolcanoGlow] = useState<boolean>(false);
  const [arcsAlpha, setArcsAlpha] = useState<number>(1);
  const [constellationsAlpha, setConstellationsAlpha] = useState<number>(1);
  const [mythicArtAlpha, setMythicArtAlpha] = useState<number>(1);
  const [bodyNamesAlpha, setBodyNamesAlpha] = useState<number>(1);
  const showGalaxyCloud = true;
  const galaxyAlpha = 1;
  const showNebula = true;
  const nebulaAlpha = 1;
  const [showConfigDrawer, setShowConfigDrawer] = useState<boolean>(false);
  const [showPerfHud, setShowPerfHud] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [helpPageIndex, setHelpPageIndex] = useState<number>(0);
  const [showQuickSelect, setShowQuickSelect] = useState<boolean>(false);
  const [quickSelectFilter, setQuickSelectFilter] = useState<string>('');
  type PureMouseMode = 'none' | 'pan' | 'sphere';
  const [pureMouseMode, setPureMouseMode] = useState<PureMouseMode>('none');
  const [modeToast, setModeToast] = useState<string | null>(null);
  const modeToastTimeoutRef = useRef<number>(0);

  const triggerModeToast = (msg: string) => {
    setModeToast(msg);
    if (modeToastTimeoutRef.current) {
      window.clearTimeout(modeToastTimeoutRef.current);
    }
    modeToastTimeoutRef.current = window.setTimeout(() => {
      setModeToast(null);
    }, 1400);
  };

  const [selectedOmenModal, setSelectedOmenModal] = useState<{
    type: CelestialOmen['type'];
    title: string;
    event?: UpcomingOmenEvent;
  } | null>(null);
  const [perfStats, setPerfStats] = useState<PerfSnapshot>(() => skyPerfMonitor.getSnapshot());
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState<boolean>(false);

  // Observer location / pin state
  const [observerSource, setObserverSource] = useState<string>(initialObs.pinName ? 'active-pin' : 'map');
  const [syncedMarkers, setSyncedMarkers] = useState<SyncedPin[]>(initialObs.markers);
  const [syncedVolcanicSky, setSyncedVolcanicSky] = useState<SyncedVolcanicSky | null>(initialObs.volcanicSky);
  const [activePinName, setActivePinName] = useState<string | null>(initialObs.pinName);
  const [latitudeDeg, setLatitudeDeg] = useState<number>(initialObs.lat);
  const [longitudeDeg, setLongitudeDeg] = useState<number>(initialObs.lon);

  // Camera look angles & zoom FOV
  const [lookAzimuthDeg, setLookAzimuthDeg] = useState<number>(180);
  const [lookPitchDeg, setLookPitchDeg] = useState<number>(22);
  const [groundFovDeg, setGroundFovDeg] = useState<number>(70);
  const [surroundFovDeg, setSurroundFovDeg] = useState<number>(210);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointerCanvasRef = useRef<HTMLCanvasElement>(null);
  const domeCanvasRef = useRef<HTMLCanvasElement>(null);
  const orbitCanvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const stars = useMemo(() => buildConsistentStarCatalog(480), []);
  const dragLookRef = useRef<{ startX: number; startY: number; startAz: number; startPitch: number } | null>(null);
  const [viewportTick, setViewportTick] = useState(0);
  const [twinkleTick, setTwinkleTick] = useState(0);

  const projectionModeRef = useRef<SkyProjectionMode>(projectionMode);
  projectionModeRef.current = projectionMode;
  const pureMouseModeRef = useRef<PureMouseMode>(pureMouseMode);
  pureMouseModeRef.current = pureMouseMode;
  const isPureViewRef = useRef<boolean>(false);
  isPureViewRef.current = focusedView !== 'none' && hideFocusHud;

  const pointerStateRef = useRef<{ isDown: boolean; isHovering: boolean; x: number; y: number }>({
    isDown: false,
    isHovering: false,
    x: 0,
    y: 0,
  });
  const pointerTrailRef = useRef<{ x: number; y: number; time: number }[]>([]);
  const pointerRafRef = useRef<number>(0);
  const TRAIL_DURATION_MS = 2500;

  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const renderPointerLayer = () => {
    const canvas = pointerCanvasRef.current;
    if (!canvas) {
      pointerRafRef.current = 0;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 420;
    const targetW = Math.round(w * dpr);
    const targetH = Math.round(h * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      pointerRafRef.current = 0;
      return;
    }

    const now = performance.now();
    const trail = pointerTrailRef.current;
    while (trail.length > 0 && now - trail[0].time > TRAIL_DURATION_MS) {
      trail.shift();
    }

    const { isDown, isHovering, x, y } = pointerStateRef.current;
    const showHoverCrosshair = isPureViewRef.current && pureMouseModeRef.current === 'sphere' && !isDown && isHovering;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    if (trail.length === 0 && !isDown && !showHoverCrosshair) {
      ctx.restore();
      pointerRafRef.current = 0;
      return;
    }

    // 1. Draw trailing dimming light behind the pointer
    if (trail.length >= 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < trail.length - 1; i++) {
        const p1 = trail[i];
        const p2 = trail[i + 1];
        const age = now - (p1.time + p2.time) * 0.5;
        const norm = Math.max(0, 1 - age / TRAIL_DURATION_MS);
        if (norm <= 0.005) continue;
        const fade = Math.pow(norm, 1.35);

        // Pass 1: Diffuse soft starlight aura
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = 10 * fade + 2;
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.16 * fade})`;
        ctx.stroke();

        // Pass 2: Ethereal inner beam
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = 4 * fade + 1;
        ctx.strokeStyle = `rgba(186, 230, 253, ${0.45 * fade})`;
        ctx.stroke();

        // Pass 3: Radiant white filament
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = 1.2 * fade + 0.5;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * fade})`;
        ctx.stroke();
      }

      // Soft lingering light beads at each sampled point
      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i];
        const age = now - pt.time;
        const norm = Math.max(0, 1 - age / TRAIL_DURATION_MS);
        if (norm <= 0.01) continue;
        const fade = Math.pow(norm, 1.4);

        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 5 * fade + 2);
        grad.addColorStop(0, `rgba(255, 255, 255, ${0.5 * fade})`);
        grad.addColorStop(0.35, `rgba(56, 189, 248, ${0.25 * fade})`);
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5 * fade + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // 2. Draw glowing sphere + crosshair while mouse button is held down
    if (isDown) {
      ctx.save();

      // Outer broad radiant halo
      const corona = ctx.createRadialGradient(x, y, 0, x, y, 18);
      corona.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      corona.addColorStop(0.2, 'rgba(186, 230, 253, 0.65)');
      corona.addColorStop(0.5, 'rgba(56, 189, 248, 0.28)');
      corona.addColorStop(1, 'rgba(14, 165, 233, 0)');
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();

      // Small glowing sphere a few px wide
      const sphereGrad = ctx.createRadialGradient(x, y, 0, x, y, 3.5);
      sphereGrad.addColorStop(0, '#ffffff');
      sphereGrad.addColorStop(0.7, '#bae6fd');
      sphereGrad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = sphereGrad;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 0.75;
      ctx.stroke();

      // Delicate precision crosshair ticks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y - 11);
      ctx.moveTo(x, y + 5);
      ctx.lineTo(x, y + 11);
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x - 11, y);
      ctx.moveTo(x + 5, y);
      ctx.lineTo(x + 11, y);
      ctx.stroke();

      ctx.restore();
    } else if (showHoverCrosshair) {
      ctx.save();
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.78)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 2.5);
      ctx.lineTo(x, y - 7.5);
      ctx.moveTo(x, y + 2.5);
      ctx.lineTo(x, y + 7.5);
      ctx.moveTo(x - 2.5, y);
      ctx.lineTo(x - 7.5, y);
      ctx.moveTo(x + 2.5, y);
      ctx.lineTo(x + 7.5, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(224, 242, 254, 0.85)';
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.restore();
    }

    ctx.restore();
    if (trail.length > 0 || isDown) {
      pointerRafRef.current = requestAnimationFrame(renderPointerLayer);
    } else {
      pointerRafRef.current = 0;
    }
  };

  const schedulePointerTick = () => {
    if (pointerRafRef.current) return;
    pointerRafRef.current = requestAnimationFrame(renderPointerLayer);
  };

  const startPointer = (x: number, y: number) => {
    pointerStateRef.current = { isDown: true, isHovering: true, x, y };
    pointerTrailRef.current.push({ x, y, time: performance.now() });
    schedulePointerTick();
  };

  const hoverPointer = (x: number, y: number) => {
    pointerStateRef.current.x = x;
    pointerStateRef.current.y = y;
    pointerStateRef.current.isHovering = true;
    schedulePointerTick();
  };

  const movePointer = (x: number, y: number) => {
    pointerStateRef.current.x = x;
    pointerStateRef.current.y = y;
    const trail = pointerTrailRef.current;
    const now = performance.now();
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) >= 2 || now - last.time > 20) {
      trail.push({ x, y, time: now });
    }
    schedulePointerTick();
  };

  const endPointer = () => {
    pointerStateRef.current.isDown = false;
    schedulePointerTick();
  };

  useEffect(() => {
    if (!hideFocusHud) {
      pointerStateRef.current.isDown = false;
      pointerStateRef.current.isHovering = false;
      pointerTrailRef.current = [];
      if (pointerRafRef.current) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = 0;
      }
      const canvas = pointerCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [hideFocusHud]);

  useEffect(() => {
    if (pureMouseMode !== 'sphere' && pointerStateRef.current.isDown) {
      endPointer();
    }
    if (pureMouseMode !== 'pan') {
      dragLookRef.current = null;
    }
    schedulePointerTick();
  }, [pureMouseMode]);

  useEffect(() => {
    return () => {
      if (pointerRafRef.current) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = 0;
      }
    };
  }, []);

  // Mouse-wheel zoom inside the sky preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = e.deltaY * 0.08;
      if (projectionMode === 'ground') {
        setGroundFovDeg((f) => Math.max(20, Math.min(115, f + step)));
      } else {
        setSurroundFovDeg((f) => Math.max(90, Math.min(310, f + step * 1.8)));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [projectionMode, focusedView]);

  // Smooth fade in/out for Overlays (Constellations, Mythic Art, Arcs, Body Names)
  useEffect(() => {
    const targetC = showConstellations ? 1 : 0;
    const targetM = showMythicArt ? 1 : 0;
    const targetA = showArcs ? 1 : 0;
    const targetN = showBodyNames ? 1 : 0;
    if (
      Math.abs(constellationsAlpha - targetC) < 0.001 &&
      Math.abs(mythicArtAlpha - targetM) < 0.001 &&
      Math.abs(arcsAlpha - targetA) < 0.001 &&
      Math.abs(bodyNamesAlpha - targetN) < 0.001
    ) {
      return;
    }

    let last = performance.now();
    let raf = 0;
    const FADE_DURATION_SEC = 15;
    const stepToward = (cur: number, target: number, delta: number) => {
      if (Math.abs(cur - target) <= delta) return target;
      return cur < target ? cur + delta : cur - delta;
    };

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, (now - last) / 1000);
      last = now;
      const step = dtSec / FADE_DURATION_SEC;

      setConstellationsAlpha((c) => stepToward(c, targetC, step));
      setMythicArtAlpha((m) => stepToward(m, targetM, step));
      setArcsAlpha((a) => stepToward(a, targetA, step));
      setBodyNamesAlpha((n) => stepToward(n, targetN, step));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    showConstellations,
    showMythicArt,
    showArcs,
    showBodyNames,
    constellationsAlpha,
    mythicArtAlpha,
    arcsAlpha,
    bodyNamesAlpha,
  ]);

  const latestSimRef = useRef({ worldHours, latitudeDeg, longitudeDeg, config });
  latestSimRef.current = { worldHours, latitudeDeg, longitudeDeg, config };

  const worldHoursRef = useRef<number>(worldHours);
  worldHoursRef.current = worldHours;
  const playingRef = useRef<boolean>(playing);
  playingRef.current = playing;
  const observerSourceRef = useRef<string>(observerSource);
  observerSourceRef.current = observerSource;
  const lastBroadcastTimeRef = useRef<number>(0);
  const lastStorageSyncRef = useRef<number>(0);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const broadcastSkyTime = (nextHours: number, minIntervalMs = 0) => {
    const now = Date.now();
    if (minIntervalMs > 0 && now - lastBroadcastTimeRef.current < minIntervalMs) {
      return;
    }
    lastBroadcastTimeRef.current = now;
    const msg = {
      type: 'time-sync' as const,
      source: 'sky' as const,
      worldHours: nextHours,
      updatedAt: now,
    };
    try {
      broadcastChannelRef.current?.postMessage(msg);
    } catch (err: unknown) {
      console.warn('[QWorldSkyPreview] Broadcast postMessage failed:', err);
    }
    if (minIntervalMs === 0 || now - lastStorageSyncRef.current >= 1000) {
      lastStorageSyncRef.current = now;
      try {
        const raw = localStorage.getItem('adventure2_sky_sync_state');
        const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        localStorage.setItem('adventure2_sky_sync_state', JSON.stringify({ ...prev, ...msg }));
      } catch (err: unknown) {
        console.warn('[QWorldSkyPreview] localStorage sync write failed:', err);
      }
    }
  };

  const applyManualWorldHours = (nextOrUpdater: number | ((prev: number) => number)) => {
    const rawNext =
      typeof nextOrUpdater === 'function' ? nextOrUpdater(worldHoursRef.current) : nextOrUpdater;
    const nextH = Math.max(0, rawNext);
    lastLocalEditRef.current = Date.now();
    worldHoursRef.current = nextH;
    latestSimRef.current.worldHours = nextH;
    setWorldHours(nextH);
    broadcastSkyTime(nextH, 0);
  };

  const applyManualWorldHoursRef = useRef(applyManualWorldHours);
  applyManualWorldHoursRef.current = applyManualWorldHours;
  const broadcastSkyTimeRef = useRef(broadcastSkyTime);
  broadcastSkyTimeRef.current = broadcastSkyTime;

  const jumpToAdjacentEclipse = (direction: 1 | -1) => {
    const s = latestSimRef.current;
    const ev: EclipseProjection | null = findAdjacentEclipse(
      s.worldHours,
      direction,
      s.latitudeDeg,
      s.longitudeDeg,
      s.config
    );
    if (ev) {
      handledEclipseStartRef.current = ev.startWorldHours;
      setPlaying(false);
      applyManualWorldHours(ev.worldHours);
    }
  };

  // Keyboard shortcuts: Esc (exit focus), Space (play/pause), O (hide HUD/cursor in focus), 6/7/8/9 (toggles), +/- (speed), ///* (-1d / +1d), Alt+Left/Right (prev/next eclipse)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setShowHelpModal((v) => !v);
        return;
      }

      if (e.key === 'Escape' && showQuickSelect) {
        setShowQuickSelect(false);
      } else if (e.key === 'Escape' && showHelpModal) {
        setShowHelpModal(false);
      } else if (e.key === 'Escape' && selectedOmenModal) {
        setSelectedOmenModal(null);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        jumpToAdjacentEclipse(-1);
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        jumpToAdjacentEclipse(1);
      } else if (!e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const stepAz = e.shiftKey ? 8 : 2.5;
        const stepPitch = e.shiftKey ? 6 : 2;
        if (e.key === 'ArrowLeft') {
          setLookAzimuthDeg((az) => (((az - stepAz) % 360) + 360) % 360);
        } else if (e.key === 'ArrowRight') {
          setLookAzimuthDeg((az) => (((az + stepAz) % 360) + 360) % 360);
        } else if (e.key === 'ArrowUp') {
          if (projectionModeRef.current === 'ground') {
            setLookPitchDeg((p) => Math.max(-85, Math.min(88, p + stepPitch)));
          }
        } else if (e.key === 'ArrowDown') {
          if (projectionModeRef.current === 'ground') {
            setLookPitchDeg((p) => Math.max(-85, Math.min(88, p - stepPitch)));
          }
        }
      } else if (e.key === 'Escape' && (focusedView !== 'none' || hideFocusHud)) {
        if (hideFocusHud) {
          setHideFocusHud(false);
        } else {
          setFocusedView('none');
        }
      } else if (e.key === 'y' || e.key === 'Y' || e.code === 'KeyY') {
        e.preventDefault();
        setShowQuickSelect((v) => !v);
      } else if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'o' || e.key === 'O' || e.code === 'KeyO') {
        if (focusedView !== 'none') {
          setHideFocusHud((v) => !v);
        } else {
          setFocusedView('preview');
          setHideFocusHud(true);
        }
      } else if (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') {
        setPureMouseMode((cur) => {
          const next = cur === 'pan' ? 'none' : 'pan';
          triggerModeToast(next === 'pan' ? '🖱️ Mouse Mode: Pan' : '🔒 Mouse Mode: None (Locked)');
          return next;
        });
      } else if (e.key === 'i' || e.key === 'I' || e.code === 'KeyI') {
        setPureMouseMode((cur) => {
          const next = cur === 'sphere' ? 'none' : 'sphere';
          triggerModeToast(next === 'sphere' ? '✨ Mouse Mode: Pointer Sphere' : '🔒 Mouse Mode: None (Locked)');
          return next;
        });
      } else if (e.key === '0') {
        setShowGlareWashout((v) => !v);
      } else if (e.key === 'v' || e.key === 'V' || e.code === 'KeyV') {
        setShowVolcanoGlow((v) => {
          const next = !v;
          triggerModeToast(next ? '🌋 Volcanic Eruption Glow: ON' : '🌋 Volcanic Eruption Glow: OFF');
          return next;
        });
      } else if (e.key === '1') {
        setProjectionMode('ground');
      } else if (e.key === '2') {
        setProjectionMode('surround');
      } else if (e.key === '3') {
        setFocusedView((cur) => (cur === 'none' ? 'preview' : cur === 'preview' ? 'dome' : cur === 'dome' ? 'orbit' : 'none'));
      } else if (e.key === '6') {
        setShowBodyNames((v) => !v);
      } else if (e.key === '7') {
        setShowConstellations((v) => !v);
      } else if (e.key === '8') {
        setShowMythicArt((v) => !v);
      } else if (e.key === '9') {
        setShowArcs((v) => !v);
      } else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        setSpeedHoursPerSec((cur) => {
          const idx = SPEED_OPTIONS.findIndex((o) => o.hoursPerSec >= cur - 1e-9);
          const nextIdx = idx === -1 ? SPEED_OPTIONS.length - 1 : Math.min(SPEED_OPTIONS.length - 1, idx + 1);
          return SPEED_OPTIONS[nextIdx].hoursPerSec;
        });
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        setSpeedHoursPerSec((cur) => {
          const idx = SPEED_OPTIONS.findIndex((o) => o.hoursPerSec >= cur - 1e-9);
          const prevIdx = idx === -1 ? SPEED_OPTIONS.length - 1 : Math.max(0, idx - 1);
          return SPEED_OPTIONS[prevIdx].hoursPerSec;
        });
      } else if (e.key === '/' || e.code === 'NumpadDivide') {
        e.preventDefault();
        applyManualWorldHoursRef.current((h) => Math.max(0, h - latestSimRef.current.config.hoursPerDay));
      } else if (e.key === '*' || e.code === 'NumpadMultiply') {
        e.preventDefault();
        applyManualWorldHoursRef.current((h) => h + latestSimRef.current.config.hoursPerDay);
      } else if (e.key === '[' || e.code === 'BracketLeft') {
        e.preventDefault();
        const yearHours = latestSimRef.current.config.daysPerYear * latestSimRef.current.config.hoursPerDay;
        applyManualWorldHoursRef.current((h) => Math.max(0, h - yearHours));
        triggerModeToast('📅 -1 Year');
      } else if (e.key === ']' || e.code === 'BracketRight') {
        e.preventDefault();
        const yearHours = latestSimRef.current.config.daysPerYear * latestSimRef.current.config.hoursPerDay;
        applyManualWorldHoursRef.current((h) => h + yearHours);
        triggerModeToast('📅 +1 Year');
      }
    };
    const onFsChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
      setViewportTick((t) => t + 1);
    };
    const onResize = () => setViewportTick((t) => t + 1);

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('resize', onResize);
    };
  }, [focusedView, hideFocusHud, selectedOmenModal, showHelpModal, showQuickSelect]);

  // Persistent BroadcastChannel & storage listener for map center, pin, volcanic ash & time sync
  useEffect(() => {
    window.name = 'adventure2_sky_preview';

    const applySync = (payload: SkySyncPayload | null | undefined) => {
      if (!payload || payload.source === 'sky') return;
      const isTimeMsg =
        payload.type === 'time-sync' ||
        (payload.type !== 'map-state' && (payload.source === 'map' || payload.source === 'calendar'));
      if (isTimeMsg && typeof payload.worldHours === 'number' && Number.isFinite(payload.worldHours)) {
        const nextHours = payload.worldHours;
        worldHoursRef.current = nextHours;
        setWorldHours(nextHours);
        if (document.hidden && playingRef.current) {
          setPlaying(false);
        }
      }
      if (payload.markers) setSyncedMarkers(payload.markers);
      if (payload.volcanicSky !== undefined) setSyncedVolcanicSky(payload.volcanicSky);
      const curObserver = observerSourceRef.current;
      if (curObserver === 'map' && payload.camera) {
        setLatitudeDeg(payload.camera.latitudeDeg);
        setLongitudeDeg(payload.camera.longitudeDeg);
        setActivePinName(null);
      } else if (curObserver === 'active-pin' && payload.activePin) {
        setLatitudeDeg(payload.activePin.latitudeDeg);
        setLongitudeDeg(payload.activePin.longitudeDeg);
        setActivePinName(payload.activePin.name);
      } else if (curObserver.startsWith('marker:') && payload.markers) {
        const id = curObserver.slice(7);
        const found = payload.markers.find((m) => m.id === id);
        if (found) {
          setLatitudeDeg(found.latitudeDeg);
          setLongitudeDeg(found.longitudeDeg);
          setActivePinName(found.name);
        }
      }
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('adventure2_sky_sync');
      broadcastChannelRef.current = channel;
      channel.onmessage = (ev: MessageEvent<SkySyncPayload>) => applySync(ev.data);
    } catch (err: unknown) {
      console.warn('[QWorldSkyPreview] BroadcastChannel unavailable:', err);
    }

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'adventure2_sky_sync_state' && ev.newValue) {
        try {
          applySync(JSON.parse(ev.newValue) as SkySyncPayload);
        } catch (err: unknown) {
          console.warn('[QWorldSkyPreview] Storage sync JSON parse warning:', err);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      broadcastChannelRef.current = null;
      channel?.close();
    };
  }, []);

  // Cache next eclipse across frames so playback does not re-scan every 6 simulated hours
  const nextEclipseCacheRef = useRef<{
    lat: number;
    lon: number;
    config: CelestialWorldConfig;
    searchedFrom: number;
    result: EclipseProjection | null;
  } | null>(null);

  const nextEclipse = useMemo(() => {
    const cache = nextEclipseCacheRef.current;
    if (
      cache &&
      cache.lat === latitudeDeg &&
      cache.lon === longitudeDeg &&
      cache.config === config &&
      worldHours >= cache.searchedFrom &&
      (cache.result === null || worldHours <= cache.result.endWorldHours)
    ) {
      return cache.result;
    }
    const found = findAdjacentEclipse(worldHours, 1, latitudeDeg, longitudeDeg, config);
    nextEclipseCacheRef.current = {
      lat: latitudeDeg,
      lon: longitudeDeg,
      config,
      searchedFrom: worldHours,
      result: found,
    };
    return found;
  }, [worldHours, latitudeDeg, longitudeDeg, config]);

  const nextEclipseRef = useRef<EclipseProjection | null>(null);
  nextEclipseRef.current = nextEclipse;

  // Start long-task / GC observer once and refresh Perf HUD when toggled open
  useEffect(() => {
    skyPerfMonitor.startLongTaskObserver();
  }, []);

  useEffect(() => {
    if (!showPerfHud) return;
    setPerfStats(skyPerfMonitor.getSnapshot());
    const id = window.setInterval(() => {
      setPerfStats(skyPerfMonitor.getSnapshot());
    }, 500);
    return () => window.clearInterval(id);
  }, [showPerfHud]);

  // Timelapse animation loop (with optional auto slow-down or pause on eclipse)
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const rawDtMs = now - last;
      last = now;
      skyPerfMonitor.recordFrame(rawDtMs);
      const dtSec = Math.min(0.1, rawDtMs / 1000);
      const curH = worldHoursRef.current;
      let nextH = Math.max(0, curH + dtSec * speedHoursPerSec);
      const ec = nextEclipseRef.current;
      if (
        ec &&
        eclipseAutoAction !== 'off' &&
        handledEclipseStartRef.current !== ec.startWorldHours &&
        curH < ec.startWorldHours &&
        nextH >= ec.startWorldHours
      ) {
        handledEclipseStartRef.current = ec.startWorldHours;
        if (eclipseAutoAction === 'pause') {
          nextH = ec.worldHours;
          setPlaying(false);
        } else {
          nextH = ec.startWorldHours;
          setSpeedHoursPerSec(0.25);
        }
      }
      worldHoursRef.current = nextH;
      setWorldHours(nextH);
      if (!document.hidden) {
        broadcastSkyTimeRef.current(nextH, 250);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speedHoursPerSec, eclipseAutoAction]);

  const twinkleStrength =
    speedHoursPerSec <= 1 / 1800 ? 1 : speedHoursPerSec <= 1 / 60 ? 0.45 : 0;

  // Ambient twinkling loop at 1 s/s (and subtly at 1 m/s) even before pressing Play
  useEffect(() => {
    if (twinkleStrength <= 0 || playing) return;
    const id = window.setInterval(() => {
      if (!document.hidden) {
        setTwinkleTick((t) => (t + 1) % 100000);
      }
    }, 45);
    return () => window.clearInterval(id);
  }, [twinkleStrength, playing]);

  const snapshot: CelestialSnapshot = useMemo(() => {
    const t0 = performance.now();
    const snap = computeCelestialSnapshot(worldHours, latitudeDeg, longitudeDeg, config, true);
    skyPerfMonitor.recordPhase('snapshot', performance.now() - t0);
    return snap;
  }, [worldHours, latitudeDeg, longitudeDeg, config]);

  const dayIndex = Math.floor(worldHours / config.hoursPerDay);
  const omenAnchorRef = useRef<{
    dayIndex: number;
    lat: number;
    lon: number;
    config: CelestialWorldConfig;
    omens: UpcomingOmenEvent[];
  } | null>(null);
  const upcomingOmens = useMemo(() => {
    const anchor = omenAnchorRef.current;
    if (
      playing &&
      anchor &&
      anchor.lat === latitudeDeg &&
      anchor.lon === longitudeDeg &&
      anchor.config === config &&
      Math.abs(dayIndex - anchor.dayIndex) < 30
    ) {
      return anchor.omens;
    }
    const t0 = performance.now();
    const res = scanUpcomingOmens(dayIndex * config.hoursPerDay, latitudeDeg, longitudeDeg, config, 130);
    skyPerfMonitor.recordPhase('omen', performance.now() - t0);
    omenAnchorRef.current = { dayIndex, lat: latitudeDeg, lon: longitudeDeg, config, omens: res };
    return res;
  }, [dayIndex, latitudeDeg, longitudeDeg, config, playing]);
  const dailyArcs = useMemo(() => {
    if (arcsAlpha <= 0.005) return null;
    return {
      sun: computeDailySkyArc(dayIndex * config.hoursPerDay, latitudeDeg, longitudeDeg, config, 'sun'),
      primary: computeDailySkyArc(dayIndex * config.hoursPerDay, latitudeDeg, longitudeDeg, config, 'primary'),
      black: config.blackMoon.enabled
        ? computeDailySkyArc(dayIndex * config.hoursPerDay, latitudeDeg, longitudeDeg, config, 'black')
        : [],
    };
  }, [arcsAlpha > 0.005, dayIndex, latitudeDeg, longitudeDeg, config]);

  // Render Sky Preview Canvas (Ground Character View OR Surround 210° View)
  useEffect(() => {
    if (focusedView !== 'none' && focusedView !== 'preview') return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 420;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderT0 = performance.now();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pureView = focusedView !== 'none' && hideFocusHud;
    const volcanicSample = showVolcanoGlow
      ? sampleSyncedVolcanicSky(syncedVolcanicSky, latitudeDeg, longitudeDeg)
      : undefined;
    const twinkleTimeSec = performance.now() * 0.001;

    if (projectionMode === 'ground') {
      renderGroundCharacterView(
        ctx,
        width,
        height,
        snapshot,
        config,
        stars,
        dailyArcs,
        lookAzimuthDeg,
        lookPitchDeg,
        groundFovDeg,
        constellationsAlpha,
        mythicArtAlpha,
        arcsAlpha,
        bodyNamesAlpha,
        !pureView,
        showGlareWashout,
        galaxyAlpha,
        nebulaAlpha,
        volcanicSample,
        twinkleTimeSec,
        twinkleStrength
      );
    } else {
      renderSurroundPanoramaView(
        ctx,
        width,
        height,
        snapshot,
        config,
        stars,
        dailyArcs,
        lookAzimuthDeg,
        surroundFovDeg,
        constellationsAlpha,
        mythicArtAlpha,
        arcsAlpha,
        bodyNamesAlpha,
        !pureView,
        showGlareWashout,
        galaxyAlpha,
        nebulaAlpha,
        volcanicSample,
        twinkleTimeSec,
        twinkleStrength
      );
    }
    ctx.restore();
    skyPerfMonitor.recordPhase('render', performance.now() - renderT0);
  }, [
    snapshot,
    config,
    stars,
    dailyArcs,
    projectionMode,
    lookAzimuthDeg,
    lookPitchDeg,
    groundFovDeg,
    surroundFovDeg,
    constellationsAlpha,
    mythicArtAlpha,
    arcsAlpha,
    bodyNamesAlpha,
    galaxyAlpha,
    nebulaAlpha,
    focusedView,
    hideFocusHud,
    showGlareWashout,
    viewportTick,
    syncedVolcanicSky,
    showVolcanoGlow,
    latitudeDeg,
    longitudeDeg,
    twinkleStrength,
    twinkleTick,
  ]);

  // Render Zenith Dome Canvas
  useEffect(() => {
    if (focusedView !== 'none' && focusedView !== 'dome') return;
    const canvas = domeCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 240;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderT0 = performance.now();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const volcanicSample = showVolcanoGlow
      ? sampleSyncedVolcanicSky(syncedVolcanicSky, latitudeDeg, longitudeDeg)
      : undefined;
    const twinkleTimeSec = performance.now() * 0.001;
    renderZenithDome(
      ctx,
      width,
      height,
      snapshot,
      config,
      stars,
      dailyArcs,
      constellationsAlpha,
      mythicArtAlpha,
      arcsAlpha,
      bodyNamesAlpha,
      galaxyAlpha,
      nebulaAlpha,
      volcanicSample,
      twinkleTimeSec,
      twinkleStrength
    );
    ctx.restore();
    skyPerfMonitor.recordPhase('render', performance.now() - renderT0);
  }, [
    snapshot,
    config,
    stars,
    dailyArcs,
    constellationsAlpha,
    mythicArtAlpha,
    arcsAlpha,
    bodyNamesAlpha,
    galaxyAlpha,
    nebulaAlpha,
    focusedView,
    viewportTick,
    syncedVolcanicSky,
    showVolcanoGlow,
    latitudeDeg,
    longitudeDeg,
    twinkleStrength,
    twinkleTick,
  ]);

  // Render Top-Down Orbital Plane Canvas
  useEffect(() => {
    if (focusedView !== 'none' && focusedView !== 'orbit') return;
    const canvas = orbitCanvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 240;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderT0 = performance.now();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    renderOrbitalPlane(
      ctx,
      width,
      height,
      snapshot,
      config,
      bodyNamesAlpha,
      showGalaxyCloud,
      showNebula,
      lookAzimuthDeg
    );
    ctx.restore();
    skyPerfMonitor.recordPhase('render', performance.now() - renderT0);
  }, [snapshot, config, bodyNamesAlpha, showGalaxyCloud, showNebula, lookAzimuthDeg, focusedView, viewportTick]);

  const setDayAndHour = (newDayOfYear: number, newYear: number, newLocalHour: number) => {
    const clampedDay = Math.max(1, Math.min(config.daysPerYear, newDayOfYear));
    const clampedYear = Math.max(1, newYear);
    const totalDays = (clampedYear - 1) * config.daysPerYear + (clampedDay - 1);
    applyManualWorldHours(totalDays * config.hoursPerDay + newLocalHour);
  };

  const toggleBrowserFullscreen = () => {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen?.().catch((err: unknown) => {
        console.warn('[QWorldSkyPreview] Fullscreen request failed:', err);
      });
    } else {
      document.exitFullscreen?.().catch((err: unknown) => {
        console.warn('[QWorldSkyPreview] Exit fullscreen failed:', err);
      });
    }
  };

  const handleObserverSelect = (val: string) => {
    setObserverSource(val);
    if (val === 'manual') {
      setActivePinName(null);
      return;
    }
    if (val.startsWith('marker:')) {
      const id = val.slice(7);
      const found = syncedMarkers.find((m) => m.id === id);
      if (found) {
        setLatitudeDeg(found.latitudeDeg);
        setLongitudeDeg(found.longitudeDeg);
        setActivePinName(found.name);
      }
      return;
    }
    // Refresh immediately from localStorage for 'map' or 'active-pin'
    try {
      const raw = localStorage.getItem('adventure2_sky_sync_state');
      if (raw) {
        const stored = JSON.parse(raw) as SkySyncPayload;
        if (val === 'active-pin' && stored.activePin) {
          setLatitudeDeg(stored.activePin.latitudeDeg);
          setLongitudeDeg(stored.activePin.longitudeDeg);
          setActivePinName(stored.activePin.name);
        } else if (stored.camera) {
          setLatitudeDeg(stored.camera.latitudeDeg);
          setLongitudeDeg(stored.camera.longitudeDeg);
          setActivePinName(null);
        }
      }
    } catch (err: unknown) {
      console.warn('[QWorldSkyPreview] Observer storage read failed:', err);
    }
  };

  const showPreview = focusedView === 'none' || focusedView === 'preview';
  const showDome = focusedView === 'none' || focusedView === 'dome';
  const showOrbit = focusedView === 'none' || focusedView === 'orbit';
  const isFocused = focusedView !== 'none';

  const handleResetPerfSpikes = () => {
    skyPerfMonitor.resetSpikes();
    setPerfStats(skyPerfMonitor.getSnapshot());
  };

  const toolbarState: SkyToolbarState = {
    projectionMode,
    focusedView,
    showBodyNames,
    showConstellations,
    showMythicArt,
    showArcs,
    showGlareWashout,
    showVolcanoGlow,
    showQuickSelect,
    hideFocusHud,
    showConfigDrawer,
    showPerfHud,
    showHelpModal,
    isBrowserFullscreen,
  };

  const toolbarActions: SkyToolbarActions = {
    setProjectionMode,
    cycleFocusedView: () => {
      setFocusedView((cur) => (cur === 'none' ? 'preview' : cur === 'preview' ? 'dome' : cur === 'dome' ? 'orbit' : 'none'));
      setHideFocusHud(false);
    },
    toggleBodyNames: () => setShowBodyNames((v) => !v),
    toggleConstellations: () => setShowConstellations((v) => !v),
    toggleMythicArt: () => setShowMythicArt((v) => !v),
    toggleArcs: () => setShowArcs((v) => !v),
    toggleWashout: () => setShowGlareWashout((v) => !v),
    toggleVolcanoGlow: () =>
      setShowVolcanoGlow((v) => {
        const next = !v;
        triggerModeToast(next ? '🌋 Volcanic Eruption Glow: ON' : '🌋 Volcanic Eruption Glow: OFF');
        return next;
      }),
    toggleQuickSelect: () => setShowQuickSelect((v) => !v),
    togglePureView: () => {
      if (focusedView === 'none') {
        setFocusedView('preview');
        setHideFocusHud(true);
        triggerModeToast('Pure View (UI Hidden) — Press O or Esc to restore UI • P: pan • I: pointer sphere');
      } else {
        setHideFocusHud((prev) => {
          const next = !prev;
          triggerModeToast(next ? 'Pure View (UI Hidden) — Press O or Esc to restore UI' : 'UI Restored');
          return next;
        });
      }
    },
    toggleOrbits: () => {
      if (isFocused) {
        setFocusedView('none');
        setHideFocusHud(false);
        setShowConfigDrawer(true);
      } else {
        setShowConfigDrawer((v) => !v);
      }
    },
    togglePerfHud: () => setShowPerfHud((v) => !v),
    openCalendar: () => window.open('/?view=calendar', 'adventure2_calendar'),
    toggleHelpModal: () => setShowHelpModal((v) => !v),
    toggleBrowserFullscreen,
  };
  const volcanicHudSample = useMemo(
    () => sampleSyncedVolcanicSky(syncedVolcanicSky, latitudeDeg, longitudeDeg),
    [syncedVolcanicSky, latitudeDeg, longitudeDeg]
  );

  return (
    <div
      ref={rootRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#020617',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: isFocused && hideFocusHud ? 'none' : 'default',
      }}
    >
      {/* Top Header Bar (hidden when a single view is zoomed to fullscreen) */}
      {!isFocused && (
        <header
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '7px 14px',
            background: '#0f172a',
            borderBottom: '1px solid #1e293b',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                🌙 Celestial Sky — {config.worldName}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: getLightBadgeBg(snapshot.lighting.level),
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  color: '#f8fafc',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {snapshot.lighting.level}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
              {renderViewProjectionButtons(toolbarState, toolbarActions, true, 'header')}
              {renderOverlayIconButtons(toolbarState, toolbarActions, 'header')}
              {renderToolIconButtons(toolbarState, toolbarActions, 'header')}
            </div>
          </div>

          {/* Dedicated fixed-height Omen Status Row (prevents layout jump when omens appear/disappear) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              minHeight: '22px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Active Omens:
            </span>
            {snapshot.activeOmens.length === 0 ? (
              <span style={{ fontSize: '11px', color: '#475569' }}>None right now</span>
            ) : (
              snapshot.activeOmens.map((omen) => (
                <button
                  key={omen.type}
                  onClick={() => setSelectedOmenModal({ type: omen.type, title: omen.title })}
                  title={`${omen.description} (Click for GM & Player details)`}
                  style={{
                    fontSize: '11px',
                    padding: '1px 8px',
                    borderRadius: '999px',
                    background: omen.severity === 'omen' ? 'rgba(127, 29, 29, 0.85)' : 'rgba(30, 58, 138, 0.75)',
                    border: `1px solid ${omen.severity === 'omen' ? '#f87171' : '#60a5fa'}`,
                    color: '#fef2f2',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {omen.severity === 'omen' ? '👁️ ' : '✨ '}
                  {omen.title}
                </button>
              ))
            )}
          </div>

          {showPerfHud && renderPerfHudPanel(perfStats, handleResetPerfSpikes)}
        </header>
      )}

      {/* Main Views Grid (scales to fill available screen; or single view fills 100% when focused) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isFocused ? '1fr' : 'minmax(0, 1.85fr) minmax(300px, 1fr)',
          gridTemplateRows: isFocused ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: isFocused ? '0px' : '10px',
          padding: isFocused ? '0px' : '10px 12px 6px 12px',
        }}
      >
        {/* 1. Sky Preview (Ground / Surround) */}
        {showPreview && (
          <div
            style={{
              gridColumn: isFocused ? '1' : '1',
              gridRow: isFocused ? '1' : '1 / span 2',
              position: 'relative',
              borderRadius: isFocused ? '0px' : '8px',
              overflow: 'hidden',
              border: isFocused ? 'none' : '1px solid #1e293b',
              background: '#020617',
              minHeight: 0,
            }}
          >
            <canvas
              ref={previewCanvasRef}
              onContextMenu={(e) => {
                const isPureView = isFocused && hideFocusHud;
                if (isPureView) e.preventDefault();
              }}
              onPointerDown={(e) => {
                const isPureView = isFocused && hideFocusHud;
                if (isPureView) {
                  if (pureMouseMode === 'sphere' && e.button === 0) {
                    const pos = getCanvasPos(e.clientX, e.clientY);
                    startPointer(pos.x, pos.y);
                    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                    return;
                  } else if (pureMouseMode === 'pan') {
                    dragLookRef.current = {
                      startX: e.clientX,
                      startY: e.clientY,
                      startAz: lookAzimuthDeg,
                      startPitch: lookPitchDeg,
                    };
                    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
                    return;
                  }
                  // In 'none' mode: locked view (do not pan or show pointer)
                  return;
                }
                dragLookRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  startAz: lookAzimuthDeg,
                  startPitch: lookPitchDeg,
                };
                (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const pos = getCanvasPos(e.clientX, e.clientY);
                pointerStateRef.current.x = pos.x;
                pointerStateRef.current.y = pos.y;
                pointerStateRef.current.isHovering = true;
                const isPureView = isFocused && hideFocusHud;
                if (isPureView) {
                  if (pureMouseMode === 'sphere') {
                    if (pointerStateRef.current.isDown) {
                      movePointer(pos.x, pos.y);
                    } else {
                      hoverPointer(pos.x, pos.y);
                    }
                    return;
                  } else if (pureMouseMode === 'pan' && dragLookRef.current) {
                    const dx = e.clientX - dragLookRef.current.startX;
                    const dy = e.clientY - dragLookRef.current.startY;
                    const nextAz = (((dragLookRef.current.startAz - dx * 0.28) % 360) + 360) % 360;
                    setLookAzimuthDeg(nextAz);
                    if (projectionMode === 'ground') {
                      const nextPitch = Math.max(-85, Math.min(88, dragLookRef.current.startPitch + dy * 0.22));
                      setLookPitchDeg(nextPitch);
                    }
                    return;
                  }
                  return;
                }
                if (!dragLookRef.current) return;
                const dx = e.clientX - dragLookRef.current.startX;
                const dy = e.clientY - dragLookRef.current.startY;
                const nextAz = (((dragLookRef.current.startAz - dx * 0.28) % 360) + 360) % 360;
                setLookAzimuthDeg(nextAz);
                if (projectionMode === 'ground') {
                  const nextPitch = Math.max(-85, Math.min(88, dragLookRef.current.startPitch + dy * 0.22));
                  setLookPitchDeg(nextPitch);
                }
              }}
              onPointerLeave={() => {
                pointerStateRef.current.isHovering = false;
                schedulePointerTick();
              }}
              onPointerUp={(e) => {
                if (pointerStateRef.current.isDown) {
                  endPointer();
                }
                dragLookRef.current = null;
                try {
                  (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
                } catch {
                  // Ignore if capture was already released
                }
              }}
              onPointerCancel={(e) => {
                if (pointerStateRef.current.isDown) {
                  endPointer();
                }
                dragLookRef.current = null;
                try {
                  (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
                } catch {
                  // Ignore if capture was already released
                }
              }}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                cursor: isFocused && hideFocusHud ? 'none' : 'grab',
              }}
            />
            <canvas
              ref={pointerCanvasRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            />
            {modeToast && isFocused && hideFocusHud && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(2, 6, 23, 0.88)',
                  border: '1px solid rgba(56, 189, 248, 0.5)',
                  color: '#e0f2fe',
                  padding: '5px 16px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 600,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.7)',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  zIndex: 20,
                }}
              >
                {modeToast}
              </div>
            )}

            {/* Top-Left Clock, Date & Observer Badge */}
            {!(isFocused && hideFocusHud) && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  background: 'rgba(2, 6, 23, 0.76)',
                  border: '1px solid rgba(51, 65, 85, 0.8)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  pointerEvents: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                    {formatClockHour(snapshot.localHour, config.hoursPerDay)}
                  </span>
                  <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                    {snapshot.dayOfMonth} {snapshot.monthName}, Year {snapshot.year}{' '}
                    <span style={{ color: '#94a3b8' }}>
                      (Day {snapshot.dayOfYear} • {snapshot.seasonName})
                    </span>
                    {(snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) && (
                      <span
                        style={{
                          marginLeft: '6px',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: snapshot.comet.active ? '#ef4444' : '#f87171',
                          background: snapshot.comet.active ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.12)',
                          border: `1px solid ${snapshot.comet.active ? '#ef4444' : 'rgba(239, 68, 68, 0.4)'}`,
                        }}
                      >
                        {snapshot.comet.active ? '☄️ Red Harbinger Active' : '☄️ Comet Year'}
                      </span>
                    )}
                    {showVolcanoGlow && (volcanicHudSample.overheadVeil > 0.06 || volcanicHudSample.horizonGlowStrength > 0.08) && (
                      <span
                        onClick={() => {
                          if (volcanicHudSample.horizonGlowStrength > 0.05) {
                            setLookAzimuthDeg(volcanicHudSample.horizonGlowAzimuthDeg);
                            if (projectionMode === 'ground' && lookPitchDeg > 28) setLookPitchDeg(14);
                          }
                        }}
                        title="Click to look toward the volcanic eruption horizon glow"
                        style={{
                          marginLeft: '6px',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: volcanicHudSample.horizonGlowStrength > 0.05 ? 'pointer' : 'default',
                          color: volcanicHudSample.overheadVeil > 0.25 ? '#fca5a5' : '#fdba74',
                          background: 'rgba(154, 52, 18, 0.35)',
                          border: '1px solid rgba(249, 115, 22, 0.55)',
                        }}
                      >
                        {volcanicHudSample.overheadVeil > 0.12
                          ? `🌋 Ash Veil ${Math.round(volcanicHudSample.overheadVeil * 100)}%`
                          : `🌋 Horizon Glow (${azimuthToCompass(volcanicHudSample.horizonGlowAzimuthDeg)})`}
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {projectionMode === 'ground'
                    ? `👁️ Ground View (FOV ${Math.round(groundFovDeg)}°)`
                    : `🏔️ Surround (${Math.round(surroundFovDeg)}°)`}
                  {activePinName ? ` • 📍 ${activePinName}` : ''} • {formatLat(latitudeDeg)} {formatLon(longitudeDeg)} •
                  Looking {azimuthToCompass(lookAzimuthDeg)} ({Math.round(lookAzimuthDeg)}°)
                  {projectionMode === 'ground' ? ` • Pitch ${Math.round(lookPitchDeg)}°` : ''}
                  {isFocused ? ' • O: Hide HUD' : ''}
                </div>
              </div>
            )}

            {/* Top-Right Controls: Fullscreen Overlay/Tool Icon Bar + Compass Quick-Look + Panel Focus Toggle */}
            {!(isFocused && hideFocusHud) && (
              <div
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: '6px',
                  maxWidth: isFocused ? 'calc(100% - 390px)' : 'none',
                  zIndex: 25,
                }}
              >
                {isFocused && (
                  <>
                    {renderViewProjectionButtons(toolbarState, toolbarActions, true, 'overlay')}
                    {renderOverlayIconButtons(toolbarState, toolbarActions, 'overlay')}
                    {renderToolIconButtons(toolbarState, toolbarActions, 'overlay')}
                  </>
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: '2px',
                    background: 'rgba(15, 23, 42, 0.84)',
                    padding: '2px 3px',
                    borderRadius: '6px',
                    border: '1px solid rgba(51, 65, 85, 0.88)',
                  }}
                >
                  {[
                    { label: 'N', az: 0, title: 'Look North (0°)' },
                    { label: 'E', az: 90, title: 'Look East (90°)' },
                    { label: 'S', az: 180, title: 'Look South (180°)' },
                    { label: 'W', az: 270, title: 'Look West (270°)' },
                  ].map((dir) => {
                    const active = Math.abs(wrapAngleDiffDeg(lookAzimuthDeg, dir.az)) < 22;
                    return (
                      <button
                        key={dir.label}
                        onClick={() => setLookAzimuthDeg(dir.az)}
                        title={dir.title}
                        aria-label={dir.title}
                        style={{
                          padding: '3px 7px',
                          fontSize: '10px',
                          fontWeight: 700,
                          borderRadius: '4px',
                          border: 'none',
                          background: active ? '#0284c7' : 'transparent',
                          color: active ? '#f8fafc' : '#94a3b8',
                          cursor: 'pointer',
                        }}
                      >
                        {dir.label}
                      </button>
                    );
                  })}
                  {projectionMode === 'ground' && (
                    <button
                      onClick={() => setLookPitchDeg((p) => (p > 55 ? 22 : 70))}
                      style={{
                        padding: '3px 7px',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '4px',
                        border: 'none',
                        background: lookPitchDeg > 55 ? '#0284c7' : 'transparent',
                        color: lookPitchDeg > 55 ? '#f8fafc' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                      title={
                        lookPitchDeg > 55
                          ? 'Reset gaze pitch down toward the horizon (22°)'
                          : 'Tilt camera up toward the zenith sky (70°)'
                      }
                      aria-label="Toggle zenith vs horizon pitch"
                    >
                      ↑
                    </button>
                  )}
                </div>

                <button
                  onClick={() => {
                    setFocusedView(focusedView === 'preview' ? 'none' : 'preview');
                    setHideFocusHud(false);
                  }}
                  style={focusBtnStyle(focusedView === 'preview')}
                  title={
                    focusedView === 'preview'
                      ? 'Exit Focus View — Return to multi-panel layout (Key: Esc • Cycle panels: 3 • Hide UI: O)'
                      : 'Focus Sky Preview — Expand Sky Preview to fill view (Key: 3)'
                  }
                  aria-label={focusedView === 'preview' ? 'Exit Focus View' : 'Focus Sky Preview'}
                >
                  {focusedView === 'preview' ? '✕' : '⛶'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 2. Zenith Sky Dome */}
        {showDome && (
          <div
            style={{
              gridColumn: isFocused ? '1' : '2',
              gridRow: isFocused ? '1' : '1',
              position: 'relative',
              borderRadius: isFocused ? '0px' : '8px',
              overflow: 'hidden',
              border: isFocused ? 'none' : '1px solid #1e293b',
              background: '#040914',
              minHeight: 0,
            }}
          >
            <canvas ref={domeCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            {!(isFocused && hideFocusHud) && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#cbd5e1',
                    pointerEvents: 'none',
                  }}
                >
                  🧭 Zenith Star Dome
                </div>
                <button
                  onClick={() => {
                    setFocusedView(focusedView === 'dome' ? 'none' : 'dome');
                    setHideFocusHud(false);
                  }}
                  style={{
                    ...focusBtnStyle(focusedView === 'dome'),
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                  }}
                  title={
                    focusedView === 'dome'
                      ? 'Exit fullscreen view (Esc)'
                      : 'Zoom Zenith Dome to fullscreen (hides all other panels)'
                  }
                >
                  {focusedView === 'dome' ? '✕ Exit (Esc)' : '⛶'}
                </button>
              </>
            )}
          </div>
        )}

        {/* 3. Top-Down Orbital Plane */}
        {showOrbit && (
          <div
            style={{
              gridColumn: isFocused ? '1' : '2',
              gridRow: isFocused ? '1' : '2',
              position: 'relative',
              borderRadius: isFocused ? '0px' : '8px',
              overflow: 'hidden',
              border: isFocused ? 'none' : '1px solid #1e293b',
              background: '#040914',
              minHeight: 0,
            }}
          >
            <canvas ref={orbitCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            {!(isFocused && hideFocusHud) && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '10px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#cbd5e1',
                    pointerEvents: 'none',
                  }}
                >
                  🪐 Orbital Plane ({config.blackMoon.retrograde ? 'Outer Retrograde' : 'Both Prograde'})
                </div>
                <button
                  onClick={() => {
                    setFocusedView(focusedView === 'orbit' ? 'none' : 'orbit');
                    setHideFocusHud(false);
                  }}
                  style={{
                    ...focusBtnStyle(focusedView === 'orbit'),
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                  }}
                  title={
                    focusedView === 'orbit'
                      ? 'Exit fullscreen view (Esc)'
                      : 'Zoom Orbital Plane to fullscreen (hides all other panels)'
                  }
                >
                  {focusedView === 'orbit' ? '✕ Exit (Esc)' : '⛶'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Floating Fullscreen Toolbar for Zenith Dome / Orbital Plane focus views */}
      {(focusedView === 'dome' || focusedView === 'orbit') && !hideFocusHud && (
        <div
          style={{
            position: 'fixed',
            top: '10px',
            right: '112px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            maxWidth: 'calc(100vw - 300px)',
            zIndex: 35,
          }}
        >
          {renderViewProjectionButtons(toolbarState, toolbarActions, false, 'overlay')}
          {renderOverlayIconButtons(toolbarState, toolbarActions, 'overlay')}
          {renderToolIconButtons(toolbarState, toolbarActions, 'overlay')}
        </div>
      )}

      {/* Floating Telemetry Bar when toggled in Fullscreen Focus Mode */}
      {isFocused && !hideFocusHud && showPerfHud && (
        <div
          style={{
            position: 'fixed',
            top: '46px',
            right: '10px',
            maxWidth: 'calc(100vw - 20px)',
            zIndex: 35,
          }}
        >
          {renderPerfHudPanel(perfStats, handleResetPerfSpikes, true)}
        </div>
      )}

      {/* Bottom Controls, Telemetry Cards & Config Drawer (hidden in single-view fullscreen) */}
      {!isFocused && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '4px 12px 10px 12px',
            flexShrink: 0,
            maxHeight: '44vh',
            overflowY: 'auto',
          }}
        >
          {/* Time & Date Scrubbers + Pin/Observer Selector */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              padding: '8px 10px',
            }}
          >
            {/* Row 1: Play/Pause, Speed, Time-of-Day Scrubber */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setPlaying((p) => !p)}
                style={{
                  padding: '5px 11px',
                  borderRadius: '6px',
                  border: playing ? '1px solid #38bdf8' : '1px solid #334155',
                  background: playing ? '#0284c7' : '#1e293b',
                  color: '#f8fafc',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  minWidth: '72px',
                }}
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>

              <div style={{ display: 'flex', borderRadius: '5px', overflow: 'hidden', border: '1px solid #334155' }}>
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSpeedHoursPerSec(opt.hoursPerSec)}
                    style={{
                      padding: '4px 7px',
                      fontSize: '11px',
                      border: 'none',
                      background: speedHoursPerSec === opt.hoursPerSec ? '#334155' : '#020617',
                      color: speedHoursPerSec === opt.hoursPerSec ? '#38bdf8' : '#94a3b8',
                      fontWeight: speedHoursPerSec === opt.hoursPerSec ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  borderRadius: '5px',
                  border: '1px solid #334155',
                  background: '#020617',
                  padding: '2px 4px',
                }}
                title="Action when timelapse reaches a solar eclipse"
              >
                <span style={{ fontSize: '10px', color: '#94a3b8', padding: '0 3px', whiteSpace: 'nowrap' }}>
                  🌑 Eclipse:
                </span>
                {(['off', 'slow', 'pause'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setEclipseAutoAction(mode)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      border: 'none',
                      borderRadius: '3px',
                      background: eclipseAutoAction === mode ? '#334155' : 'transparent',
                      color: eclipseAutoAction === mode ? '#fbbf24' : '#94a3b8',
                      fontWeight: eclipseAutoAction === mode ? 600 : 400,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {mode}
                  </button>
                ))}
                <button
                  onClick={() => jumpToAdjacentEclipse(-1)}
                  title="Jump to previous solar eclipse (Alt+←)"
                  style={{
                    padding: '2px 5px',
                    fontSize: '10px',
                    border: 'none',
                    borderLeft: '1px solid #1e293b',
                    background: 'transparent',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  ⏮
                </button>
                <button
                  onClick={() => jumpToAdjacentEclipse(1)}
                  title={
                    nextEclipse
                      ? `Jump to next eclipse: ${nextEclipse.title} — Y${nextEclipse.yearNumber} D${nextEclipse.dayNumber} ${formatClockHour(nextEclipse.localHour, config.hoursPerDay)} (Alt+→)`
                      : 'Jump to next solar eclipse (Alt+→)'
                  }
                  style={{
                    padding: '2px 5px',
                    fontSize: '10px',
                    border: 'none',
                    background: 'transparent',
                    color: nextEclipse ? '#fde68a' : '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  ⏭
                </button>
              </div>

              <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap', marginLeft: '4px' }}>
                Time:
              </span>
              <input
                type="range"
                min={0}
                max={config.hoursPerDay - 0.02}
                step={0.05}
                value={snapshot.localHour}
                onChange={(e) => setDayAndHour(snapshot.dayOfYear, snapshot.year, Number(e.target.value))}
                style={{ flex: 1, accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#e2e8f0', width: '42px' }}>
                {formatClockHour(snapshot.localHour, config.hoursPerDay)}
              </span>
            </div>

            {/* Row 2: Year Selector + Calendar Day Scrubber + Pin / Observer Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <button
                  onClick={() => {
                    const yrHours = config.daysPerYear * config.hoursPerDay;
                    applyManualWorldHours((h) => Math.max(0, h - yrHours));
                    triggerModeToast('📅 -1 Year');
                  }}
                  style={stepBtnStyle}
                  title="Step back 1 year (Hotkey: [)"
                >
                  -1y
                </button>
                <button onClick={() => applyManualWorldHours((h) => Math.max(0, h - config.hoursPerDay))} style={stepBtnStyle} title="Step back 1 day (Hotkey: /)">
                  -1d
                </button>
                <button onClick={() => applyManualWorldHours((h) => h + config.hoursPerDay)} style={stepBtnStyle} title="Step forward 1 day (Hotkey: *)">
                  +1d
                </button>
                <button onClick={() => applyManualWorldHours((h) => h + config.hoursPerDay * 7)} style={stepBtnStyle} title="Step forward 7 days">
                  +7d
                </button>
                <button
                  onClick={() => {
                    const yrHours = config.daysPerYear * config.hoursPerDay;
                    applyManualWorldHours((h) => h + yrHours);
                    triggerModeToast('📅 +1 Year');
                  }}
                  style={stepBtnStyle}
                  title="Step forward 1 year (Hotkey: ])"
                >
                  +1y
                </button>
              </div>

              {/* Dedicated Year Selection Group */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  borderRadius: '5px',
                  border: (snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) ? '1px solid #ef4444' : '1px solid #334155',
                  background: (snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) ? 'rgba(69, 10, 10, 0.45)' : '#020617',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: (snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) ? '#fca5a5' : '#94a3b8',
                    fontWeight: 600,
                  }}
                >
                  Year:
                </span>
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={snapshot.year}
                  onChange={(e) => {
                    const yr = parseInt(e.target.value, 10);
                    if (!isNaN(yr) && yr >= 1) {
                      setDayAndHour(snapshot.dayOfYear, yr, snapshot.localHour);
                    }
                  }}
                  style={{
                    width: '46px',
                    padding: '1px 3px',
                    borderRadius: '3px',
                    border: '1px solid #475569',
                    background: '#090d16',
                    color: (snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) ? '#f87171' : '#f8fafc',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                  title="Type any calendar year (Hotkey: [ or ] to step)"
                />
                <select
                  value={snapshot.year}
                  onChange={(e) => {
                    const yr = parseInt(e.target.value, 10);
                    if (!isNaN(yr) && yr >= 1) {
                      if ((yr === 3 || (yr - 3) % 12 === 0) && (snapshot.dayOfYear < 30 || snapshot.dayOfYear > 80)) {
                        setDayAndHour(55, yr, 18.5);
                        triggerModeToast(`☄️ Moved to Year ${yr} Day 55: The Red Harbinger in dusk sky`);
                      } else {
                        setDayAndHour(snapshot.dayOfYear, yr, snapshot.localHour);
                        triggerModeToast(`📅 Moved to Year ${yr}`);
                      }
                    }
                  }}
                  style={{
                    padding: '2px 4px',
                    borderRadius: '3px',
                    border: '1px solid #475569',
                    background: '#090d16',
                    color: (snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) ? '#f87171' : '#cbd5e1',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                  title="Quick Year Presets"
                >
                  <option value={1}>Year 1 (Standard)</option>
                  <option value={2}>Year 2</option>
                  <option value={3}>Year 3 ☄️ Comet</option>
                  <option value={4}>Year 4</option>
                  <option value={5}>Year 5</option>
                  <option value={10}>Year 10</option>
                  <option value={15}>Year 15 ☄️ Comet (12y)</option>
                  <option value={27}>Year 27 ☄️ Comet (24y)</option>
                  {![1, 2, 3, 4, 5, 10, 15, 27].includes(snapshot.year) && (
                    <option value={snapshot.year}>Year {snapshot.year}</option>
                  )}
                </select>
                {(snapshot.year === 3 || (snapshot.year - 3) % 12 === 0) && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: snapshot.comet.active ? '#ef4444' : '#f87171',
                      background: snapshot.comet.active ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.12)',
                      border: `1px solid ${snapshot.comet.active ? '#ef4444' : 'rgba(239, 68, 68, 0.4)'}`,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                    title={
                      snapshot.comet.active
                        ? 'The Red Harbinger is blazing across the night sky!'
                        : '12-Year Comet Apparition Year (Perihelion window: Days 30–80)'
                    }
                  >
                    ☄️ {snapshot.comet.active ? 'Comet Active' : 'Comet Year'}
                  </span>
                )}
              </div>

              <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                Day {snapshot.dayOfYear}/{config.daysPerYear}:
              </span>
              <input
                type="range"
                min={1}
                max={config.daysPerYear}
                step={1}
                value={snapshot.dayOfYear}
                onChange={(e) => setDayAndHour(Number(e.target.value), snapshot.year, snapshot.localHour)}
                style={{ flex: 1, minWidth: '120px', accentColor: '#a78bfa', cursor: 'pointer' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Observer:</span>
                <select
                  value={observerSource}
                  onChange={(e) => handleObserverSelect(e.target.value)}
                  style={{
                    padding: '3px 6px',
                    borderRadius: '5px',
                    border: '1px solid #334155',
                    background: '#020617',
                    color: '#e2e8f0',
                    fontSize: '11px',
                  }}
                >
                  <option value="map">🗺️ Follow Map Center</option>
                  {activePinName && <option value="active-pin">📌 Selected Pin ({activePinName})</option>}
                  {syncedMarkers.map((m) => (
                    <option key={m.id} value={`marker:${m.id}`}>
                      📍 {m.name} ({formatLat(m.latitudeDeg)})
                    </option>
                  ))}
                  <option value="manual">🧭 Manual Lat / Lon</option>
                </select>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#bae6fd' }}>
                  {formatLat(latitudeDeg)} {formatLon(longitudeDeg)}
                </span>
                {observerSource === 'manual' && (
                  <>
                    <input
                      type="range"
                      min={-80}
                      max={80}
                      step={1}
                      value={latitudeDeg}
                      onChange={(e) => setLatitudeDeg(Number(e.target.value))}
                      style={{ width: '75px', accentColor: '#38bdf8' }}
                      title="Observer Latitude"
                    />
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={longitudeDeg}
                      onChange={(e) => setLongitudeDeg(Number(e.target.value))}
                      style={{ width: '75px', accentColor: '#38bdf8' }}
                      title="Observer Longitude"
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Celestial Telemetry Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#fde047' }}>☀️ {snapshot.sun.name}</span>
                <span style={visPillStyle(snapshot.sun.sky.aboveHorizon)}>
                  {snapshot.sun.sky.aboveHorizon ? 'Up' : 'Below'}
                </span>
              </div>
              <div style={metricLineStyle}>
                Alt <strong>{snapshot.sun.sky.altitudeDeg.toFixed(1)}°</strong> •{' '}
                {azimuthToCompass(snapshot.sun.sky.azimuthDeg)} ({Math.round(snapshot.sun.sky.azimuthDeg)}°)
              </div>
              <div style={subMetricStyle}>
                Rise {formatRiseSet(snapshot.sun.riseSet, 'rise', config.hoursPerDay)} • Set{' '}
                {formatRiseSet(snapshot.sun.riseSet, 'set', config.hoursPerDay)}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#f1f5f9' }}>
                  🌕 {snapshot.primaryMoon.name}
                </span>
                <span style={visPillStyle(snapshot.primaryMoon.sky.aboveHorizon)}>
                  {snapshot.primaryMoon.sky.aboveHorizon ? 'Visible' : 'Set'}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#cbd5e1', fontWeight: 600 }}>
                {snapshot.primaryMoon.phaseName} ({Math.round(snapshot.primaryMoon.phaseFraction * 100)}%)
              </div>
              <div style={metricLineStyle}>
                Alt <strong>{snapshot.primaryMoon.sky.altitudeDeg.toFixed(1)}°</strong> •{' '}
                {azimuthToCompass(snapshot.primaryMoon.sky.azimuthDeg)}
              </div>
              <div style={subMetricStyle}>
                Rise {formatRiseSet(snapshot.primaryMoon.riseSet, 'rise', config.hoursPerDay)} • Set{' '}
                {formatRiseSet(snapshot.primaryMoon.riseSet, 'set', config.hoursPerDay)}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#bae6fd',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ✨ {snapshot.trojanCluster.name}
                </span>
                <span style={visPillStyle(snapshot.trojanCluster.visibleFraction > 0.1)}>
                  {Math.round(snapshot.trojanCluster.visibleFraction * 100)}% Up
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {config.trojanCluster.lagrangePoint}{' '}
                {config.trojanCluster.lagrangePoint === 'L4' ? 'Follows' : 'Leads'} (
                {config.trojanCluster.lagCenterDeg}°) • {Math.round(snapshot.trojanCluster.phaseFraction * 100)}% lit
              </div>
              <div style={metricLineStyle}>
                Core <strong>{snapshot.trojanCluster.coreSky.altitudeDeg.toFixed(1)}°</strong> •{' '}
                {azimuthToCompass(snapshot.trojanCluster.coreSky.azimuthDeg)}
              </div>
              <div style={subMetricStyle}>
                Rise {formatRiseSet(snapshot.trojanCluster.riseSet, 'rise', config.hoursPerDay)} • Set{' '}
                {formatRiseSet(snapshot.trojanCluster.riseSet, 'set', config.hoursPerDay)}
              </div>
            </div>

            <div
              style={{
                ...cardStyle,
                borderColor: snapshot.blackMoon.isAshFull ? '#991b1b' : '#1e293b',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: snapshot.blackMoon.isAshFull ? '#fca5a5' : '#94a3b8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  🌑 {config.blackMoon.name.split(' ')[0]}
                </span>
                <span style={visPillStyle(snapshot.blackMoon.sky.aboveHorizon)}>
                  {snapshot.blackMoon.sky.aboveHorizon ? 'Overhead' : 'Below'}
                </span>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: snapshot.blackMoon.isAshFull ? '#fecaca' : '#94a3b8',
                  fontWeight: snapshot.blackMoon.isAshFull ? 600 : 400,
                }}
              >
                {snapshot.blackMoon.phaseName}
              </div>
              <div style={metricLineStyle}>
                Alt <strong>{snapshot.blackMoon.sky.altitudeDeg.toFixed(1)}°</strong> •{' '}
                {azimuthToCompass(snapshot.blackMoon.sky.azimuthDeg)}{' '}
                <span style={{ color: '#64748b' }}>({config.blackMoon.retrograde ? 'Retro' : 'Pro'})</span>
              </div>
              <div style={subMetricStyle}>
                Rise {formatRiseSet(snapshot.blackMoon.riseSet, 'rise', config.hoursPerDay)} • Set{' '}
                {formatRiseSet(snapshot.blackMoon.riseSet, 'set', config.hoursPerDay)}
              </div>
            </div>
          </div>

          {/* DM Lighting Readout + Jump to Omen Chips (fixed 2-row layout prevents vertical jumping) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              padding: '7px 10px',
              borderRadius: '7px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              fontSize: '11px',
            }}
          >
            <div
              title={snapshot.lighting.summary}
              style={{
                color: '#cbd5e1',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <strong>DM Sky Note:</strong> {snapshot.lighting.summary}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                minHeight: '22px',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: '#64748b', fontWeight: 600 }}>Jump to Omen:</span>

              {/* 12-Year Comet Apparition Shortcuts */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: '999px',
                  border: '1px solid #991b1b',
                  background: 'rgba(153, 27, 27, 0.35)',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => {
                    setPlaying(false);
                    const y3Hours = ((3 - 1) * config.daysPerYear + (55 - 1)) * config.hoursPerDay + 18.5;
                    applyManualWorldHours(y3Hours);
                    triggerModeToast('☄️ Jumped to Year 3 Day 55 (18:30 dusk): The Red Harbinger Apparition');
                  }}
                  title="Jump to Year 3 Day 55 at 18:30 (dusk) to observe the 12-year Red Harbinger Comet apparition"
                  style={{
                    padding: '2px 7px',
                    border: 'none',
                    background: 'transparent',
                    color: '#fca5a5',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ☄️ Red Harbinger (Y3)
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    const y3Hours = ((3 - 1) * config.daysPerYear + (55 - 1)) * config.hoursPerDay + 18.5;
                    applyManualWorldHours(y3Hours);
                    triggerModeToast('☄️ Jumped to Year 3 Day 55 (18:30 dusk): The Red Harbinger Apparition');
                  }}
                  style={{
                    padding: '2px 6px',
                    border: 'none',
                    borderLeft: '1px solid #991b1b',
                    background: 'rgba(185, 28, 28, 0.65)',
                    color: '#f8fafc',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  go
                </button>
              </div>

              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  borderRadius: '999px',
                  border: '1px solid #991b1b',
                  background: 'rgba(153, 27, 27, 0.35)',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => {
                    setPlaying(false);
                    const y15Hours = ((15 - 1) * config.daysPerYear + (55 - 1)) * config.hoursPerDay + 18.5;
                    applyManualWorldHours(y15Hours);
                    triggerModeToast('☄️ Jumped to Year 15 Day 55 (18:30 dusk): The Red Harbinger Return Apparition');
                  }}
                  title="Jump to Year 15 Day 55 at 18:30 (dusk) to observe the 12-year Red Harbinger Comet return apparition"
                  style={{
                    padding: '2px 7px',
                    border: 'none',
                    background: 'transparent',
                    color: '#fca5a5',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ☄️ Red Harbinger (Y15)
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    const y15Hours = ((15 - 1) * config.daysPerYear + (55 - 1)) * config.hoursPerDay + 18.5;
                    applyManualWorldHours(y15Hours);
                    triggerModeToast('☄️ Jumped to Year 15 Day 55 (18:30 dusk): The Red Harbinger Return Apparition');
                  }}
                  style={{
                    padding: '2px 6px',
                    border: 'none',
                    borderLeft: '1px solid #991b1b',
                    background: 'rgba(185, 28, 28, 0.65)',
                    color: '#f8fafc',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  go
                </button>
              </div>

              {upcomingOmens.length === 0 ? (
                <span style={{ color: '#475569' }}>No omens in next 130 days</span>
              ) : (
                upcomingOmens.map((ev) => (
                  <div
                    key={ev.type}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: '999px',
                      border: `1px solid ${ev.severity === 'omen' ? '#7f1d1d' : '#334155'}`,
                      background: ev.severity === 'omen' ? 'rgba(69, 10, 10, 0.7)' : '#020617',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => setSelectedOmenModal({ type: ev.type, title: ev.title, event: ev })}
                      title={`View GM & Player description for ${ev.title}`}
                      style={{
                        padding: '2px 7px',
                        border: 'none',
                        background: 'transparent',
                        color: ev.severity === 'omen' ? '#fecaca' : '#bae6fd',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      {ev.title} (D{ev.dayNumber})
                    </button>
                    <button
                      onClick={() => {
                        setPlaying(false);
                        applyManualWorldHours(ev.worldHours);
                      }}
                      title={`Jump to Year ${ev.yearNumber}, Day ${ev.dayNumber} at ${formatClockHour(ev.localHour)}`}
                      style={{
                        padding: '2px 6px',
                        border: 'none',
                        borderLeft: `1px solid ${ev.severity === 'omen' ? '#7f1d1d' : '#334155'}`,
                        background: ev.severity === 'omen' ? 'rgba(127, 29, 29, 0.55)' : 'rgba(30, 41, 59, 0.7)',
                        color: '#f8fafc',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      go
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Collapsible Orbital Parameters Drawer */}
          {showConfigDrawer && (
            <div
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '10px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '10px',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontWeight: 700, color: '#f8fafc' }}>🌍 World & Calendar</div>
                <label style={fieldLabelStyle}>
                  World Name
                  <input
                    type="text"
                    value={config.worldName}
                    onChange={(e) => setConfig({ ...config, worldName: e.target.value })}
                    style={textInputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Sun Name
                  <input
                    type="text"
                    value={config.sunName}
                    onChange={(e) => setConfig({ ...config, sunName: e.target.value })}
                    style={textInputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Axial Tilt ({config.axialTiltDeg.toFixed(1)}°)
                  <input
                    type="range"
                    min={0}
                    max={45}
                    step={0.5}
                    value={config.axialTiltDeg}
                    onChange={(e) => setConfig({ ...config, axialTiltDeg: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                  🌕 Inner Moon & {config.trojanCluster.lagrangePoint} Shards
                </div>
                <label style={fieldLabelStyle}>
                  Primary Moon Name
                  <input
                    type="text"
                    value={config.primaryMoon.name}
                    onChange={(e) =>
                      setConfig({ ...config, primaryMoon: { ...config.primaryMoon, name: e.target.value } })
                    }
                    style={textInputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Synodic Cycle ({config.primaryMoon.synodicPeriodDays.toFixed(2)} days)
                  <input
                    type="range"
                    min={12}
                    max={60}
                    step={0.25}
                    value={config.primaryMoon.synodicPeriodDays}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        primaryMoon: { ...config.primaryMoon, synodicPeriodDays: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Cluster Name & Offset ({config.trojanCluster.lagCenterDeg}°)
                  <input
                    type="text"
                    value={config.trojanCluster.name}
                    onChange={(e) =>
                      setConfig({ ...config, trojanCluster: { ...config.trojanCluster, name: e.target.value } })
                    }
                    style={textInputStyle}
                  />
                  <input
                    type="range"
                    min={25}
                    max={80}
                    step={1}
                    value={config.trojanCluster.lagCenterDeg}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        trojanCluster: { ...config.trojanCluster, lagCenterDeg: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <div style={{ display: 'flex', borderRadius: '5px', overflow: 'hidden', border: '1px solid #334155' }}>
                  <button
                    onClick={() =>
                      setConfig({ ...config, trojanCluster: { ...config.trojanCluster, lagrangePoint: 'L4' } })
                    }
                    style={{ ...tabBtnStyle(config.trojanCluster.lagrangePoint === 'L4'), flex: 1 }}
                    title="L4 (+60° ahead in orbit): Moon rises first, Tears follow behind in the night sky"
                  >
                    L4 (Follows in Sky)
                  </button>
                  <button
                    onClick={() =>
                      setConfig({ ...config, trojanCluster: { ...config.trojanCluster, lagrangePoint: 'L5' } })
                    }
                    style={{ ...tabBtnStyle(config.trojanCluster.lagrangePoint === 'L5'), flex: 1 }}
                    title="L5 (-60° behind in orbit): Tears rise first, leading ahead of the Moon in the sky"
                  >
                    L5 (Leads in Sky)
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontWeight: 700, color: '#fca5a5' }}>🌑 Distant Black Moon</div>
                <label style={fieldLabelStyle}>
                  Black Moon Name
                  <input
                    type="text"
                    value={config.blackMoon.name}
                    onChange={(e) =>
                      setConfig({ ...config, blackMoon: { ...config.blackMoon, name: e.target.value } })
                    }
                    style={textInputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Orbital Period ({config.blackMoon.siderealPeriodDays} days)
                  <input
                    type="range"
                    min={55}
                    max={220}
                    step={1}
                    value={config.blackMoon.siderealPeriodDays}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        blackMoon: { ...config.blackMoon, siderealPeriodDays: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: '#cbd5e1' }}>
                    <input
                      type="checkbox"
                      checked={config.blackMoon.retrograde}
                      onChange={(e) =>
                        setConfig({ ...config, blackMoon: { ...config.blackMoon, retrograde: e.target.checked } })
                      }
                    />
                    Retrograde Orbit
                  </label>
                  <button
                    onClick={() => setConfig(DEFAULT_CELESTIAL_CONFIG)}
                    style={{ ...stepBtnStyle, fontSize: '10px' }}
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>

              {/* Deep-Sky Clouds & Atmospheric Glare Toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px', borderTop: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🌌 Deep-Sky & Atmospheric Overlays</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#e2e8f0', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={showGlareWashout}
                    onChange={(e) => setShowGlareWashout(e.target.checked)}
                  />
                  <span>Atmospheric & Lunar Glare Washout <span style={{ color: '#94a3b8', fontSize: '10px' }}>(Key: 0)</span></span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Omen Info Dialog (Game Master & In-World Player Readout) */}
      {selectedOmenModal && (() => {
        const lore = getOmenLore(selectedOmenModal.type, config);
        const ev = selectedOmenModal.event;
        const isOmen = lore.severity === 'omen';
        return (
          <div
            onClick={() => setSelectedOmenModal(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: 'rgba(2, 6, 23, 0.75)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '520px',
                background: '#0f172a',
                border: `1px solid ${isOmen ? '#991b1b' : '#334155'}`,
                borderRadius: '10px',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                color: '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: isOmen ? '#fecaca' : '#bae6fd' }}>
                    {isOmen ? '👁️ ' : '✨ '}
                    {selectedOmenModal.title}
                  </div>
                  {ev && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Next peak: Year {ev.yearNumber}, Day {ev.dayNumber} at{' '}
                      {formatClockHour(ev.localHour, config.hoursPerDay)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedOmenModal(null)}
                  style={{ ...stepBtnStyle, padding: '3px 8px', fontSize: '11px' }}
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  background: '#020617',
                  border: '1px solid #1e293b',
                  borderRadius: '7px',
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#38bdf8',
                    marginBottom: '4px',
                  }}
                >
                  In-World Description (For Players)
                </div>
                <div style={{ fontSize: '12.5px', lineHeight: 1.5, color: '#f1f5f9', fontStyle: 'italic' }}>
                  "{lore.playerDescription}"
                </div>
              </div>

              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: '1px solid #334155',
                  borderRadius: '7px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#fbbf24',
                  }}
                >
                  Game Master Notes &amp; Mechanics
                </div>
                <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#cbd5e1' }}>{lore.gmNotes}</div>
                <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#94a3b8' }}>{lore.gmMechanics}</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                {ev && (
                  <button
                    onClick={() => {
                      setPlaying(false);
                      applyManualWorldHours(ev.worldHours);
                      setSelectedOmenModal(null);
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      border: '1px solid #0284c7',
                      background: '#0369a1',
                      color: '#f8fafc',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Go to Event (D{ev.dayNumber})
                  </button>
                )}
                <button
                  onClick={() => setSelectedOmenModal(null)}
                  style={{ ...stepBtnStyle, padding: '5px 12px', fontSize: '12px' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Select Celestial Targets Modal (Key: Y) */}
      {showQuickSelect && (() => {
        interface CelestialTargetItem {
          id: string;
          name: string;
          type: 'constellation' | 'moon' | 'sun' | 'comet' | 'deepsky';
          category: string;
          alt: number;
          az: number;
          inSky: boolean;
          badgeText: string;
          color: string;
          lore?: string;
        }

        const items: CelestialTargetItem[] = [];

        // 1. Sun
        items.push({
          id: 'sun',
          name: `☀️ ${config.sunName}`,
          type: 'sun',
          category: 'Sun & Moons',
          alt: snapshot.sun.sky.altitudeDeg,
          az: snapshot.sun.sky.azimuthDeg,
          inSky: snapshot.sun.sky.altitudeDeg >= 0,
          badgeText:
            snapshot.sun.sky.altitudeDeg >= 0
              ? `▲ In Sky (+${Math.round(snapshot.sun.sky.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(snapshot.sun.sky.altitudeDeg)}°)`,
          color: '#facc15',
          lore: `Central star of Vaelora • ${azimuthToCompass(snapshot.sun.sky.azimuthDeg)}`,
        });

        // 2. Moons
        items.push({
          id: 'primaryMoon',
          name: `🌙 ${snapshot.primaryMoon.name}`,
          type: 'moon',
          category: 'Sun & Moons',
          alt: snapshot.primaryMoon.sky.altitudeDeg,
          az: snapshot.primaryMoon.sky.azimuthDeg,
          inSky: snapshot.primaryMoon.sky.altitudeDeg >= 0,
          badgeText:
            snapshot.primaryMoon.sky.altitudeDeg >= 0
              ? `▲ In Sky (+${Math.round(snapshot.primaryMoon.sky.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(snapshot.primaryMoon.sky.altitudeDeg)}°)`,
          color: '#e2e8f0',
          lore: `Silver Moon • ${snapshot.primaryMoon.phaseName} (${Math.round(snapshot.primaryMoon.phaseFraction * 100)}% lit)`,
        });

        if (config.trojanCluster.enabled) {
          items.push({
            id: 'trojans',
            name: `✨ ${config.trojanCluster.name}`,
            type: 'moon',
            category: 'Sun & Moons',
            alt: snapshot.trojanCluster.coreSky.altitudeDeg,
            az: snapshot.trojanCluster.coreSky.azimuthDeg,
            inSky: snapshot.trojanCluster.coreSky.altitudeDeg >= 0,
            badgeText:
              snapshot.trojanCluster.coreSky.altitudeDeg >= 0
                ? `▲ In Sky (+${Math.round(snapshot.trojanCluster.coreSky.altitudeDeg)}°)`
                : `▼ Underground (${Math.round(snapshot.trojanCluster.coreSky.altitudeDeg)}°)`,
            color: '#7dd3fc',
            lore: `Lagrange ${config.trojanCluster.lagrangePoint} cluster (${config.trojanCluster.shardCount} crystal shards)`,
          });
        }

        if (config.blackMoon.enabled) {
          items.push({
            id: 'blackMoon',
            name: `🌑 ${snapshot.blackMoon.name}`,
            type: 'moon',
            category: 'Sun & Moons',
            alt: snapshot.blackMoon.sky.altitudeDeg,
            az: snapshot.blackMoon.sky.azimuthDeg,
            inSky: snapshot.blackMoon.sky.altitudeDeg >= 0,
            badgeText:
              snapshot.blackMoon.sky.altitudeDeg >= 0
                ? `▲ In Sky (+${Math.round(snapshot.blackMoon.sky.altitudeDeg)}°)`
                : `▼ Underground (${Math.round(snapshot.blackMoon.sky.altitudeDeg)}°)`,
            color: '#f87171',
            lore: `Outer Retrograde Moon • ${snapshot.blackMoon.isAshFull ? 'Ash-Full Surge!' : 'Dark Occluding Disc'}`,
          });
        }

        // 3. Comet (The Red Harbinger)
        items.push({
          id: 'comet',
          name: `☄️ ${snapshot.comet.name}`,
          type: 'comet',
          category: 'Comet & Deep Sky',
          alt: snapshot.comet.sky.altitudeDeg,
          az: snapshot.comet.sky.azimuthDeg,
          inSky: snapshot.comet.active && snapshot.comet.sky.altitudeDeg >= 0,
          badgeText: snapshot.comet.active
            ? snapshot.comet.sky.altitudeDeg >= 0
              ? `▲ In Sky (+${Math.round(snapshot.comet.sky.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(snapshot.comet.sky.altitudeDeg)}°)`
            : `Inactive in Year ${snapshot.year} (12y orbit)`,
          color: '#f87171',
          lore: snapshot.comet.active
            ? `Active Apparition! Sweeping pale red mist tail (${snapshot.comet.tailWidthDeg.toFixed(1)}° wide, 8× moon width)`
            : `12-year periodic comet (appears in Year 3 and Year 15) • Click to jump directly to Year 3 apparition & face comet!`,
        });

        // 4. Deep Sky (The Chrysalis Nebula & Galaxy Core)
        const nebHor = starRaDecToHorizontal(
          COLOURED_NEBULA.centerRaDeg * DEG_TO_RAD,
          COLOURED_NEBULA.centerDecDeg * DEG_TO_RAD,
          snapshot.localSiderealRad,
          snapshot.latitudeDeg
        );
        items.push({
          id: 'nebula',
          name: `🌌 ${COLOURED_NEBULA.name}`,
          type: 'deepsky',
          category: 'Comet & Deep Sky',
          alt: nebHor.altitudeDeg,
          az: nebHor.azimuthDeg,
          inSky: nebHor.altitudeDeg >= 0,
          badgeText:
            nebHor.altitudeDeg >= 0
              ? `▲ In Sky (+${Math.round(nebHor.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(nebHor.altitudeDeg)}°)`,
          color: '#f43f5e',
          lore: `${COLOURED_NEBULA.subtitle} • Ionized rose, cyan, and violet gaseous mist`,
        });

        const galCoreHor = starRaDecToHorizontal(
          GALAXY_CORE_RA_DEG * DEG_TO_RAD,
          GALAXY_CORE_DEC_DEG * DEG_TO_RAD,
          snapshot.localSiderealRad,
          snapshot.latitudeDeg
        );
        items.push({
          id: 'galaxyCore',
          name: `🌀 ${GALAXY_CLOUD.name} (Galactic Core)`,
          type: 'deepsky',
          category: 'Comet & Deep Sky',
          alt: galCoreHor.altitudeDeg,
          az: galCoreHor.azimuthDeg,
          inSky: galCoreHor.altitudeDeg >= 0,
          badgeText:
            galCoreHor.altitudeDeg >= 0
              ? `▲ In Sky (+${Math.round(galCoreHor.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(galCoreHor.altitudeDeg)}°)`,
          color: '#38bdf8',
          lore: `Host galaxy central stellar bulge & dense cosmic starfield`,
        });

        // 5. Constellations (all 9)
        for (const con of WORLD_CONSTELLATIONS) {
          const hor = starRaDecToHorizontal(
            con.centerRaDeg * DEG_TO_RAD,
            con.centerDecDeg * DEG_TO_RAD,
            snapshot.localSiderealRad,
            snapshot.latitudeDeg
          );
          const inSky = hor.altitudeDeg >= 0;
          items.push({
            id: `con_${con.id}`,
            name: `✨ ${con.name}`,
            type: 'constellation',
            category: 'Constellations',
            alt: hor.altitudeDeg,
            az: hor.azimuthDeg,
            inSky,
            badgeText: inSky
              ? `▲ In Sky (+${Math.round(hor.altitudeDeg)}°)`
              : `▼ Underground (${Math.round(hor.altitudeDeg)}°)`,
            color: con.color,
            lore: `${con.subtitle} • ${con.lore}`,
          });
        }

        const filtered = items.filter((it) => {
          if (!quickSelectFilter.trim()) return true;
          const q = quickSelectFilter.toLowerCase();
          return (
            it.name.toLowerCase().includes(q) ||
            it.category.toLowerCase().includes(q) ||
            (it.lore && it.lore.toLowerCase().includes(q))
          );
        });

        const inSkyCount = filtered.filter((i) => i.inSky).length;
        const undergroundCount = filtered.length - inSkyCount;

        const handleSelect = (item: CelestialTargetItem) => {
          if (item.id === 'comet' && !snapshot.comet.active) {
            const y3Hours = ((3 - 1) * config.daysPerYear + (55 - 1)) * config.hoursPerDay + 18.5;
            setPlaying(false);
            applyManualWorldHours(y3Hours);
            const y3Snap = computeCelestialSnapshot(y3Hours, latitudeDeg, longitudeDeg, config, false);
            setProjectionMode('ground');
            setLookAzimuthDeg(y3Snap.comet.sky.azimuthDeg);
            setLookPitchDeg(Math.max(-85, Math.min(88, y3Snap.comet.sky.altitudeDeg)));
            setShowQuickSelect(false);
            triggerModeToast(
              `☄️ Moved to Year 3 Day 55 (18:30 dusk) & Facing ${item.name} (${y3Snap.comet.sky.altitudeDeg >= 0 ? '+' : ''}${Math.round(y3Snap.comet.sky.altitudeDeg)}° alt)!`
            );
            return;
          }
          setProjectionMode('ground');
          setLookAzimuthDeg(item.az);
          // Turn camera directly to face the target, even underground down to -85°!
          setLookPitchDeg(Math.max(-85, Math.min(88, item.alt)));
          setShowQuickSelect(false);
          triggerModeToast(
            `🎯 Facing ${item.name} (${item.alt >= 0 ? '+' : ''}${Math.round(item.alt)}° alt, ${Math.round(item.az)}° az)`
          );
        };

        return (
          <div
            onClick={() => setShowQuickSelect(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(5px)',
              zIndex: 99999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '660px',
                maxWidth: '96vw',
                maxHeight: '88vh',
                background: '#090d16',
                border: '1px solid #38bdf8',
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75), 0 0 24px rgba(56, 189, 248, 0.15)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                color: '#f8fafc',
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '12px 16px',
                  background: 'linear-gradient(to right, #0f172a, #0369a1)',
                  borderBottom: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🎯 Celestial Quick Select</span>
                    <span style={{ fontSize: '11px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
                      Key: Y
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
                    Click any item to turn the camera to face it (even underground). Names brighten in the sky and dim underground.
                  </div>
                </div>
                <button
                  onClick={() => setShowQuickSelect(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    lineHeight: 1,
                  }}
                  title="Close (Esc)"
                >
                  ✕
                </button>
              </div>

              {/* Filter bar & counts */}
              <div
                style={{
                  padding: '10px 16px',
                  background: '#0b1324',
                  borderBottom: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search constellations, moons, comet, deep sky..."
                    value={quickSelectFilter}
                    onChange={(e) => setQuickSelectFilter(e.target.value)}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#f8fafc',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                  />
                  {quickSelectFilter && (
                    <button
                      onClick={() => setQuickSelectFilter('')}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#4ade80', fontWeight: 600 }}>▲ {inSkyCount} in sky</span>
                  <span style={{ margin: '0 6px' }}>•</span>
                  <span style={{ color: '#64748b' }}>▼ {undergroundCount} underground</span>
                </div>
              </div>

              {/* Items List */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                {filtered.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '36px 12px', color: '#64748b', fontSize: '13px' }}>
                    No celestial bodies or constellations match "{quickSelectFilter}".
                  </div>
                ) : (
                  filtered.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.12s ease',
                        background: item.inSky ? 'rgba(15, 23, 42, 0.75)' : 'rgba(15, 23, 42, 0.28)',
                        border: item.inSky ? '1px solid rgba(56, 189, 248, 0.24)' : '1px solid rgba(51, 65, 85, 0.3)',
                        opacity: item.inSky ? 1 : 0.62,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = item.inSky ? 'rgba(30, 41, 59, 0.95)' : 'rgba(30, 41, 59, 0.55)';
                        e.currentTarget.style.borderColor = item.color;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = item.inSky ? 'rgba(15, 23, 42, 0.75)' : 'rgba(15, 23, 42, 0.28)';
                        e.currentTarget.style.borderColor = item.inSky ? 'rgba(56, 189, 248, 0.24)' : 'rgba(51, 65, 85, 0.3)';
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontWeight: item.inSky ? 700 : 500,
                              fontSize: '13px',
                              color: item.inSky ? (item.type === 'constellation' ? item.color : '#f8fafc') : '#64748b',
                              textShadow: item.inSky ? `0 0 10px ${item.color}33` : 'none',
                            }}
                          >
                            {item.name}
                          </span>
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: 'rgba(51, 65, 85, 0.5)',
                              color: '#94a3b8',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {item.category}
                          </span>
                        </div>
                        {item.lore && (
                          <div style={{ fontSize: '11px', color: item.inSky ? '#94a3b8' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.lore}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ textAlign: 'right', fontSize: '10px', color: item.inSky ? '#94a3b8' : '#475569' }}>
                          <div>{azimuthToCompass(item.az)} ({Math.round(item.az)}°)</div>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: '999px',
                            border: `1px solid ${item.inSky ? 'rgba(16, 185, 129, 0.45)' : 'rgba(71, 85, 105, 0.35)'}`,
                            background: item.inSky ? 'rgba(16, 185, 129, 0.16)' : 'rgba(51, 65, 85, 0.35)',
                            color: item.inSky ? '#4ade80' : '#64748b',
                          }}
                        >
                          {item.badgeText}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: '8px 16px',
                  background: '#0b1324',
                  borderTop: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#64748b',
                }}
              >
                <div>
                  Tip: Press <kbd style={{ padding: '1px 5px', background: '#1e293b', borderRadius: '3px', color: '#cbd5e1', border: '1px solid #334155' }}>Y</kbd> anywhere in the sky preview to toggle this target list.
                </div>
                <button
                  onClick={() => setShowQuickSelect(false)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '5px',
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#f8fafc',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Close (Esc)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Multi-Page Sky Guide & Documentation Modal */}
      {showHelpModal && (() => {
        const pages = [
          {
            title: '1. Sky Views & Navigation',
            subtitle: 'Exploring the firmament from any point on Vaelora',
            sections: [
              {
                heading: 'Ground & Surround Views',
                body: 'Ground View simulates a natural perspective camera (zoomable 20°–115° FOV). Surround View projects a wide 210° (zoomable 90°–310°) horizon panorama. Drag with the mouse to look around, and use the mouse wheel to zoom in or out.',
              },
              {
                heading: 'Zenith Star Dome & Orbital Plane',
                body: 'The Zenith Star Dome shows the full 360° sky overhead (horizon at the outer ring, zenith at center). The Orbital Plane view shows the top-down orbits of Vaelis, the Trojan cluster, and outer retrograde Morvath relative to Solis.',
              },
              {
                heading: 'Focus, Arrow Pan & Pure View (Key: O)',
                body: 'Click the expand icon or Fullscreen button to enter full-screen mode. While in full-screen or focused mode, use the Arrow keys (←, →, ↑, ↓) to smoothly move your view left/right and up/down (hold Shift for faster panning). Press O to toggle Pure View (hiding HUD and cursor). In Pure View, press P to toggle mouse panning (pan ⇄ none) or press I to toggle the pointer sphere (sphere ⇄ none), cycling between none | pan | sphere.',
              },
            ],
          },
          {
            title: '2. Moons, Shards & Eclipses',
            subtitle: 'Vaelis, Tears of Vaelis, Morvath, and Solar Eclipses',
            sections: [
              {
                heading: 'Vaelis & Tears of Vaelis (L4 / L5)',
                body: 'Vaelis is the bright silver primary moon (albedo 0.28). Trapped in its L4 (trailing) or L5 (leading) Lagrange pocket is the Tears of Vaelis — a 30° arc of 44 reflective shards. You can switch between L4 and L5 in the ⚙️ Orbits drawer.',
              },
              {
                heading: 'Morvath (The Black Moon)',
                body: 'Morvath orbits farther out in a retrograde 113-day orbit with ultra-dark carbonaceous rock (albedo 0.03). It hides starlight behind its disc and flares into an ember-ash glow only near exact opposition ("Ash-Full").',
              },
              {
                heading: 'Solar Eclipses & Auto-Slow / Pause',
                body: 'Vaelis (0.28° radius) can fully cover Solis (0.265°) for a Total Solar Eclipse. Smaller Morvath (0.22°) produces partial or annular ("ring of fire") eclipses up to ~69% coverage. Use 🌑 Eclipse: Off / Slow / Pause in the playback bar, or Alt+← / Alt+→ to jump between eclipses.',
              },
            ],
          },
          {
            title: '3. Glare Washout (Lunar & Solar)',
            subtitle: 'Why bright moons and the sun hide nearby stars & dark moons',
            sections: [
              {
                heading: 'On Earth & In Vaelora: Atmospheric Glare',
                body: 'Just as Earth’s Full Moon drowns out nearby stars, sunlight reflecting off bright Vaelis scatters in the atmosphere to create a luminous halo. Combined with human eye adaptation and veiling glare, faint stars and dim objects within several degrees of a bright moon become invisible.',
              },
              {
                heading: 'Shadowed Crown Conjunction & Morvath',
                body: 'Even during an Ash-Full opposition surge, Vaelis is far brighter than Morvath. When they pass near each other in the sky, lunar glare washes out Morvath’s ember glow (and if their discs overlap, closer Vaelis occults outer Morvath).',
              },
              {
                heading: 'Using the 🔆 Washout Toggle',
                body: 'With 🔆 Washout ON (default), stars, Trojan shards, and Morvath dim realistically when near bright Vaelis or Solis (easing during a total solar eclipse). Turn 🔆 Washout OFF for a pure "planetarium" view where stars and Morvath remain visible even in daylight or right beside Full Vaelis.',
              },
            ],
          },
          {
            title: '4. Constellations, Deep-Sky & Omens',
            subtitle: 'Planetarium overlays, the Galaxy Cloud, Chrysalis Nebula, and Omen lore',
            sections: [
              {
                heading: 'The Astral River (Host Galaxy Cloud)',
                body: 'Spanning across the celestial sphere along an inclined galactic plane (inclination 58°, ascending node 64°) is The Astral River — the glowing starry disc of our host galaxy. Rendered as an ethereal, continuous cosmic mist, it features a warm stellar core bulge, billowing dust ribbons, and dark interstellar dust rifts. Direction indicators on the Orbital Plane show where the galaxy core lies in 3D space. Always visible as a fixed celestial backdrop.',
              },
              {
                heading: 'The Chrysalis Nebula (The Prismatic Veil)',
                body: 'Located at RA 218.0°, Dec +34.5° with an 8.2° × 5.0° span, this deep-sky celestial gem glows faintly at night as an ethereal, multi-hued misty gas cloud with an ionized rose core, cyan oxygen envelope, and cosmic violet halo. Indicated with a directional sightline on the Orbital Plane. Always visible as a fixed deep-sky feature.',
              },
              {
                heading: 'The Red Harbinger (12-Year Periodic Comet)',
                body: 'Every 12 years (appearing in Year 3 and Year 15), a terrifying pale red periodic comet sweeps through the night sky. Casting a sweeping crimson mist tail 8 times the width arc of the moon (~4.48° wide) across the heavens, it serves as a dreaded omen of war and upheaval for the people of Vaelora.',
              },
              {
                heading: 'Constellations & Non-Repeating Starfield',
                body: 'All 9 fixed constellations rotate with the sidereal sky. Field stars use area-weighted spherical sampling with separation rejection to eliminate lattice patterns, while allowing rare natural optical double / binary companion stars (<5% of stars, separation 0.12°–0.35°).',
              },
              {
                heading: 'Omen Badges & "go" Buttons',
                body: 'Active Omens in the header and upcoming events in the Jump to Omen bar are clickable badges. Click any badge to open its Lore Dialog containing both the In-World Description (to read to players) and Game Master Mechanics. Click the small "go" button next to an upcoming badge to jump straight to that date and time.',
              },
            ],
          },
          {
            title: '5. Complete Keyboard Shortcuts & Telemetry',
            subtitle: 'Full reference of all hotkeys, view controls, and engine telemetry',
            sections: [
              {
                heading: 'Unified View & Overlay Hotkeys',
                body: '[1] Ground View • [2] Surround View • [3] Focus Mode Cycle • [6] Celestial Body Names & Text • [7] Constellation Lines • [8] Constellation Pictures (Mythic Art) • [9] Trajectory Arcs • [0] Lunar & Solar Glare Washout • [V] Volcanic Eruption Glow.',
              },
              {
                heading: 'Targeting & Quick Select (Key: Y)',
                body: '[Y] Celestial Quick Select: Opens the quick targeting panel for all 9 constellations, moons, Solis, the Chrysalis Nebula, host galaxy core, and the 12-year comet. Subterranean items are dimmed; click any item to turn the camera to face it directly (even underground down to -85° with subterranean sight).',
              },
              {
                heading: 'Time & Celestial Playback',
                body: '[Space] Play / Pause simulation • [+] / [-] Step speed (1s/s, 1m/s, 15m/s, 1h/s, 4h/s, 1d/s) • [/] / [*] Step -1d / +1d • [ [ ] / [ ] ] Step -1 year / +1 year • [Alt+←] / [Alt+→] Jump to previous / next visible solar eclipse.',
              },
              {
                heading: 'Camera & Pure View Shortcuts',
                body: '[Arrow Keys] Pan view left/right & tilt up/down (hold Shift for 3× fast pan) • [O] Pure View (toggle UI and controls) • [P] Toggle mouse pan in Pure View (pan ⇄ none) • [I] Toggle pointer sphere in Pure View (shows crosshair while aiming, glowing sphere & trail while holding mouse button) • [?] Toggle this Help Dialog • [Esc] Close Dialog / Exit Focus Mode.',
              },
              {
                heading: 'Mouse Interaction',
                body: 'Left Drag: Look around in Ground View or pan Surround panorama • Mouse Wheel: Zoom in / zoom out (adjusts camera Field of View) • Click any body, eclipse badge, or omen badge for interactive lore dialogs.',
              },
              {
                heading: '📊 Perf Telemetry',
                body: 'Click 📊 Perf in the header to monitor live FPS, simulation/render/snapshot timings, heap memory allocation, GC sweeps, and object-pool reuse counts.',
              },
            ],
          },
        ];
        const current = pages[helpPageIndex] ?? pages[0];
        return (
          <div
            onClick={() => setShowHelpModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1010,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '640px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '10px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                color: '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#38bdf8' }}>{current.title}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{current.subtitle}</div>
                </div>
                <button
                  onClick={() => setShowHelpModal(false)}
                  style={{ ...stepBtnStyle, padding: '3px 8px', fontSize: '11px' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {pages.map((p, idx) => (
                  <button
                    key={p.title}
                    onClick={() => setHelpPageIndex(idx)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: helpPageIndex === idx ? '1px solid #38bdf8' : '1px solid #1e293b',
                      background: helpPageIndex === idx ? 'rgba(56, 189, 248, 0.14)' : '#020617',
                      color: helpPageIndex === idx ? '#bae6fd' : '#94a3b8',
                      fontSize: '10.5px',
                      fontWeight: helpPageIndex === idx ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {idx + 1}. {p.title.split('. ')[1]}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '55vh', overflowY: 'auto' }}>
                {current.sections.map((sec) => (
                  <div
                    key={sec.heading}
                    style={{
                      background: '#020617',
                      border: '1px solid #1e293b',
                      borderRadius: '7px',
                      padding: '9px 11px',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', marginBottom: '3px' }}>
                      {sec.heading}
                    </div>
                    <div style={{ fontSize: '11.5px', lineHeight: 1.5, color: '#cbd5e1' }}>{sec.body}</div>
                  </div>
                ))}
              </div>

              {/* Persistent Quick Hotkeys Strip (Visible across all pages) */}
              <div
                style={{
                  background: '#040914',
                  border: '1px solid #1e293b',
                  borderRadius: '7px',
                  padding: '7px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                  fontSize: '11px',
                  color: '#94a3b8',
                }}
              >
                <span style={{ fontWeight: 700, color: '#f8fafc', marginRight: '4px' }}>⌨️ Keys:</span>
                {[
                  { k: '1', l: 'Ground' },
                  { k: '2', l: 'Surround' },
                  { k: '3', l: 'Focus' },
                  { k: '4', l: 'Galaxy' },
                  { k: '5', l: 'Nebula' },
                  { k: '6', l: 'Names' },
                  { k: '7', l: 'Constellations' },
                  { k: '8', l: 'Mythic Art' },
                  { k: '9', l: 'Arcs' },
                  { k: '0', l: 'Washout' },
                  { k: '?', l: 'Help' },
                  { k: 'Space', l: 'Play' },
                  { k: '+/-', l: 'Speed' },
                  { k: 'O', l: 'Pure View' },
                  { k: 'P', l: 'Pan' },
                  { k: 'I', l: 'Pointer' },
                  { k: 'Arrows', l: 'Look' },
                  { k: 'Esc', l: 'Close' },
                ].map((item) => (
                  <span
                    key={item.k}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '4px',
                      padding: '1px 5px',
                    }}
                  >
                    <kbd style={{ fontFamily: 'monospace', fontWeight: 700, color: '#38bdf8' }}>{item.k}</kbd>
                    <span style={{ color: '#cbd5e1', fontSize: '10px' }}>{item.l}</span>
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Page {helpPageIndex + 1} of {pages.length}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setHelpPageIndex((i) => Math.max(0, i - 1))}
                    disabled={helpPageIndex === 0}
                    style={{
                      ...stepBtnStyle,
                      padding: '4px 10px',
                      fontSize: '11px',
                      opacity: helpPageIndex === 0 ? 0.4 : 1,
                    }}
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setHelpPageIndex((i) => Math.min(pages.length - 1, i + 1))}
                    disabled={helpPageIndex === pages.length - 1}
                    style={{
                      ...stepBtnStyle,
                      padding: '4px 10px',
                      fontSize: '11px',
                      opacity: helpPageIndex === pages.length - 1 ? 0.4 : 1,
                    }}
                  >
                    Next →
                  </button>
                  <button
                    onClick={() => setShowHelpModal(false)}
                    style={{ ...stepBtnStyle, padding: '4px 10px', fontSize: '11px' }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// ============================================================================
// 1A. Ground (Character Perspective) Sky Renderer
// ============================================================================

/**
 * Returns 0..1 visibility multiplier accounting for atmospheric & ocular glare
 * near bright Vaelis (lunar washout) and Solis (solar washout).
 */
function computeGlareWashoutFactor(
  east: number,
  north: number,
  up: number,
  snapshot: CelestialSnapshot,
  enabled: boolean
): number {
  if (!enabled) return 1;
  let factor = 1;

  // Lunar glare washout from bright Primary Moon (Vaelis)
  const pm = snapshot.primaryMoon;
  if (pm.sky.aboveHorizon && pm.phaseFraction > 0.12) {
    const dot = Math.max(-1, Math.min(1, east * pm.sky.east + north * pm.sky.north + up * pm.sky.up));
    const sepDeg = Math.acos(dot) * (180 / Math.PI);
    const glareRadiusDeg = 2.5 + 11.5 * Math.pow(pm.phaseFraction, 0.85);
    if (sepDeg < glareRadiusDeg) {
      const lunarAtten = Math.pow(sepDeg / glareRadiusDeg, 1.8);
      if (lunarAtten < factor) factor = lunarAtten;
    }
  }

  // Solar glare washout from Solis (eases during total solar eclipse)
  const sun = snapshot.sun;
  if (sun.sky.altitudeDeg > -6) {
    const dot = Math.max(-1, Math.min(1, east * sun.sky.east + north * sun.sky.north + up * sun.sky.up));
    const sepDeg = Math.acos(dot) * (180 / Math.PI);
    const solarRadiusDeg = 18 * Math.max(0.25, 1 - sun.eclipseFraction * 0.75);
    if (sepDeg < solarRadiusDeg) {
      const solarAtten = Math.pow(sepDeg / solarRadiusDeg, 1.6);
      if (solarAtten < factor) factor = solarAtten;
    }
  }

  return factor;
}

function drawVolcanicSkyVeilAndGlow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonLimitY: number,
  dayFactor: number,
  volcanic: VolcanicSkySample | undefined,
  projectAzAlt: (az: number, alt: number, marginPx?: number) => { x: number; y: number; visible: boolean }
): void {
  if (!volcanic) return;
  if (volcanic.overheadVeil > 0.03) {
    const v = volcanic.overheadVeil;
    const veilGrad = ctx.createLinearGradient(0, 0, 0, horizonLimitY);
    const zenithSoot = dayFactor > 0.35 ? `rgba(52, 46, 48, ${v * 0.78})` : `rgba(28, 22, 26, ${v * 0.72})`;
    const midSoot = dayFactor > 0.35 ? `rgba(88, 62, 54, ${v * 0.68})` : `rgba(58, 30, 28, ${v * 0.56})`;
    const lowSoot = `rgba(120, 53, 32, ${v * 0.52})`;
    veilGrad.addColorStop(0, zenithSoot);
    veilGrad.addColorStop(0.6, midSoot);
    veilGrad.addColorStop(1, lowSoot);
    ctx.fillStyle = veilGrad;
    ctx.fillRect(0, 0, w, horizonLimitY);
  }
  if (volcanic.horizonGlowStrength > 0.04) {
    const gp = projectAzAlt(volcanic.horizonGlowAzimuthDeg, 2, Math.max(140, w * 0.45));
    if (gp.visible) {
      const s = volcanic.horizonGlowStrength * (1 - dayFactor * 0.42);
      const rad = Math.max(120, w * 0.42);
      const glow = ctx.createRadialGradient(gp.x, gp.y, 8, gp.x, gp.y, rad);
      glow.addColorStop(0, `rgba(249, 115, 22, ${Math.min(0.75, s * 0.95)})`);
      glow.addColorStop(0.38, `rgba(185, 28, 28, ${Math.min(0.55, s * 0.62)})`);
      glow.addColorStop(0.75, `rgba(69, 10, 10, ${Math.min(0.32, s * 0.3)})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function drawSunDiscWithVolcanicVeil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sunRadPx: number,
  coronaMult: number,
  overheadVeil: number
): void {
  const v = Math.max(0, Math.min(1, overheadVeil));
  const corona = ctx.createRadialGradient(x, y, sunRadPx * 0.6, x, y, sunRadPx * coronaMult);
  corona.addColorStop(0, v > 0.2 ? `rgba(251, 146, 60, ${0.85 - v * 0.25})` : 'rgba(254, 249, 195, 0.85)');
  corona.addColorStop(0.35, v > 0.2 ? `rgba(220, 38, 38, ${0.36 * (1 - v * 0.2)})` : 'rgba(253, 224, 71, 0.32)');
  corona.addColorStop(1, 'rgba(253, 224, 71, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(x, y, sunRadPx * coronaMult, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = lerpHex('#fef9c3', '#dc2626', Math.min(0.88, v * 1.1));
  ctx.beginPath();
  ctx.arc(x, y, sunRadPx, 0, Math.PI * 2);
  ctx.fill();
}

function renderGroundCharacterView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snapshot: CelestialSnapshot,
  config: CelestialWorldConfig,
  stars: FixedStar[],
  dailyArcs: {
    sun: { azimuthDeg: number; altitudeDeg: number }[];
    primary: { azimuthDeg: number; altitudeDeg: number }[];
    black: { azimuthDeg: number; altitudeDeg: number }[];
  } | null,
  lookAzDeg: number,
  lookPitchDeg: number,
  vFovDeg = 70,
  constellationsAlpha = 1,
  mythicArtAlpha = 1,
  arcsAlpha = 1,
  bodyNamesAlpha = 1,
  showHudLabels = true,
  showGlareWashout = true,
  galaxyAlpha = 1,
  nebulaAlpha = 1,
  volcanicSky?: VolcanicSkySample,
  twinkleTimeSec = 0,
  twinkleStrength = 0
) {
  const isUnderground = lookPitchDeg < -5;
  const azRad = lookAzDeg * DEG_TO_RAD;
  const pitchRad = lookPitchDeg * DEG_TO_RAD;

  // Orthonormal camera basis in (east, north, up)
  const fx = Math.cos(pitchRad) * Math.sin(azRad);
  const fy = Math.cos(pitchRad) * Math.cos(azRad);
  const fz = Math.sin(pitchRad);

  const rx = Math.cos(azRad);
  const ry = -Math.sin(azRad);
  const rz = 0;

  const ux = -Math.sin(azRad) * Math.sin(pitchRad);
  const uy = -Math.cos(azRad) * Math.sin(pitchRad);
  const uz = Math.cos(pitchRad);

  const vFovRad = vFovDeg * DEG_TO_RAD;
  const focalPx = (h * 0.5) / Math.tan(vFovRad * 0.5);

  const projectUnitVec = (e: number, n: number, u: number, marginPx = 60): { x: number; y: number; visible: boolean } => {
    const zCam = e * fx + n * fy + u * fz;
    if (zCam <= 0.04) return { x: 0, y: 0, visible: false };
    const xCam = e * rx + n * ry + u * rz;
    const yCam = e * ux + n * uy + u * uz;
    const x = w * 0.5 + (xCam / zCam) * focalPx;
    const y = h * 0.5 - (yCam / zCam) * focalPx;
    const inBounds = x >= -marginPx && x <= w + marginPx && y >= -marginPx && y <= h + marginPx;
    return { x, y, visible: inBounds };
  };

  const projectAzAlt = (az: number, alt: number, marginPx = 60) => {
    const aR = az * DEG_TO_RAD;
    const lR = alt * DEG_TO_RAD;
    const cL = Math.cos(lR);
    return projectUnitVec(cL * Math.sin(aR), cL * Math.cos(aR), Math.sin(lR), marginPx);
  };

  // 1. Atmospheric sky background
  const sunAlt = snapshot.sun.sky.altitudeDeg;
  const eclipseDim = 1 - snapshot.sun.eclipseFraction * 0.88;
  const dayFactor = Math.max(0, Math.min(1, (sunAlt + 6) / 18)) * eclipseDim;
  const twilightFactor = Math.max(0, Math.min(1, 1 - Math.abs(sunAlt + 3.5) / 7.5));
  const nightMoonWash = snapshot.lighting.nightIllumination * 0.35;

  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  if (dayFactor > 0.6) {
    skyGrad.addColorStop(0, lerpHex('#07142b', '#0c4a6e', dayFactor));
    skyGrad.addColorStop(0.65, lerpHex('#0f1f3d', '#0284c7', dayFactor));
    skyGrad.addColorStop(1, lerpHex('#1e293b', '#bae6fd', dayFactor));
  } else {
    skyGrad.addColorStop(0, lerpHex('#02050d', '#0c1d36', nightMoonWash + dayFactor * 0.8));
    skyGrad.addColorStop(
      0.65,
      lerpHex('#060d1f', '#1e3a5f', nightMoonWash + twilightFactor * 0.35 + dayFactor)
    );
    skyGrad.addColorStop(
      1,
      twilightFactor > 0.08
        ? lerpHex('#0f172a', '#9a3412', twilightFactor * 0.85)
        : lerpHex('#0a1428', '#1e3a5f', nightMoonWash)
    );
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  // Dawn/Dusk glow at sun's horizon direction
  if (sunAlt > -12 && sunAlt < 16) {
    const sp = projectAzAlt(snapshot.sun.sky.azimuthDeg, Math.max(0, sunAlt), w * 0.45);
    if (sp.visible) {
      const glowStrength = Math.max(0, 1 - Math.abs(sunAlt - 1) / 13) * 0.5 * eclipseDim;
      const dawnGrad = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, w * 0.4);
      dawnGrad.addColorStop(0, `rgba(251, 146, 60, ${glowStrength})`);
      dawnGrad.addColorStop(0.5, `rgba(244, 63, 94, ${glowStrength * 0.38})`);
      dawnGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dawnGrad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  const overheadVeil = volcanicSky?.overheadVeil ?? 0;
  drawVolcanicSkyVeilAndGlow(ctx, w, h, h, dayFactor, volcanicSky, projectAzAlt);

  const degToPx = focalPx * DEG_TO_RAD;
  const cometVisibility = computeCometSkyVisibility(
    sunAlt,
    snapshot.sun.eclipseFraction,
    overheadVeil,
    showGlareWashout
  );
  // 12-Year Periodic Comet (The Red Harbinger — faintly visible by day, brightest at night)
  drawComet(
    ctx,
    snapshot,
    (e, n, u) => projectUnitVec(e, n, u, Math.max(w, h) * 0.9),
    degToPx,
    cometVisibility,
    showGlareWashout,
    bodyNamesAlpha,
    isUnderground
  );

  // 2. Stars + Constellations + Ghostly Planetarium Art + Galaxy Cloud & Nebula
  const baseStarVis = Math.max(0, Math.min(1, (-sunAlt + 2) / 10)) * (1 - snapshot.lighting.nightIllumination * 0.22);
  const starVisibility = (showGlareWashout ? baseStarVis : Math.max(0.55, baseStarVis)) * (1 - overheadVeil * 0.85);
  if (starVisibility > 0.02) {
    const galaxyMarginPx = Math.max(180, 34 * degToPx);
    const nebulaMarginPx = Math.max(140, 22 * degToPx);

    // Alien host Galaxy Cloud (The Astral River)
    drawGalaxyCloud(
      ctx,
      snapshot,
      (sky) => projectUnitVec(sky.east, sky.north, sky.up, galaxyMarginPx),
      degToPx,
      starVisibility,
      showGlareWashout,
      galaxyAlpha
    );

    // Deep-sky coloured emission nebula (The Chrysalis Nebula)
    drawColouredNebula(
      ctx,
      snapshot,
      (sky) => projectUnitVec(sky.east, sky.north, sky.up, nebulaMarginPx),
      degToPx,
      starVisibility,
      showGlareWashout,
      bodyNamesAlpha,
      nebulaAlpha
    );

    for (const s of stars) {
      const hor = starRaDecToHorizontal(s.raRad, s.decRad, snapshot.localSiderealRad, snapshot.latitudeDeg);
      if (!isUnderground && hor.altitudeDeg <= 0.2) continue;
      const p = projectUnitVec(hor.east, hor.north, hor.up);
      if (!p.visible) continue;
      const glare = computeGlareWashoutFactor(hor.east, hor.north, hor.up, snapshot, showGlareWashout);
      const twinkle = computeStarTwinkleFactor(s.raRad, s.decRad, hor.altitudeDeg, twinkleTimeSec, twinkleStrength);
      const magLum = computeStarPinpointLuminance(s.mag);
      const alpha = (hor.altitudeDeg <= 0.2 ? 0.35 : 1) * starVisibility * glare * magLum * twinkle.alphaMul;
      if (alpha <= 0.015) continue;
      ctx.fillStyle = s.tint;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    drawConstellationsOverlay(
      ctx,
      snapshot,
      (sky) => projectUnitVec(sky.east, sky.north, sky.up, Math.max(320, w * 0.65)),
      starVisibility,
      constellationsAlpha,
      mythicArtAlpha,
      false,
      isUnderground
    );
  }

  // 3. Trajectory Arcs
  if (dailyArcs && arcsAlpha > 0.005) {
    ctx.save();
    ctx.globalAlpha = arcsAlpha;
    drawProjectedArc(ctx, dailyArcs.sun, projectAzAlt, 'rgba(250, 204, 21, 0.24)');
    drawProjectedArc(ctx, dailyArcs.primary, projectAzAlt, 'rgba(186, 230, 253, 0.28)');
    if (config.blackMoon.enabled) {
      drawProjectedArc(ctx, dailyArcs.black, projectAzAlt, 'rgba(248, 113, 113, 0.22)');
    }
    ctx.restore();
  }

  // 4. Sun
  if (snapshot.sun.sky.altitudeDeg > -2 || (isUnderground && snapshot.sun.sky.altitudeDeg <= -2)) {
    const sp = projectUnitVec(snapshot.sun.sky.east, snapshot.sun.sky.north, snapshot.sun.sky.up);
    if (sp.visible) {
      if (snapshot.sun.sky.altitudeDeg <= -2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(254, 240, 138, 0.15)';
        ctx.fill();
        if (bodyNamesAlpha > 0.005) {
          ctx.fillStyle = '#fef08a';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(`☀️ ${config.sunName} (Underground ${Math.round(snapshot.sun.sky.altitudeDeg)}°)`, sp.x + 18, sp.y + 4);
        }
        ctx.restore();
      } else {
        drawSunDiscWithVolcanicVeil(ctx, sp.x, sp.y, 18, 4.5, overheadVeil);
      }
    }
  }

  // 5. Distant Black Moon
  if (config.blackMoon.enabled && (snapshot.blackMoon.sky.altitudeDeg > -2 || (isUnderground && snapshot.blackMoon.sky.altitudeDeg <= -2))) {
    const bp = projectUnitVec(snapshot.blackMoon.sky.east, snapshot.blackMoon.sky.north, snapshot.blackMoon.sky.up);
    if (bp.visible) {
      if (snapshot.blackMoon.sky.altitudeDeg <= -2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(248, 113, 113, 0.15)';
        ctx.fill();
        if (bodyNamesAlpha > 0.005) {
          ctx.fillStyle = '#fca5a5';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(`🌑 ${config.blackMoon.name.split(' ')[0]} (Underground ${Math.round(snapshot.blackMoon.sky.altitudeDeg)}°)`, bp.x + 16, bp.y + 4);
        }
        ctx.restore();
      } else {
        const bmRadPx = 14.5;
        const isAsh = snapshot.blackMoon.isAshFull;
        const isSolarEclipseSilhouette = snapshot.sun.eclipsedBy === 'black' && snapshot.sun.eclipseFraction > 0.02;
        const bmGlare = isSolarEclipseSilhouette
          ? 1
          : computeGlareWashoutFactor(
              snapshot.blackMoon.sky.east,
              snapshot.blackMoon.sky.north,
              snapshot.blackMoon.sky.up,
              snapshot,
              showGlareWashout
            );
        if (bmGlare > 0.03) {
          ctx.save();
          ctx.globalAlpha = bmGlare;
          drawPhaseMoonDisc(
            ctx,
            bp.x,
            bp.y,
            bmRadPx,
            snapshot.blackMoon.phaseFraction,
            snapshot.blackMoon.brightLimbAngleRad,
            {
              darkColor: '#03050a',
              litColor: isAsh ? '#8c4638' : 'rgba(62, 72, 88, 0.24)',
              rimColor: showHudLabels ? (isAsh ? 'rgba(248, 113, 113, 0.6)' : 'rgba(100, 116, 139, 0.3)') : undefined,
            }
          );
          ctx.restore();
        }
        if (bodyNamesAlpha > 0.005 && bmGlare > 0.12) {
          ctx.save();
          ctx.globalAlpha = bodyNamesAlpha * bmGlare;
          ctx.fillStyle = isAsh ? 'rgba(254, 202, 202, 0.92)' : 'rgba(148, 163, 184, 0.7)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(config.blackMoon.name.split(' ')[0], bp.x + bmRadPx + 5, bp.y + 4);
          ctx.restore();
        }
      }
    }
  }

  // 6. L5 Trojan Shards + Weeping Sky Meteor Streaks
  if (config.trojanCluster.enabled) {
    const coreP = projectUnitVec(
      snapshot.trojanCluster.coreSky.east,
      snapshot.trojanCluster.coreSky.north,
      snapshot.trojanCluster.coreSky.up
    );
    const nightBoost = Math.max(0.18, 1 - dayFactor * 0.85);

    for (const shard of snapshot.trojanCluster.shards) {
      if (!isUnderground && shard.sky.altitudeDeg <= 0) continue;
      const sp = projectUnitVec(shard.sky.east, shard.sky.north, shard.sky.up);
      if (!sp.visible) continue;
      const r = 1.0 + shard.relativeSize * 2.4;
      ctx.globalAlpha = Math.min(1, shard.brightness * nightBoost * (shard.sky.altitudeDeg <= 0 ? 0.45 : 1));
      ctx.fillStyle = shard.relativeSize > 0.72 ? '#f0f9ff' : '#bae6fd';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (snapshot.trojanCluster.meteorActivity > 0.3 && starVisibility > 0.45 && coreP.visible) {
      const count = Math.ceil(snapshot.trojanCluster.meteorActivity * 3);
      for (let m = 0; m < count; m++) {
        const seedPhase = (snapshot.worldHours * 7.3 + m * 2.1) % 1;
        const angle = 0.55 + m * 0.38;
        const startX = coreP.x + (m - 1) * 32 + seedPhase * 42;
        const startY = coreP.y + m * 11 + seedPhase * 22;
        const len = 32 + 28 * snapshot.trojanCluster.meteorActivity;
        const mGrad = ctx.createLinearGradient(
          startX,
          startY,
          startX + Math.cos(angle) * len,
          startY + Math.sin(angle) * len
        );
        mGrad.addColorStop(0, 'rgba(224, 242, 254, 0)');
        mGrad.addColorStop(1, 'rgba(224, 242, 254, 0.8)');
        ctx.strokeStyle = mGrad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + Math.cos(angle) * len, startY + Math.sin(angle) * len);
        ctx.stroke();
      }
    }
  }

  // 7. Primary Silver Moon
  if (snapshot.primaryMoon.sky.altitudeDeg > -2 || (isUnderground && snapshot.primaryMoon.sky.altitudeDeg <= -2)) {
    const mp = projectUnitVec(
      snapshot.primaryMoon.sky.east,
      snapshot.primaryMoon.sky.north,
      snapshot.primaryMoon.sky.up
    );
    if (mp.visible) {
      if (snapshot.primaryMoon.sky.altitudeDeg <= -2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(186, 230, 253, 0.15)';
        ctx.fill();
        if (bodyNamesAlpha > 0.005) {
          ctx.fillStyle = '#bae6fd';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(`🌙 ${snapshot.primaryMoon.name} (Underground ${Math.round(snapshot.primaryMoon.sky.altitudeDeg)}°)`, mp.x + 18, mp.y + 4);
        }
        ctx.restore();
      } else {
        const pmRadPx = 18.5;
        drawPhaseMoonDisc(
          ctx,
          mp.x,
          mp.y,
          pmRadPx,
          snapshot.primaryMoon.phaseFraction,
          snapshot.primaryMoon.brightLimbAngleRad,
          {
            darkColor: '#0b1324',
            litColor: '#f1f5f9',
            rimColor: showHudLabels ? 'rgba(148, 163, 184, 0.32)' : undefined,
            mottle: true,
          }
        );
        if (bodyNamesAlpha > 0.005) {
          ctx.save();
          ctx.globalAlpha = bodyNamesAlpha;
          ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.fillText(snapshot.primaryMoon.name, mp.x + pmRadPx + 6, mp.y + 4);
          ctx.restore();
        }
      }
    }
  }

  // 8. Ground / Terrain Foreground below the projected horizon (0° altitude)
  const ridgePoints: { x: number; y: number }[] = [];
  for (let dAz = -125; dAz <= 125; dAz += 1.5) {
    const az = ((lookAzDeg + dAz) % 360 + 360) % 360;
    const azR = az * DEG_TO_RAD;
    const ridgeAlt =
      Math.sin(azR * 3.0) * 1.1 +
      Math.cos(azR * 7.0 + 1.2) * 0.65 +
      Math.sin(azR * 15.0) * 0.25 +
      1.3;
    const pt = projectAzAlt(az, ridgeAlt);
    if (pt.visible) ridgePoints.push({ x: pt.x, y: pt.y });
  }

  if (ridgePoints.length >= 2) {
    ridgePoints.sort((a, b) => a.x - b.x);
    const firstX = Math.min(-40, ridgePoints[0].x);
    const lastX = Math.max(w + 40, ridgePoints[ridgePoints.length - 1].x);
    const groundColor = lerpHex('#050b16', '#1e293b', dayFactor * 0.72 + snapshot.lighting.nightIllumination * 0.18);
    ctx.save();
    // When looking underground, ground becomes semi-transparent ethereal veil
    ctx.globalAlpha = isUnderground ? 0.45 : 1.0;
    ctx.fillStyle = groundColor;
    ctx.beginPath();
    ctx.moveTo(firstX, h + 40);
    ctx.lineTo(firstX, ridgePoints[0].y);
    for (const pt of ridgePoints) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineTo(lastX, ridgePoints[ridgePoints.length - 1].y);
    ctx.lineTo(lastX, h + 40);
    ctx.closePath();
    ctx.fill();

    if (showHudLabels) {
      ctx.strokeStyle = isUnderground ? 'rgba(56, 189, 248, 0.45)' : 'rgba(100, 116, 139, 0.45)';
      ctx.lineWidth = isUnderground ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(firstX, ridgePoints[0].y);
      for (const pt of ridgePoints) ctx.lineTo(pt.x, pt.y);
      ctx.lineTo(lastX, ridgePoints[ridgePoints.length - 1].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Subterranean targeting reticle when looking underground
  if (isUnderground && showHudLabels) {
    ctx.save();
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.moveTo(cx - 38, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 38, cy);
    ctx.moveTo(cx, cy - 38);
    ctx.lineTo(cx, cy - 10);
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx, cy + 38);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`▼ SUBTERRANEAN SIGHT (${Math.round(lookPitchDeg)}°)`, cx, cy + 46);
    ctx.restore();
  }

  // Cardinal compass markers on the projected horizon
  if (showHudLabels) {
    const cardinals: Record<number, string> = {
      0: 'N',
      45: 'NE',
      90: 'E',
      135: 'SE',
      180: 'S',
      225: 'SW',
      270: 'W',
      315: 'NW',
    };
    ctx.textAlign = 'center';
    for (let az = 0; az < 360; az += 45) {
      const p = projectAzAlt(az, 0);
      if (!p.visible) continue;
      ctx.fillStyle = az % 90 === 0 ? '#f8fafc' : '#94a3b8';
      ctx.font = az % 90 === 0 ? 'bold 12px monospace' : '10px monospace';
      ctx.fillText(cardinals[az], p.x, Math.min(h - 10, p.y + 16));
    }
    ctx.textAlign = 'left';
  }
}

function drawProjectedArc(
  ctx: CanvasRenderingContext2D,
  pts: { azimuthDeg: number; altitudeDeg: number }[],
  projectAzAlt: (az: number, alt: number) => { x: number; y: number; visible: boolean },
  stroke: string
) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let penDown = false;
  let prevX = 0;
  let prevY = 0;

  for (const pt of pts) {
    if (pt.altitudeDeg < 0) {
      penDown = false;
      continue;
    }
    const p = projectAzAlt(pt.azimuthDeg, pt.altitudeDeg);
    if (!p.visible) {
      penDown = false;
      continue;
    }
    if (!penDown || Math.hypot(p.x - prevX, p.y - prevY) > 120) {
      ctx.moveTo(p.x, p.y);
      penDown = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
    prevX = p.x;
    prevY = p.y;
  }
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// 1B. Surround 210° Horizon Panorama Renderer
// ============================================================================

function renderSurroundPanoramaView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snapshot: CelestialSnapshot,
  config: CelestialWorldConfig,
  stars: FixedStar[],
  dailyArcs: {
    sun: { azimuthDeg: number; altitudeDeg: number }[];
    primary: { azimuthDeg: number; altitudeDeg: number }[];
    black: { azimuthDeg: number; altitudeDeg: number }[];
  } | null,
  centerAzDeg: number,
  fovDeg = 210,
  constellationsAlpha = 1,
  mythicArtAlpha = 1,
  arcsAlpha = 1,
  bodyNamesAlpha = 1,
  showHudLabels = true,
  showGlareWashout = true,
  galaxyAlpha = 1,
  nebulaAlpha = 1,
  volcanicSky?: VolcanicSkySample,
  twinkleTimeSec = 0,
  twinkleStrength = 0
) {
  const horizonY = h * 0.85;
  const maxAltDeg = 86;

  const projectAzAlt = (azDeg: number, altDeg: number, marginPx = 60): { x: number; y: number; visible: boolean } => {
    const dAz = wrapAngleDiffDeg(azDeg, centerAzDeg);
    const x = w * 0.5 + (dAz / fovDeg) * w;
    const y = horizonY - (altDeg / maxAltDeg) * (horizonY - 14);
    const marginDeg = Math.max(fovDeg * 0.06, (marginPx / Math.max(1, w)) * fovDeg);
    return { x, y, visible: Math.abs(dAz) <= fovDeg * 0.5 + marginDeg };
  };

  const sunAlt = snapshot.sun.sky.altitudeDeg;
  const eclipseDim = 1 - snapshot.sun.eclipseFraction * 0.88;
  const dayFactor = Math.max(0, Math.min(1, (sunAlt + 6) / 18)) * eclipseDim;
  const twilightFactor = Math.max(0, Math.min(1, 1 - Math.abs(sunAlt + 3.5) / 7.5));

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  if (dayFactor > 0.6) {
    skyGrad.addColorStop(0, lerpHex('#07142b', '#0c4a6e', dayFactor));
    skyGrad.addColorStop(0.55, lerpHex('#0f1f3d', '#0284c7', dayFactor));
    skyGrad.addColorStop(1, lerpHex('#1e293b', '#bae6fd', dayFactor));
  } else {
    const nightMoonWash = snapshot.lighting.nightIllumination * 0.35;
    skyGrad.addColorStop(0, lerpHex('#02050d', '#0c1d36', nightMoonWash + dayFactor * 0.8));
    skyGrad.addColorStop(
      0.65,
      lerpHex('#060d1f', '#1e3a5f', nightMoonWash + twilightFactor * 0.35 + dayFactor)
    );
    skyGrad.addColorStop(
      1,
      twilightFactor > 0.08
        ? lerpHex('#0f172a', '#9a3412', twilightFactor * 0.85)
        : lerpHex('#0a1428', '#1e3a5f', nightMoonWash)
    );
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, horizonY + 2);

  if (sunAlt > -12 && sunAlt < 16) {
    const sunProj = projectAzAlt(snapshot.sun.sky.azimuthDeg, Math.max(0, sunAlt), w * 0.4);
    if (sunProj.visible) {
      const glowStrength = Math.max(0, 1 - Math.abs(sunAlt - 1) / 13) * 0.55 * eclipseDim;
      const dawnGrad = ctx.createRadialGradient(sunProj.x, horizonY, 8, sunProj.x, horizonY, w * 0.36);
      dawnGrad.addColorStop(0, `rgba(251, 146, 60, ${glowStrength})`);
      dawnGrad.addColorStop(0.5, `rgba(244, 63, 94, ${glowStrength * 0.4})`);
      dawnGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dawnGrad;
      ctx.fillRect(0, 0, w, horizonY);
    }
  }

  const overheadVeil = volcanicSky?.overheadVeil ?? 0;
  drawVolcanicSkyVeilAndGlow(ctx, w, horizonY, horizonY, dayFactor, volcanicSky, projectAzAlt);

  const degToPx = w / fovDeg;
  const cometVisibility = computeCometSkyVisibility(
    sunAlt,
    snapshot.sun.eclipseFraction,
    overheadVeil,
    showGlareWashout
  );
  // 12-Year Periodic Comet (The Red Harbinger — faintly visible by day, brightest at night)
  drawComet(
    ctx,
    snapshot,
    (e, n, u) => {
      const az = ((Math.atan2(e, n) * (180 / Math.PI)) % 360 + 360) % 360;
      const alt = Math.asin(Math.max(-1, Math.min(1, u))) * (180 / Math.PI);
      return projectAzAlt(az, alt, Math.max(w, h) * 0.9);
    },
    degToPx,
    cometVisibility,
    showGlareWashout,
    bodyNamesAlpha,
    false
  );

  const baseStarVis = Math.max(0, Math.min(1, (-sunAlt + 2) / 10)) * (1 - snapshot.lighting.nightIllumination * 0.22);
  const starVisibility = (showGlareWashout ? baseStarVis : Math.max(0.55, baseStarVis)) * (1 - overheadVeil * 0.85);
  if (starVisibility > 0.02) {
    const projectSurroundCloud = (sky: SkyVectorHorizontal) => {
      if (sky.altitudeDeg <= -18) return { x: 0, y: 0, visible: false };
      const p = projectAzAlt(sky.azimuthDeg, sky.altitudeDeg);
      const marginPx = Math.max(180, 34 * degToPx);
      return { x: p.x, y: p.y, visible: p.x >= -marginPx && p.x <= w + marginPx };
    };

    // Alien host Galaxy Cloud (The Astral River)
    drawGalaxyCloud(
      ctx,
      snapshot,
      projectSurroundCloud,
      degToPx,
      starVisibility,
      showGlareWashout,
      galaxyAlpha
    );

    // Deep-sky coloured emission nebula (The Chrysalis Nebula)
    drawColouredNebula(
      ctx,
      snapshot,
      projectSurroundCloud,
      degToPx,
      starVisibility,
      showGlareWashout,
      bodyNamesAlpha,
      nebulaAlpha
    );

    for (const s of stars) {
      const hor = starRaDecToHorizontal(s.raRad, s.decRad, snapshot.localSiderealRad, snapshot.latitudeDeg);
      if (hor.altitudeDeg <= 0.2) continue;
      const p = projectAzAlt(hor.azimuthDeg, hor.altitudeDeg);
      if (!p.visible || p.y >= horizonY) continue;
      const glare = computeGlareWashoutFactor(hor.east, hor.north, hor.up, snapshot, showGlareWashout);
      const twinkle = computeStarTwinkleFactor(s.raRad, s.decRad, hor.altitudeDeg, twinkleTimeSec, twinkleStrength);
      const magLum = computeStarPinpointLuminance(s.mag);
      const alpha = starVisibility * glare * magLum * twinkle.alphaMul;
      if (alpha <= 0.015) continue;
      ctx.fillStyle = s.tint;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;

    drawConstellationsOverlay(
      ctx,
      snapshot,
      (sky) => {
        if (sky.altitudeDeg <= -28) return { x: 0, y: 0, visible: false };
        return projectAzAlt(sky.azimuthDeg, sky.altitudeDeg, Math.max(320, w * 0.65));
      },
      starVisibility,
      constellationsAlpha,
      mythicArtAlpha,
      false
    );
  }

  if (dailyArcs && arcsAlpha > 0.005) {
    ctx.save();
    ctx.globalAlpha = arcsAlpha;
    drawHorizonArc(ctx, dailyArcs.sun, projectAzAlt, horizonY, 'rgba(250, 204, 21, 0.22)');
    drawHorizonArc(ctx, dailyArcs.primary, projectAzAlt, horizonY, 'rgba(186, 230, 253, 0.25)');
    if (config.blackMoon.enabled) {
      drawHorizonArc(ctx, dailyArcs.black, projectAzAlt, horizonY, 'rgba(248, 113, 113, 0.2)');
    }
    ctx.restore();
  }

  if (snapshot.sun.sky.altitudeDeg > -3) {
    const sp = projectAzAlt(snapshot.sun.sky.azimuthDeg, snapshot.sun.sky.altitudeDeg);
    if (sp.visible) {
      drawSunDiscWithVolcanicVeil(ctx, sp.x, sp.y, 14, 4.2, overheadVeil);
    }
  }

  if (config.blackMoon.enabled && snapshot.blackMoon.sky.altitudeDeg > -2) {
    const bp = projectAzAlt(snapshot.blackMoon.sky.azimuthDeg, snapshot.blackMoon.sky.altitudeDeg);
    if (bp.visible) {
      const bmRadPx = 11.5;
      const isAsh = snapshot.blackMoon.isAshFull;
      const isSolarEclipseSilhouette = snapshot.sun.eclipsedBy === 'black' && snapshot.sun.eclipseFraction > 0.02;
      const bmGlare = isSolarEclipseSilhouette
        ? 1
        : computeGlareWashoutFactor(
            snapshot.blackMoon.sky.east,
            snapshot.blackMoon.sky.north,
            snapshot.blackMoon.sky.up,
            snapshot,
            showGlareWashout
          );
      if (bmGlare > 0.03) {
        ctx.save();
        ctx.globalAlpha = bmGlare;
        drawPhaseMoonDisc(
          ctx,
          bp.x,
          bp.y,
          bmRadPx,
          snapshot.blackMoon.phaseFraction,
          snapshot.blackMoon.brightLimbAngleRad,
          {
            darkColor: '#03050a',
            litColor: isAsh ? '#8c4638' : 'rgba(62, 72, 88, 0.24)',
            rimColor: showHudLabels ? (isAsh ? 'rgba(248, 113, 113, 0.55)' : 'rgba(100, 116, 139, 0.28)') : undefined,
          }
        );
        ctx.restore();
      }
      if (bodyNamesAlpha > 0.005 && bmGlare > 0.12) {
        ctx.save();
        ctx.globalAlpha = bodyNamesAlpha * bmGlare;
        ctx.fillStyle = isAsh ? 'rgba(254, 202, 202, 0.9)' : 'rgba(148, 163, 184, 0.65)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(config.blackMoon.name.split(' ')[0], bp.x + bmRadPx + 4, bp.y + 3);
        ctx.restore();
      }
    }
  }

  if (config.trojanCluster.enabled) {
    const nightBoost = Math.max(0.18, 1 - dayFactor * 0.85);

    for (const shard of snapshot.trojanCluster.shards) {
      if (shard.sky.altitudeDeg <= -0.5) continue;
      const sp = projectAzAlt(shard.sky.azimuthDeg, shard.sky.altitudeDeg);
      if (!sp.visible || sp.y >= horizonY + 1) continue;
      const r = 0.8 + shard.relativeSize * 1.9;
      ctx.globalAlpha = Math.min(1, shard.brightness * nightBoost);
      ctx.fillStyle = shard.relativeSize > 0.72 ? '#f0f9ff' : '#bae6fd';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (snapshot.primaryMoon.sky.altitudeDeg > -2) {
    const mp = projectAzAlt(snapshot.primaryMoon.sky.azimuthDeg, snapshot.primaryMoon.sky.altitudeDeg);
    if (mp.visible) {
      const pmRadPx = 14.5;
      drawPhaseMoonDisc(
        ctx,
        mp.x,
        mp.y,
        pmRadPx,
        snapshot.primaryMoon.phaseFraction,
        snapshot.primaryMoon.brightLimbAngleRad,
        {
          darkColor: '#0b1324',
          litColor: '#f1f5f9',
          rimColor: showHudLabels ? 'rgba(148, 163, 184, 0.3)' : undefined,
          mottle: true,
        }
      );
      if (bodyNamesAlpha > 0.005) {
        ctx.save();
        ctx.globalAlpha = bodyNamesAlpha;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(snapshot.primaryMoon.name, mp.x + pmRadPx + 5, mp.y + 3);
        ctx.restore();
      }
    }
  }

  ctx.fillStyle = lerpHex('#050b16', '#1e293b', dayFactor * 0.75 + snapshot.lighting.nightIllumination * 0.18);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) {
    const worldAz = (centerAzDeg + ((x - w * 0.5) / w) * fovDeg) * DEG_TO_RAD;
    const ridge =
      Math.sin(worldAz * 3.0) * 6 +
      Math.cos(worldAz * 7.0 + 1.2) * 3.5 +
      Math.sin(worldAz * 15.0) * 1.6 +
      7;
    ctx.lineTo(x, horizonY - ridge * 0.55);
  }
  const rightAz = (centerAzDeg + 0.5 * fovDeg) * DEG_TO_RAD;
  const rightRidge =
    Math.sin(rightAz * 3.0) * 6 +
    Math.cos(rightAz * 7.0 + 1.2) * 3.5 +
    Math.sin(rightAz * 15.0) * 1.6 +
    7;
  ctx.lineTo(w, horizonY - rightRidge * 0.55);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  if (showHudLabels) {
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    const cardinals: Record<number, string> = {
      0: 'N',
      45: 'NE',
      90: 'E',
      135: 'SE',
      180: 'S',
      225: 'SW',
      270: 'W',
      315: 'NW',
    };
    ctx.textAlign = 'center';
    for (let az = 0; az < 360; az += 15) {
      const p = projectAzAlt(az, 0);
      if (!p.visible) continue;
      const label = cardinals[az];
      ctx.strokeStyle = label ? '#94a3b8' : '#475569';
      ctx.beginPath();
      ctx.moveTo(p.x, horizonY);
      ctx.lineTo(p.x, horizonY + (label ? 6 : 3));
      ctx.stroke();

      if (label) {
        ctx.fillStyle = az % 90 === 0 ? '#f8fafc' : '#94a3b8';
        ctx.font = az % 90 === 0 ? 'bold 11px monospace' : '10px monospace';
        ctx.fillText(label, p.x, horizonY + 18);
      }
    }
    ctx.textAlign = 'left';
  }
}

function drawHorizonArc(
  ctx: CanvasRenderingContext2D,
  pts: { azimuthDeg: number; altitudeDeg: number }[],
  project: (az: number, alt: number) => { x: number; y: number; visible: boolean },
  horizonY: number,
  stroke: string
) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let penDown = false;
  let prevX = 0;

  for (const pt of pts) {
    if (pt.altitudeDeg < -0.5) {
      penDown = false;
      continue;
    }
    const p = project(pt.azimuthDeg, pt.altitudeDeg);
    if (!p.visible || p.y > horizonY) {
      penDown = false;
      continue;
    }
    if (!penDown || Math.abs(p.x - prevX) > 90) {
      ctx.moveTo(p.x, p.y);
      penDown = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
    prevX = p.x;
  }
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// Alien Galaxy Cloud (The Astral River) & Coloured Nebula (The Chrysalis Nebula)
// ============================================================================

/**
 * Renders the alien host Galaxy Cloud (The Astral River) as a continuous, faint cosmic mist
 * arching across the sky dome with continuous spline ribbons, flowing elongated wisps, and dark rifts.
 */
type ProjectedGalaxyPoint = { x: number; y: number; glare: number; node: GalaxyCloudNode; idx: number };

function clampUnitAlpha(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function collectVisibleGalaxyRuns(
  snapshot: CelestialSnapshot,
  projectSky: (sky: SkyVectorHorizontal) => { x: number; y: number; visible: boolean },
  degToPx: number,
  showGlareWashout: boolean
): ProjectedGalaxyPoint[][] {
  const projectedNodes = GALAXY_CLOUD.nodes.map((node, idx) => {
    const hor = starRaDecToHorizontal(
      node.raDeg * DEG_TO_RAD,
      node.decDeg * DEG_TO_RAD,
      snapshot.localSiderealRad,
      snapshot.latitudeDeg
    );
    const p = hor.altitudeDeg > -20 ? projectSky(hor) : { x: 0, y: 0, visible: false };
    const glare = computeGlareWashoutFactor(hor.east, hor.north, hor.up, snapshot, showGlareWashout);
    return { node, hor, p, glare, idx };
  });

  const runs: ProjectedGalaxyPoint[][] = [];
  let currentRun: ProjectedGalaxyPoint[] = [];
  const seamJumpThresholdPx = Math.max(280, 14 * degToPx);

  for (const curr of projectedNodes) {
    if (curr.p.visible && curr.hor.altitudeDeg > -16) {
      if (currentRun.length > 0) {
        const prev = currentRun[currentRun.length - 1];
        if (Math.hypot(curr.p.x - prev.x, curr.p.y - prev.y) > seamJumpThresholdPx) {
          if (currentRun.length >= 2) runs.push(currentRun);
          currentRun = [];
        }
      }
      currentRun.push({ x: curr.p.x, y: curr.p.y, glare: curr.glare, node: curr.node, idx: curr.idx });
    } else {
      if (currentRun.length >= 2) runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length >= 2) runs.push(currentRun);

  if (runs.length >= 2) {
    const firstRun = runs[0];
    const lastRun = runs[runs.length - 1];
    if (firstRun[0].idx === 0 && lastRun[lastRun.length - 1].idx === projectedNodes.length - 1) {
      const dist = Math.hypot(
        firstRun[0].x - lastRun[lastRun.length - 1].x,
        firstRun[0].y - lastRun[lastRun.length - 1].y
      );
      if (dist < seamJumpThresholdPx) {
        lastRun.push(...firstRun);
        runs.shift();
      }
    }
  }
  return runs;
}

function drawGalaxyMistStamp(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  angleRad: number,
  widthPx: number,
  heightPx: number,
  alpha: number
) {
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = clampUnitAlpha(alpha);
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.drawImage(image, -widthPx * 0.5, -heightPx * 0.5, widthPx, heightPx);
  ctx.restore();
}

function drawGalaxyMistRun(
  ctx: CanvasRenderingContext2D,
  run: ProjectedGalaxyPoint[],
  degToPx: number,
  totalAlpha: number
) {
  const mist = getQWorldSkyMistTextures();
  const runTangentAt = (idx: number): number => {
    const prev = run[Math.max(0, idx - 1)];
    const next = run[Math.min(run.length - 1, idx + 1)];
    return Math.atan2(next.y - prev.y, next.x - prev.x);
  };
  const runStepPxAt = (idx: number): number => {
    const prevIdx = Math.max(0, idx - 1);
    const nextIdx = Math.min(run.length - 1, idx + 1);
    const prev = run[prevIdx];
    const next = run[nextIdx];
    return Math.hypot(next.x - prev.x, next.y - prev.y) / Math.max(1, nextIdx - prevIdx);
  };

  for (let i = 0; i < run.length; i++) {
    const curr = run[i];
    const stampLenPx = Math.max(runStepPxAt(i) * 6.0, 16 * degToPx);
    drawGalaxyMistStamp(
      ctx,
      mist.galaxySpine,
      curr.x,
      curr.y,
      runTangentAt(i),
      stampLenPx,
      56 * degToPx,
      totalAlpha * curr.glare * 0.055
    );
  }

  const coreIdx = run.findIndex((p) => p.node.tint === '#fef3c7');
  if (coreIdx >= 0) {
    const corePt = run[coreIdx];
    drawGalaxyMistStamp(
      ctx,
      mist.galaxyCore,
      corePt.x,
      corePt.y,
      runTangentAt(coreIdx),
      115 * degToPx,
      52 * degToPx,
      totalAlpha * corePt.glare * 0.13
    );
  }

  for (let i = 0; i < run.length; i++) {
    const curr = run[i];
    if (curr.node.tint === '#64748b') {
      const riftLenPx = Math.max(runStepPxAt(i) * 5.2, 14 * degToPx);
      drawGalaxyMistStamp(
        ctx,
        mist.galaxyDarkRift,
        curr.x,
        curr.y,
        runTangentAt(i),
        riftLenPx,
        12 * degToPx,
        totalAlpha * curr.glare * 0.14
      );
      continue;
    }
    if (curr.idx % 3 !== 0 || curr.node.tint === '#fef3c7') continue;
    const patchImg = curr.node.tint === '#fae8ff' ? mist.galaxyPatchLavender : mist.galaxyPatchBlue;
    drawGalaxyMistStamp(
      ctx,
      patchImg,
      curr.x,
      curr.y,
      runTangentAt(i),
      curr.node.radiusDeg * degToPx * 7.8,
      curr.node.radiusDeg * degToPx * 1.6,
      curr.node.opacity * totalAlpha * curr.glare * 0.28
    );
  }
}

function drawGalaxyCloud(
  ctx: CanvasRenderingContext2D,
  snapshot: CelestialSnapshot,
  projectSky: (sky: SkyVectorHorizontal) => { x: number; y: number; visible: boolean },
  degToPx: number,
  starVisibility: number,
  showGlareWashout: boolean,
  galaxyAlpha = 1
) {
  if (galaxyAlpha <= 0.005 || starVisibility <= 0.02) return;
  const runs = collectVisibleGalaxyRuns(snapshot, projectSky, degToPx, showGlareWashout);
  if (runs.length === 0) return;

  ctx.save();
  const totalAlpha = starVisibility * galaxyAlpha;
  for (const run of runs) {
    drawGalaxyMistRun(ctx, run, degToPx, totalAlpha);
  }
  ctx.restore();
}

/**
 * Renders the single deep-sky coloured nebula (The Chrysalis Nebula) with multi-hued
 * ionized rose core, cyan filaments, outer violet halo, and embedded central star.
 */
function drawColouredNebula(
  ctx: CanvasRenderingContext2D,
  snapshot: CelestialSnapshot,
  projectSky: (sky: SkyVectorHorizontal) => { x: number; y: number; visible: boolean },
  degToPx: number,
  starVisibility: number,
  showGlareWashout: boolean,
  bodyNamesAlpha = 1,
  nebulaAlpha = 1
) {
  if (nebulaAlpha <= 0.005 || starVisibility <= 0.02) return;
  const neb = COLOURED_NEBULA;
  const hor = starRaDecToHorizontal(
    neb.centerRaDeg * DEG_TO_RAD,
    neb.centerDecDeg * DEG_TO_RAD,
    snapshot.localSiderealRad,
    snapshot.latitudeDeg
  );
  if (hor.altitudeDeg <= 0) return;
  const p = projectSky(hor);
  if (!p.visible) return;

  const glare = computeGlareWashoutFactor(hor.east, hor.north, hor.up, snapshot, showGlareWashout);
  const alpha = starVisibility * glare * nebulaAlpha;
  if (alpha <= 0.01) return;

  const mist = getQWorldSkyMistTextures();
  const rMajorPx = neb.radiusMajorDeg * degToPx;
  const rMinorPx = neb.radiusMinorDeg * degToPx;
  const nebW = rMajorPx * 3.8;
  const nebH = rMinorPx * 3.4;

  ctx.save();
  ctx.globalAlpha = clampUnitAlpha(alpha * 0.88);
  ctx.translate(p.x, p.y);
  ctx.rotate(neb.rotationDeg * DEG_TO_RAD);
  ctx.drawImage(mist.chrysalisNebula, -nebW * 0.5, -nebH * 0.5, nebW, nebH);
  ctx.restore();

  // Label when body names are toggled on
  if (bodyNamesAlpha > 0.005 && alpha > 0.18) {
    ctx.save();
    ctx.globalAlpha = bodyNamesAlpha * alpha;
    ctx.fillStyle = '#fbcfe8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(neb.name, p.x + rMajorPx * 0.65 + 4, p.y + 3);
    ctx.restore();
  }
}

/**
 * Renders the 12-year periodic comet (The Red Harbinger / The Bleeding Star)
 * featuring a pale red glowing coma and soft fading mist ion & dust tails
 * spanning 8 times the width arc of the moon across the sky, pointing away from Solis.
 */
function drawComet(
  ctx: CanvasRenderingContext2D,
  snapshot: CelestialSnapshot,
  projectUnitVec: (e: number, n: number, u: number) => { x: number; y: number; visible: boolean },
  degToPx: number,
  cometVisibility: number,
  showGlareWashout: boolean,
  bodyNamesAlpha = 1,
  allowUnderground = false
) {
  const comet = snapshot.comet;
  if (!comet || !comet.active) return;
  if (!allowUnderground && comet.sky.altitudeDeg < -40) return;

  const sunSky = snapshot.sun.sky;
  // Comet tail streams antisolar (directly away from Solis)
  let tE = comet.sky.east - sunSky.east;
  let tN = comet.sky.north - sunSky.north;
  let tU = comet.sky.up - sunSky.up;
  const tLen = Math.hypot(tE, tN, tU);
  if (tLen < 1e-4) {
    tE = 0;
    tN = 1;
    tU = 0;
  } else {
    tE /= tLen;
    tN /= tLen;
    tU /= tLen;
  }

  const tailLengthDeg = comet.tailLengthDeg;
  const tailWidthDeg = comet.tailWidthDeg;
  const stepRad = tailLengthDeg * DEG_TO_RAD;

  const projectSpineSample = (frac: number) => {
    const sinStep = Math.sin(stepRad * frac);
    const sx = comet.sky.east + sinStep * tE;
    const sy = comet.sky.north + sinStep * tN;
    const sz = comet.sky.up + sinStep * tU;
    const sLen = Math.hypot(sx, sy, sz) || 1;
    return { proj: projectUnitVec(sx / sLen, sy / sLen, sz / sLen), up: sz / sLen };
  };

  const cpRaw = projectUnitVec(comet.sky.east, comet.sky.north, comet.sky.up);
  const midSample = projectSpineSample(0.5);
  const tipSample = projectSpineSample(1.0);

  if (!cpRaw.visible && !midSample.proj.visible && !tipSample.proj.visible) return;
  if (!allowUnderground && comet.sky.up <= -0.03 && midSample.up <= -0.03 && tipSample.up <= -0.03) return;

  let cpX = cpRaw.x;
  let cpY = cpRaw.y;
  let dx = tE * tailLengthDeg * degToPx;
  let dy = -tU * tailLengthDeg * degToPx;

  if (cpRaw.visible && tipSample.proj.visible) {
    dx = tipSample.proj.x - cpX;
    dy = tipSample.proj.y - cpY;
  } else if (cpRaw.visible && midSample.proj.visible) {
    dx = (midSample.proj.x - cpX) * 2;
    dy = (midSample.proj.y - cpY) * 2;
  } else if (midSample.proj.visible && tipSample.proj.visible) {
    dx = (tipSample.proj.x - midSample.proj.x) * 2;
    dy = (tipSample.proj.y - midSample.proj.y) * 2;
    cpX = tipSample.proj.x - dx;
    cpY = tipSample.proj.y - dy;
  } else if (!cpRaw.visible) {
    if (tipSample.proj.visible) {
      cpX = tipSample.proj.x - dx;
      cpY = tipSample.proj.y - dy;
    } else {
      cpX = midSample.proj.x - dx * 0.5;
      cpY = midSample.proj.y - dy * 0.5;
    }
  }

  // Guard against panoramic 360° azimuth seam wrap
  if (Math.hypot(dx, dy) > Math.max(600, tailLengthDeg * degToPx * 2.5)) {
    dx = tE * tailLengthDeg * degToPx;
    dy = -tU * tailLengthDeg * degToPx;
  }

  const screenTailLen = Math.hypot(dx, dy);
  if (screenTailLen < 2) return;

  const tailAngle = Math.atan2(dy, dx);
  const tailWidthPx = Math.max(24, tailWidthDeg * degToPx);
  const mist = getQWorldSkyMistTextures();

  ctx.save();
  const rawGlare = computeGlareWashoutFactor(comet.sky.east, comet.sky.north, comet.sky.up, snapshot, showGlareWashout);
  const glare = Math.max(0.35, rawGlare);
  const cometAlpha =
    (allowUnderground && comet.sky.altitudeDeg < 0 ? 0.65 : 1.0) *
    cometVisibility *
    glare *
    (0.45 + 0.55 * comet.activityFraction);

  // 1. Broad Sweeping Crimson Dust & Ion Mist Plume (double moon-width spread)
  const drawLen = (screenTailLen * 1.18) / 0.90;
  const drawWidth = Math.max(32, tailWidthPx * 2.25);

  ctx.save();
  ctx.translate(cpX, cpY);
  ctx.rotate(tailAngle);
  ctx.globalAlpha = cometAlpha * 0.9;
  ctx.drawImage(mist.cometTailMist, -0.10 * drawLen, -0.5 * drawWidth, drawLen, drawWidth);

  // 2. Soft Luminous Inner Ion Mist fading smoothly away from the coma
  const innerLen = drawLen * 0.85;
  const innerWidth = drawWidth * 0.42;
  ctx.globalAlpha = cometAlpha * 0.6;
  ctx.drawImage(mist.cometTailMist, -0.10 * innerLen, -0.5 * innerWidth, innerLen, innerWidth);
  ctx.restore();

  // 3. Pale Red Glowing Coma & Stellar Nucleus
  ctx.globalAlpha = cometAlpha;
  const comaRad = Math.max(6, degToPx * 0.52);
  const comaGrad = ctx.createRadialGradient(cpX, cpY, 1, cpX, cpY, comaRad * 2.8);
  comaGrad.addColorStop(0, 'rgba(255, 241, 242, 0.95)');
  comaGrad.addColorStop(0.2, 'rgba(254, 205, 211, 0.85)');
  comaGrad.addColorStop(0.5, 'rgba(244, 63, 94, 0.45)');
  comaGrad.addColorStop(1, 'rgba(225, 29, 72, 0)');
  ctx.fillStyle = comaGrad;
  ctx.beginPath();
  ctx.arc(cpX, cpY, comaRad * 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Stellar nucleus point
  ctx.fillStyle = '#fff1f2';
  ctx.beginPath();
  ctx.arc(cpX, cpY, Math.max(1.8, comaRad * 0.28), 0, Math.PI * 2);
  ctx.fill();

  // 4. Label
  if (bodyNamesAlpha > 0.005 && cpRaw.visible) {
    ctx.globalAlpha = bodyNamesAlpha * cometAlpha;
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 11px system-ui, sans-serif';
    const labelText =
      allowUnderground && comet.sky.altitudeDeg < 0
        ? `☄️ ${comet.name} (Underground ${Math.round(comet.sky.altitudeDeg)}°)`
        : `☄️ ${comet.name}`;
    ctx.fillText(labelText, cpX + comaRad * 1.4, cpY + 4);
  }

  ctx.restore();
}

// ============================================================================
// Constellation Stars, Stick Figures & Ghostly Planetarium Art Renderer
// ============================================================================

function drawConstellationsOverlay(
  ctx: CanvasRenderingContext2D,
  snapshot: CelestialSnapshot,
  projectSky: (sky: SkyVectorHorizontal) => { x: number; y: number; visible: boolean },
  starVisibility: number,
  linesAlpha: number,
  artAlpha: number,
  compact: boolean,
  allowUnderground = false
) {
  if (linesAlpha <= 0.005 && artAlpha <= 0.005) return;
  ctx.save();

  for (const con of WORLD_CONSTELLATIONS) {
    const projectedStars = con.stars.map((st) => {
      const hor = starRaDecToHorizontal(
        st.raDeg * DEG_TO_RAD,
        st.decDeg * DEG_TO_RAD,
        snapshot.localSiderealRad,
        snapshot.latitudeDeg
      );
      const p = (hor.altitudeDeg > -28 || allowUnderground) ? projectSky(hor) : { x: 0, y: 0, visible: false };
      return { st, hor, p };
    });

    const visibleCount = projectedStars.filter((s) => s.p.visible).length;
    const anyStarAbove = allowUnderground || projectedStars.some((s) => s.hor.altitudeDeg > -2);
    if (visibleCount === 0 || !anyStarAbove) continue;

    // 1. Ghostly Planetarium Artwork (projected in exact sky coordinates so it rotates & zooms with the stars)
    if (artAlpha > 0.005) {
      ctx.save();
      for (const path of con.artPaths) {
        const pts = path.points.map(([u, v]) => {
          const hor = projectConstellationArtPoint(con, u, v, snapshot.localSiderealRad, snapshot.latitudeDeg);
          const proj = (hor.altitudeDeg > -28 || allowUnderground) ? projectSky(hor) : { x: 0, y: 0, visible: false };
          return { x: proj.x, y: proj.y, visible: proj.visible, alt: hor.altitudeDeg };
        });

        const hasAboveHorizon = allowUnderground || pts.some((pt) => pt.alt > -1);
        // Skip segments that wrap across panoramic edges
        let valid = hasAboveHorizon && pts.every((pt) => pt.visible);
        if (valid) {
          for (let i = 1; i < pts.length; i++) {
            if (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) > 420) {
              valid = false;
              break;
            }
          }
        }
        if (!valid || pts.length < 2) continue;

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        if (path.closed) ctx.closePath();

        if (path.closed && (path.fillAlpha ?? 0) > 0) {
          ctx.fillStyle = con.color;
          ctx.globalAlpha = starVisibility * artAlpha * (path.fillAlpha ?? 0.08);
          ctx.fill();
        }

        ctx.strokeStyle = con.color;
        ctx.globalAlpha = starVisibility * artAlpha * (compact ? 0.22 : 0.28);
        ctx.lineWidth = compact ? 1.0 : 1.4;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Constellation Stick Lines
    if (linesAlpha > 0.005) {
      ctx.save();
      ctx.strokeStyle = con.color;
      ctx.globalAlpha = starVisibility * linesAlpha * (compact ? 0.34 : 0.42);
      ctx.lineWidth = compact ? 0.8 : 1.0;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const [aIdx, bIdx] of con.edges) {
        const a = projectedStars[aIdx];
        const b = projectedStars[bIdx];
        if (!a || !b || !a.p.visible || !b.p.visible) continue;
        if (!allowUnderground && a.hor.altitudeDeg <= 0 && b.hor.altitudeDeg <= 0) continue;
        if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) > 420) continue;
        ctx.moveTo(a.p.x, a.p.y);
        ctx.lineTo(b.p.x, b.p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Constellation Label at Anchor Center
    if (linesAlpha > 0.005 && visibleCount >= 2) {
      const centerHor = starRaDecToHorizontal(
        con.centerRaDeg * DEG_TO_RAD,
        con.centerDecDeg * DEG_TO_RAD,
        snapshot.localSiderealRad,
        snapshot.latitudeDeg
      );
      if (centerHor.altitudeDeg > 2 || allowUnderground) {
        const cp = projectSky(centerHor);
        if (cp.visible) {
          ctx.fillStyle = con.color;
          ctx.globalAlpha = starVisibility * linesAlpha * (compact ? 0.65 : 0.78);
          ctx.font = compact ? '9px system-ui, sans-serif' : 'italic 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          const label = centerHor.altitudeDeg < 0 ? `${con.name} (Underground)` : con.name;
          ctx.fillText(label, cp.x, cp.y - (compact ? 6 : 10));
          ctx.textAlign = 'left';
        }
      }
    }
  }

  ctx.restore();
}

// ============================================================================
// 2. Zenith Star Dome Renderer
// ============================================================================

function renderZenithDome(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snapshot: CelestialSnapshot,
  config: CelestialWorldConfig,
  stars: FixedStar[],
  dailyArcs: {
    sun: { azimuthDeg: number; altitudeDeg: number }[];
    primary: { azimuthDeg: number; altitudeDeg: number }[];
    black: { azimuthDeg: number; altitudeDeg: number }[];
  } | null,
  constellationsAlpha = 1,
  mythicArtAlpha = 1,
  arcsAlpha = 1,
  bodyNamesAlpha = 1,
  galaxyAlpha = 1,
  nebulaAlpha = 1,
  volcanicSky?: VolcanicSkySample,
  twinkleTimeSec = 0,
  twinkleStrength = 0
) {
  ctx.fillStyle = '#040914';
  ctx.fillRect(0, 0, w, h);

  const domeCx = w * 0.5;
  const domeCy = h * 0.52;
  const domeR = Math.max(40, Math.min(w, h) * 0.41);
  const overheadVeil = volcanicSky?.overheadVeil ?? 0;

  const projectDome = (sky: { azimuthDeg: number; altitudeDeg: number }): { x: number; y: number } => {
    const r = ((90 - Math.max(0, sky.altitudeDeg)) / 90) * domeR;
    const azRad = sky.azimuthDeg * DEG_TO_RAD;
    return {
      x: domeCx + Math.sin(azRad) * r,
      y: domeCy - Math.cos(azRad) * r,
    };
  };

  const domeGrad = ctx.createRadialGradient(domeCx, domeCy, 4, domeCx, domeCy, domeR);
  domeGrad.addColorStop(0, lerpHex('#09152b', '#2b1b1d', overheadVeil * 0.85));
  domeGrad.addColorStop(1, lerpHex('#020617', '#3b1812', overheadVeil * 0.75));
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(domeCx, domeCy, domeR, 0, Math.PI * 2);
  ctx.fill();

  if ((volcanicSky?.horizonGlowStrength ?? 0) > 0.05) {
    const glowAz = ((volcanicSky!.horizonGlowAzimuthDeg - 90) * Math.PI) / 180;
    ctx.save();
    ctx.strokeStyle = `rgba(249, 115, 22, ${Math.min(0.75, volcanicSky!.horizonGlowStrength)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(domeCx, domeCy, domeR - 2, glowAz - 0.35, glowAz + 0.35);
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
  ctx.lineWidth = 1;
  for (const frac of [1, 2 / 3, 1 / 3]) {
    ctx.beginPath();
    ctx.arc(domeCx, domeCy, domeR * frac, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(domeCx - domeR, domeCy);
  ctx.lineTo(domeCx + domeR, domeCy);
  ctx.moveTo(domeCx, domeCy - domeR);
  ctx.lineTo(domeCx, domeCy + domeR);
  ctx.stroke();

  // Galaxy Cloud & Nebula within Dome perimeter
  ctx.save();
  ctx.beginPath();
  ctx.arc(domeCx, domeCy, domeR, 0, Math.PI * 2);
  ctx.clip();

  const projectDomeSky = (sky: SkyVectorHorizontal) => {
    if (sky.altitudeDeg < -18) return { x: 0, y: 0, visible: false };
    const r = ((90 - sky.altitudeDeg) / 90) * domeR;
    const azRad = sky.azimuthDeg * DEG_TO_RAD;
    return {
      x: domeCx + Math.sin(azRad) * r,
      y: domeCy - Math.cos(azRad) * r,
      visible: true,
    };
  };

  const domeDegToPx = domeR / 90;
  drawGalaxyCloud(ctx, snapshot, projectDomeSky, domeDegToPx, 0.55, false, galaxyAlpha);
  drawColouredNebula(ctx, snapshot, projectDomeSky, domeDegToPx, 0.92, false, bodyNamesAlpha, nebulaAlpha);
  drawComet(
    ctx,
    snapshot,
    (e, n, u) => {
      const az = ((Math.atan2(e, n) * (180 / Math.PI)) % 360 + 360) % 360;
      const alt = Math.asin(Math.max(-1, Math.min(1, u))) * (180 / Math.PI);
      if (alt < 0) return { x: 0, y: 0, visible: false };
      const p = projectDome({ azimuthDeg: az, altitudeDeg: alt });
      return { x: p.x, y: p.y, visible: true };
    },
    domeDegToPx,
    0.92,
    false,
    bodyNamesAlpha,
    false
  );

  ctx.restore();

  const domeStarScale = 1 - overheadVeil * 0.8;
  for (const s of stars) {
    const hor = starRaDecToHorizontal(s.raRad, s.decRad, snapshot.localSiderealRad, snapshot.latitudeDeg);
    if (hor.altitudeDeg <= 0) continue;
    const p = projectDome(hor);
    const twinkle = computeStarTwinkleFactor(s.raRad, s.decRad, hor.altitudeDeg, twinkleTimeSec, twinkleStrength);
    const magLum = computeStarPinpointLuminance(s.mag);
    const alpha = magLum * domeStarScale * twinkle.alphaMul;
    if (alpha <= 0.015) continue;
    ctx.fillStyle = s.tint;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }
  ctx.globalAlpha = 1;

  drawConstellationsOverlay(
    ctx,
    snapshot,
    (sky) => {
      if (sky.altitudeDeg <= 0) return { x: 0, y: 0, visible: false };
      const p = projectDome(sky);
      return { x: p.x, y: p.y, visible: true };
    },
    0.85,
    constellationsAlpha,
    mythicArtAlpha,
    true
  );

  if (dailyArcs && arcsAlpha > 0.005) {
    ctx.save();
    ctx.globalAlpha = arcsAlpha;
    const drawDomeArc = (pts: { azimuthDeg: number; altitudeDeg: number }[], color: string) => {
      ctx.strokeStyle = color;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      let started = false;
      for (const pt of pts) {
        if (pt.altitudeDeg < 0) {
          started = false;
          continue;
        }
        const p = projectDome(pt);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawDomeArc(dailyArcs.sun, 'rgba(250, 204, 21, 0.3)');
    drawDomeArc(dailyArcs.primary, 'rgba(186, 230, 253, 0.35)');
    if (config.blackMoon.enabled) drawDomeArc(dailyArcs.black, 'rgba(248, 113, 113, 0.3)');
    ctx.restore();
  }

  const plotDomeBody = (sky: SkyVectorHorizontal, color: string, r: number, ring?: string) => {
    if (!sky.aboveHorizon) return;
    const p = projectDome(sky);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (ring) {
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  for (const sh of snapshot.trojanCluster.shards) {
    if (!sh.sky.aboveHorizon) continue;
    const p = projectDome(sh.sky);
    ctx.fillStyle = 'rgba(186, 230, 253, 0.65)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  plotDomeBody(snapshot.sun.sky, '#fde047', 6.5, 'rgba(254, 240, 138, 0.5)');
  if (config.blackMoon.enabled) {
    plotDomeBody(
      snapshot.blackMoon.sky,
      snapshot.blackMoon.isAshFull ? '#991b1b' : '#090d16',
      5.5,
      snapshot.blackMoon.isAshFull ? '#f87171' : '#64748b'
    );
  }
  plotDomeBody(snapshot.primaryMoon.sky, '#f1f5f9', 6, '#38bdf8');

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', domeCx, domeCy - domeR - 5);
  ctx.fillText('S', domeCx, domeCy + domeR + 12);
  ctx.fillText('E', domeCx + domeR + 10, domeCy + 3);
  ctx.fillText('W', domeCx - domeR - 10, domeCy + 3);
  ctx.textAlign = 'left';
}

// ============================================================================
// 3. Top-Down Orbital Plane Renderer
// ============================================================================

function drawOrbitChevron(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  angleRad: number,
  ccwDir: 1 | -1,
  color: string
) {
  const px = cx + Math.cos(angleRad) * radius;
  const py = cy - Math.sin(angleRad) * radius;
  const tang = Math.atan2(-ccwDir * Math.cos(angleRad), -ccwDir * Math.sin(angleRad));
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(tang);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4, -3);
  ctx.lineTo(2, 0);
  ctx.lineTo(-4, 3);
  ctx.stroke();
  ctx.restore();
}

function drawOrbitalTrojanSwarm(
  ctx: CanvasRenderingContext2D,
  orbCx: number,
  orbCy: number,
  innerR: number,
  snapshot: CelestialSnapshot,
  config: CelestialWorldConfig
) {
  const pmAng = snapshot.primaryMoon.orbitalAngleRad;
  const lagSign = config.trojanCluster.lagrangePoint === 'L4' ? 1 : -1;
  const count = Math.min(config.trojanCluster.shardCount, 44);
  for (let i = 0; i < count; i++) {
    const u1 = ((i * 0.61803398875 + 0.17) % 1 + 1) % 1;
    const u2 = ((i * 0.75487766625 + 0.43) % 1 + 1) % 1;
    const u4 = ((i * 0.8191725133961644 + 0.37) % 1 + 1) % 1;
    const signed = u1 < 0.55 ? -(u1 / 0.55) * 0.42 : ((u1 - 0.55) / 0.45) * 0.58;
    const radialWeight = Math.pow(u2, 0.7);
    const lagOffsetDeg = signed * config.trojanCluster.arcSpreadDeg * (0.35 + 0.65 * radialWeight);
    const ang = pmAng + lagSign * (config.trojanCluster.lagCenterDeg + lagOffsetDeg) * DEG_TO_RAD;
    const r = innerR + (u4 * 2 - 1) * 3.8 * (1 - Math.abs(signed) * 0.45);
    const size = i < 5 ? 1.55 : 0.75 + (1 - Math.abs(signed)) * 0.55;
    ctx.fillStyle = i < 5 ? 'rgba(224, 242, 254, 0.92)' : 'rgba(186, 230, 253, 0.62)';
    ctx.beginPath();
    ctx.arc(orbCx + Math.cos(ang) * r, orbCy - Math.sin(ang) * r, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderOrbitalPlane(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  snapshot: CelestialSnapshot,
  config: CelestialWorldConfig,
  bodyNamesAlpha = 1,
  showGalaxy = true,
  showNebula = true,
  lookAzDeg = 180
) {
  ctx.fillStyle = '#040914';
  ctx.fillRect(0, 0, w, h);

  const orbCx = w * 0.5;
  const orbCy = h * 0.53;
  const outerR = Math.max(40, Math.min(w, h) * 0.37);
  const innerR = outerR * 0.54;
  const planetR = Math.max(10, outerR * 0.11);

  const sunLon = snapshot.sun.eclipticLonDeg * DEG_TO_RAD;
  const sx = Math.cos(sunLon);
  const sy = -Math.sin(sunLon);
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.24)';
  ctx.lineWidth = 1;
  for (let offset = -2; offset <= 2; offset++) {
    const perpX = -sy * offset * 16;
    const perpY = sx * offset * 16;
    ctx.beginPath();
    ctx.moveTo(orbCx + sx * (outerR + 24) + perpX, orbCy + sy * (outerR + 24) + perpY);
    ctx.lineTo(orbCx + sx * (outerR + 6) + perpX, orbCy + sy * (outerR + 6) + perpY);
    ctx.stroke();
  }
  if (bodyNamesAlpha > 0.005) {
    ctx.save();
    ctx.globalAlpha = bodyNamesAlpha;
    ctx.fillStyle = '#fde047';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `☀️ ${config.sunName}`,
      orbCx + sx * (outerR + 26),
      orbCy + sy * (outerR + 26) + (sy < 0 ? -4 : 10)
    );
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(orbCx, orbCy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  if (config.blackMoon.enabled) {
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.28)';
    ctx.beginPath();
    ctx.arc(orbCx, orbCy, outerR, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(orbCx, orbCy, planetR, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(orbCx, orbCy);
  ctx.rotate(Math.atan2(sy, sx));
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.arc(0, 0, planetR, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const obsAngle = snapshot.localSiderealRad;
  const obsX = orbCx + Math.cos(obsAngle) * planetR;
  const obsY = orbCy - Math.sin(obsAngle) * planetR;
  const ewComponent = Math.sin(lookAzDeg * DEG_TO_RAD);
  const sightAngle = obsAngle + ewComponent * 0.95;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(obsX, obsY);
  ctx.lineTo(obsX + Math.cos(sightAngle) * (planetR * 1.45), obsY - Math.sin(sightAngle) * (planetR * 1.45));
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.arc(obsX, obsY, 3, 0, Math.PI * 2);
  ctx.fill();

  drawOrbitChevron(ctx, orbCx, orbCy, innerR, snapshot.primaryMoon.orbitalAngleRad + 0.35, 1, 'rgba(186, 230, 253, 0.55)');
  if (config.blackMoon.enabled) {
    drawOrbitChevron(
      ctx,
      orbCx,
      orbCy,
      outerR,
      snapshot.blackMoon.orbitalAngleRad + (config.blackMoon.retrograde ? -0.25 : 0.25),
      config.blackMoon.retrograde ? -1 : 1,
      'rgba(248, 113, 113, 0.55)'
    );
  }

  if (config.trojanCluster.enabled) {
    drawOrbitalTrojanSwarm(ctx, orbCx, orbCy, innerR, snapshot, config);
  }

  const pmX = orbCx + Math.cos(snapshot.primaryMoon.orbitalAngleRad) * innerR;
  const pmY = orbCy - Math.sin(snapshot.primaryMoon.orbitalAngleRad) * innerR;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(pmX, pmY, 6, 0, Math.PI * 2);
  ctx.fill();

  if (config.blackMoon.enabled) {
    const bmAng = snapshot.blackMoon.orbitalAngleRad;
    const bmX = orbCx + Math.cos(bmAng) * outerR;
    const bmY = orbCy - Math.sin(bmAng) * outerR;
    ctx.fillStyle = snapshot.blackMoon.isAshFull ? '#991b1b' : '#090d16';
    ctx.strokeStyle = snapshot.blackMoon.isAshFull ? '#f87171' : '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bmX, bmY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Direction indicators for Deep-Sky Galaxy Cloud and Chrysalis Nebula
  const tiltRad = config.axialTiltDeg * DEG_TO_RAD;

  // 1. Galaxy Cloud / Core Direction (The Astral River)
  if (showGalaxy) {
    const galRaRad = GALAXY_CORE_RA_DEG * DEG_TO_RAD;
    const galDecRad = GALAXY_CORE_DEC_DEG * DEG_TO_RAD;
    const gxEq = Math.cos(galDecRad) * Math.cos(galRaRad);
    const gyEq = Math.cos(galDecRad) * Math.sin(galRaRad);
    const gzEq = Math.sin(galDecRad);
    const gxEcl = gxEq;
    const gyEcl = gyEq * Math.cos(tiltRad) + gzEq * Math.sin(tiltRad);
    const galLonRad = Math.atan2(gyEcl, gxEcl);

    const gDirX = Math.cos(galLonRad);
    const gDirY = -Math.sin(galLonRad);
    const rRayStart = outerR + 4;
    const rRayEnd = Math.min(outerR + 24, Math.min(orbCx, orbCy) - 16);

    ctx.save();
    // Dashed sightline
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(orbCx + gDirX * rRayStart, orbCy + gDirY * rRayStart);
    ctx.lineTo(orbCx + gDirX * rRayEnd, orbCy + gDirY * rRayEnd);
    ctx.stroke();
    ctx.setLineDash([]);

    // Indicator Marker
    const markX = orbCx + gDirX * (rRayEnd + 3);
    const markY = orbCy + gDirY * (rRayEnd + 3);

    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(markX, markY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(186, 230, 253, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(markX, markY, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#bae6fd';
    ctx.textAlign = gDirX >= 0 ? 'left' : 'right';
    const textX = markX + (gDirX >= 0 ? 8 : -8);
    const textY = markY + 3;
    ctx.fillText('🌌 Galaxy Cloud', textX, textY);
    ctx.restore();
  }

  // 2. Coloured Nebula Direction (The Chrysalis Nebula)
  if (showNebula) {
    const nebRaRad = COLOURED_NEBULA.centerRaDeg * DEG_TO_RAD;
    const nebDecRad = COLOURED_NEBULA.centerDecDeg * DEG_TO_RAD;
    const nxEq = Math.cos(nebDecRad) * Math.cos(nebRaRad);
    const nyEq = Math.cos(nebDecRad) * Math.sin(nebRaRad);
    const nzEq = Math.sin(nebDecRad);
    const nxEcl = nxEq;
    const nyEcl = nyEq * Math.cos(tiltRad) + nzEq * Math.sin(tiltRad);
    const nebLonRad = Math.atan2(nyEcl, nxEcl);

    const nDirX = Math.cos(nebLonRad);
    const nDirY = -Math.sin(nebLonRad);
    const rRayStart = outerR + 4;
    const rRayEnd = Math.min(outerR + 24, Math.min(orbCx, orbCy) - 16);

    ctx.save();
    // Dashed sightline
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(orbCx + nDirX * rRayStart, orbCy + nDirY * rRayStart);
    ctx.lineTo(orbCx + nDirX * rRayEnd, orbCy + nDirY * rRayEnd);
    ctx.stroke();
    ctx.setLineDash([]);

    // Indicator Marker
    const markX = orbCx + nDirX * (rRayEnd + 3);
    const markY = orbCy + nDirY * (rRayEnd + 3);

    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(markX, markY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(251, 113, 133, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(markX, markY, 5.5, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = '#fbcfe8';
    ctx.textAlign = nDirX >= 0 ? 'left' : 'right';
    const textX = markX + (nDirX >= 0 ? 8 : -8);
    const textY = markY + 3;
    ctx.fillText('🌺 Chrysalis Nebula', textX, textY);
    ctx.restore();
  }

  // 3. Comet Direction & Apparition Indicator (The Red Harbinger)
  if (snapshot.comet) {
    const cLonRad = snapshot.comet.eclipticLonDeg * DEG_TO_RAD;
    const cDirX = Math.cos(cLonRad);
    const cDirY = -Math.sin(cLonRad);
    const rRayStart = outerR + 4;
    const rRayEnd = Math.min(outerR + 26, Math.min(orbCx, orbCy) - 16);

    ctx.save();
    ctx.strokeStyle = snapshot.comet.active ? 'rgba(239, 68, 68, 0.65)' : 'rgba(239, 68, 68, 0.25)';
    ctx.lineWidth = snapshot.comet.active ? 1.5 : 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(orbCx + cDirX * rRayStart, orbCy + cDirY * rRayStart);
    ctx.lineTo(orbCx + cDirX * rRayEnd, orbCy + cDirY * rRayEnd);
    ctx.stroke();
    ctx.setLineDash([]);

    const markX = orbCx + cDirX * (rRayEnd + 3);
    const markY = orbCy + cDirY * (rRayEnd + 3);

    ctx.fillStyle = snapshot.comet.active ? '#ef4444' : 'rgba(239, 68, 68, 0.4)';
    ctx.beginPath();
    ctx.arc(markX, markY, snapshot.comet.active ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();

    if (snapshot.comet.active) {
      ctx.strokeStyle = 'rgba(254, 202, 202, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(markX, markY, 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (bodyNamesAlpha > 0.005) {
      ctx.font = snapshot.comet.active ? 'bold 9px system-ui, sans-serif' : '9px system-ui, sans-serif';
      ctx.fillStyle = snapshot.comet.active ? '#fca5a5' : '#94a3b8';
      ctx.textAlign = cDirX >= 0 ? 'left' : 'right';
      const textX = markX + (cDirX >= 0 ? 8 : -8);
      const textY = markY + 3;
      const label = snapshot.comet.active ? '☄️ The Red Harbinger' : '☄️ Red Harbinger (12y)';
      ctx.fillText(label, textX, textY);
    }
    ctx.restore();
  }
}

// ============================================================================
// Formatting & Style Helpers
// ============================================================================

function formatRiseSet(
  rs: { riseHour: number | null; setHour: number | null; state: 'normal' | 'circumpolar' | 'never-rises' },
  which: 'rise' | 'set',
  hoursPerDay: number
): string {
  if (rs.state === 'circumpolar') return 'All day';
  if (rs.state === 'never-rises') return 'None';
  return formatClockHour(which === 'rise' ? rs.riseHour : rs.setHour, hoursPerDay);
}

function formatLat(lat: number): string {
  if (Math.abs(lat) < 0.05) return '0.0°';
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
}

function formatLon(lon: number): string {
  if (Math.abs(lon) < 0.05) return '0.0°';
  return `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

function lerpHex(hexA: string, hexB: string, t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const r = Math.round(((a >> 16) & 255) * (1 - c) + ((b >> 16) & 255) * c);
  const g = Math.round(((a >> 8) & 255) * (1 - c) + ((b >> 8) & 255) * c);
  const bl = Math.round((a & 255) * (1 - c) + (b & 255) * c);
  return `rgb(${r}, ${g}, ${bl})`;
}

function getLightBadgeBg(level: CelestialSnapshot['lighting']['level']): string {
  switch (level) {
    case 'Daylight':
      return '#0369a1';
    case 'Civil Twilight':
      return '#7c2d12';
    case 'Bright Moonlight':
      return '#1d4ed8';
    case 'Dim Moonlight':
      return '#312e81';
    case 'Faint Shardlight':
      return '#164e63';
    case 'Pitch Dark':
      return '#450a0a';
    default:
      return '#1e293b';
  }
}

interface SkyToolbarState {
  projectionMode: SkyProjectionMode;
  focusedView: FocusedView;
  showBodyNames: boolean;
  showConstellations: boolean;
  showMythicArt: boolean;
  showArcs: boolean;
  showGlareWashout: boolean;
  showVolcanoGlow: boolean;
  showQuickSelect: boolean;
  hideFocusHud: boolean;
  showConfigDrawer: boolean;
  showPerfHud: boolean;
  showHelpModal: boolean;
  isBrowserFullscreen: boolean;
}

interface SkyToolbarActions {
  setProjectionMode: (mode: SkyProjectionMode) => void;
  cycleFocusedView: () => void;
  toggleBodyNames: () => void;
  toggleConstellations: () => void;
  toggleMythicArt: () => void;
  toggleArcs: () => void;
  toggleWashout: () => void;
  toggleVolcanoGlow: () => void;
  toggleQuickSelect: () => void;
  togglePureView: () => void;
  toggleOrbits: () => void;
  togglePerfHud: () => void;
  openCalendar: () => void;
  toggleHelpModal: () => void;
  toggleBrowserFullscreen: () => void;
}

const iconToggleStyle = (active: boolean, surface: 'header' | 'overlay' = 'header'): React.CSSProperties => ({
  minWidth: '28px',
  height: '25px',
  padding: '0 6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  lineHeight: 1,
  borderRadius: '5px',
  border: active ? '1px solid #38bdf8' : surface === 'overlay' ? '1px solid rgba(51, 65, 85, 0.88)' : '1px solid #334155',
  background: active
    ? surface === 'overlay' ? 'rgba(2, 132, 199, 0.72)' : 'rgba(14, 116, 144, 0.45)'
    : surface === 'overlay' ? 'rgba(15, 23, 42, 0.84)' : '#1e293b',
  color: active ? '#f8fafc' : '#cbd5e1',
  cursor: 'pointer',
});

const iconSegBtnStyle = (active: boolean): React.CSSProperties => ({
  minWidth: '28px',
  height: '25px',
  padding: '0 7px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '13px',
  lineHeight: 1,
  border: 'none',
  background: active ? '#0284c7' : '#1e293b',
  color: '#f8fafc',
  cursor: 'pointer',
});

function renderArcsSvgIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 12 Q8 2 14 12" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2" strokeLinecap="round" />
      <circle cx="2.5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="13.5" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function renderFullscreenSvgIcon(active: boolean): React.ReactElement {
  return active ? (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function renderViewProjectionButtons(
  state: SkyToolbarState,
  actions: SkyToolbarActions,
  showProjection: boolean,
  surface: 'header' | 'overlay'
): React.ReactElement {
  const groundTitle = 'Ground View — Look from eye level on the world map (drag or arrows to pan/tilt, scroll to zoom) (Key: 1)';
  const surroundTitle = 'Surround Panorama — Wide 360° horizon view from east to west (drag or arrows to pan, scroll to zoom) (Key: 2)';
  const cycleTitle = 'Cycle Focus View — Switch between main sky, zenith dome, orbital plane, and multi-panel layout (Key: 3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {showProjection && (
        <div style={{ display: 'flex', borderRadius: '5px', overflow: 'hidden', border: '1px solid #334155' }}>
          <button onClick={() => actions.setProjectionMode('ground')} style={iconSegBtnStyle(state.projectionMode === 'ground')} title={groundTitle} aria-label={groundTitle}>👁️</button>
          <button onClick={() => actions.setProjectionMode('surround')} style={iconSegBtnStyle(state.projectionMode === 'surround')} title={surroundTitle} aria-label={surroundTitle}>🏔️</button>
        </div>
      )}
      <button onClick={actions.cycleFocusedView} style={iconToggleStyle(state.focusedView !== 'none', surface)} title={cycleTitle} aria-label={cycleTitle}>🪟</button>
    </div>
  );
}

function renderOverlayIconButtons(
  state: SkyToolbarState,
  actions: SkyToolbarActions,
  surface: 'header' | 'overlay'
): React.ReactElement {
  const items: Array<{ key: string; icon: React.ReactNode; active: boolean; onClick: () => void; title: string }> = [
    { key: 'names', icon: '🏷️', active: state.showBodyNames, onClick: actions.toggleBodyNames, title: 'Names & Text — Show or hide moon names, phase labels, and compass bearings (Key: 6)' },
    { key: 'constellations', icon: '✨', active: state.showConstellations, onClick: actions.toggleConstellations, title: 'Constellation Lines — Show or hide constellation star lines and borders (Key: 7)' },
    { key: 'art', icon: '👻', active: state.showMythicArt, onClick: actions.toggleMythicArt, title: 'Constellation Pictures — Show or hide ghostly mythic artwork over constellations (Key: 8)' },
    { key: 'arcs', icon: renderArcsSvgIcon(), active: state.showArcs, onClick: actions.toggleArcs, title: 'Trajectory Arcs — Show or hide 24-hour solar and lunar orbital paths across the sky (Key: 9)' },
    { key: 'washout', icon: '🔆', active: state.showGlareWashout, onClick: actions.toggleWashout, title: 'Glare Washout — Dim faint stars near bright Vaelis or Solis (Key: 0)' },
    { key: 'volcano', icon: '🌋', active: state.showVolcanoGlow, onClick: actions.toggleVolcanoGlow, title: 'Volcanic Eruption Glow — Show or hide distant volcanic horizon glow and ash veil (Key: V)' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {items.map((item) => (
        <button key={item.key} onClick={item.onClick} style={iconToggleStyle(item.active, surface)} title={item.title} aria-label={item.title}>
          {item.icon}
        </button>
      ))}
    </div>
  );
}

function renderToolIconButtons(
  state: SkyToolbarState,
  actions: SkyToolbarActions,
  surface: 'header' | 'overlay'
): React.ReactElement {
  const isFocused = state.focusedView !== 'none';
  const orbitsTitle = isFocused
    ? 'World & Orbital Settings — Exit focus to open the customization drawer below the sky views'
    : 'World & Orbital Settings — Customize sun/moon names, orbital periods, shard cluster, and nebula';
  const pureTitle = 'Pure Sky View — Hide all controls, horizon line, moon rims, and cursor (Key: O; press P for mouse pan, I for pointer sphere crosshair, Esc to restore UI)';
  const fsTitle = state.isBrowserFullscreen ? 'Exit Browser Fullscreen' : 'Enter Browser Fullscreen — Expand the sky chart to fill your screen';
  const items: Array<{ key: string; icon: React.ReactNode; active: boolean; onClick: () => void; title: string }> = [
    { key: 'target', icon: '🎯', active: state.showQuickSelect, onClick: actions.toggleQuickSelect, title: 'Quick Select Target — Search and point the camera at any constellation, moon, sun, or comet (Key: Y)' },
    { key: 'pure', icon: '🕶️', active: isFocused && state.hideFocusHud, onClick: actions.togglePureView, title: pureTitle },
    { key: 'orbits', icon: '⚙️', active: state.showConfigDrawer, onClick: actions.toggleOrbits, title: orbitsTitle },
    { key: 'perf', icon: '📊', active: state.showPerfHud, onClick: actions.togglePerfHud, title: 'Simulation Telemetry — Show or hide FPS, frame timing, memory, and pool reuse stats' },
    { key: 'calendar', icon: '📅', active: false, onClick: actions.openCalendar, title: 'World Calendar — Open the full Vaelora calendar in a new browser tab' },
    { key: 'help', icon: <span style={{ fontWeight: 700, fontSize: '12px' }}>?</span>, active: state.showHelpModal, onClick: actions.toggleHelpModal, title: 'Sky Guide & Shortcuts — Open the multi-page cartography guide and shortcut reference (Key: ?)' },
    { key: 'browserFs', icon: renderFullscreenSvgIcon(state.isBrowserFullscreen), active: state.isBrowserFullscreen, onClick: actions.toggleBrowserFullscreen, title: fsTitle },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {items.map((item) => (
        <button key={item.key} onClick={item.onClick} style={iconToggleStyle(item.active, surface)} title={item.title} aria-label={item.title}>
          {item.icon}
        </button>
      ))}
    </div>
  );
}

function renderPerfHudPanel(perfStats: PerfSnapshot, onResetSpikes: () => void, floating = false): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
        padding: '4px 8px',
        borderRadius: '6px',
        background: floating ? 'rgba(2, 6, 23, 0.9)' : '#020617',
        border: '1px solid #1e293b',
        fontSize: '10px',
        fontFamily: 'monospace',
        color: '#94a3b8',
      }}
    >
      <span style={{ color: '#38bdf8', fontWeight: 700 }}>FPS: {perfStats.fps}</span>
      <span>
        Frame: {perfStats.avgFrameMs.toFixed(1)}ms (max{' '}
        <strong style={{ color: perfStats.maxSpikeMs > 32 ? '#f87171' : '#cbd5e1' }}>
          {perfStats.maxSpikeMs.toFixed(1)}ms
        </strong>)
      </span>
      <span>Snap: {perfStats.lastSnapshotMs.toFixed(2)}ms | Render: {perfStats.lastRenderMs.toFixed(2)}ms | Omen: {perfStats.lastOmenScanMs.toFixed(1)}ms | Eclipse: {perfStats.lastEclipseScanMs.toFixed(1)}ms</span>
      <span>Heap: {perfStats.heapUsedMB !== null ? `${perfStats.heapUsedMB.toFixed(1)} MB` : 'n/a'} | Alloc: {perfStats.allocKBPerSec !== null ? `${perfStats.allocKBPerSec} KB/s` : 'n/a'} | GC: {perfStats.gcCount}{perfStats.gcCount > 0 ? ` (-${perfStats.lastGcFreedMB.toFixed(2)}MB)` : ''}</span>
      <span>Pool Reuses: <strong style={{ color: '#4ade80' }}>{perfStats.poolReuses.toLocaleString()}</strong> | Pooling: {perfStats.poolingRecommended ? 'Recommended' : 'Healthy'}</span>
      <button onClick={onResetSpikes} style={{ padding: '1px 6px', fontSize: '10px', borderRadius: '4px', border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', cursor: 'pointer' }} title="Reset peak frame spike counter">
        Reset Spike
      </button>
    </div>
  );
}

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: active ? 600 : 400,
  border: 'none',
  background: active ? '#0284c7' : '#1e293b',
  color: '#f8fafc',
  cursor: 'pointer',
});

const focusBtnStyle = (focused: boolean): React.CSSProperties => ({
  padding: '3px 8px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '5px',
  border: focused ? '1px solid #38bdf8' : '1px solid rgba(51, 65, 85, 0.85)',
  background: focused ? 'rgba(2, 132, 199, 0.85)' : 'rgba(15, 23, 42, 0.82)',
  color: '#f8fafc',
  cursor: 'pointer',
});

const stepBtnStyle: React.CSSProperties = {
  padding: '3px 7px',
  borderRadius: '4px',
  border: '1px solid #334155',
  background: '#1e293b',
  color: '#cbd5e1',
  fontSize: '11px',
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: '7px',
  padding: '7px 9px',
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
};

const metricLineStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#cbd5e1',
  fontFamily: 'monospace',
};

const subMetricStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#64748b',
  fontFamily: 'monospace',
};

const visPillStyle = (up: boolean): React.CSSProperties => ({
  fontSize: '10px',
  padding: '1px 5px',
  borderRadius: '4px',
  background: up ? 'rgba(22, 101, 52, 0.45)' : 'rgba(30, 41, 59, 0.8)',
  color: up ? '#86efac' : '#64748b',
  fontWeight: 600,
});

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  color: '#94a3b8',
};

const textInputStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderRadius: '4px',
  border: '1px solid #334155',
  background: '#020617',
  color: '#f8fafc',
  fontSize: '11px',
};
