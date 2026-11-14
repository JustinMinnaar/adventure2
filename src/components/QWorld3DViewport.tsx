import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  QWorldChunkTree,
  WORLD_L0_CHUNKS_X,
  WORLD_L0_CHUNKS_Z,
  WORLD_SPAN_X,
  WORLD_SPAN_Z,
  PLANET_RADIUS_YARDS,
} from '../core/QWorldChunkTree';
import { QWorldTerrainMesh, TerrainRenderMode, ELEVATION_SCALE, computeFoliagePropAppearance, getSeaLevelOffsetForTemp } from '../core/QWorldTerrainMesh';
import { QWorldVectorTree, WorldPoint2D, RouteStop } from '../core/QWorldVectorTree';
import { buildMergedRouteNetwork, MergedRouteStrand } from '../core/QWorldRouteNetwork';
import { EditorToolMode, CameraPresetMode, MARKER_PRESETS, WeatherLayerToggles, DEFAULT_WEATHER_LAYERS } from '../core/QWorldEditorTypes';
import { RoadSubMode } from './QWorldToolOptionsBar';
import { QWorldTerrainWorkerClient, ChunkMeshMessage } from '../workers/QWorldTerrainWorkerClient';
import { ChunkRequestItem } from '../workers/QWorldTerrainWorkerProtocol';
import { computeSolarDeclinationDeg, computeSubsolarLatLon } from '../core/QWorldCelestial';
import { AtmosphereField, sampleAtmosByteAtWorld } from '../core/QWorldAtmosphere';
import { VolcanoSource, VolcanicFalloutResult } from '../core/QWorldVolcanicFallout';
import {
  buildWindArrowGeometry,
  buildStormRiskGeometry,
  buildFalloutOverlayGeometry,
  buildVolcanoPlumesGeometry,
} from '../core/QWorldWeatherOverlays';

interface ProjectedLabel {
  id: string;
  name: string;
  icon: string;
  color: string;
  screenX: number;
  screenY: number;
  worldX: number;
  worldZ: number;
  locked?: boolean;
}

interface ProjectedRoutePin {
  index: number;
  badge: string;
  label: string;
  color: string;
  screenX: number;
  screenY: number;
}

interface QWorld3DViewportProps {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  revision: number;
  terrainRevision?: number;
  toolMode: EditorToolMode;
  renderMode: TerrainRenderMode;
  flatWaterSurface: boolean;
  showFaultLines?: boolean;
  worldHours?: number;
  baseTempC?: number;
  seaLevel?: number;
  cameraPreset: CameraPresetMode;
  viewAlignment?: 'ns' | 'sun';
  resetViewNonce?: number;
  brushRadiusCells: number;
  draftPoints: WorldPoint2D[];
  polygonPoints: WorldPoint2D[];
  activeLod: number;
  selectedMarkerId?: string | null;
  selectedRouteId?: string | null;
  routeStops?: RouteStop[];
  mergeRouteNetwork?: boolean;
  roadSubMode?: RoadSubMode;
  tempPin?: WorldPoint2D | null;
  panToMarkerRequest?: { x: number; z: number; distance?: number; nonce: number } | null;
  cameraTargetRef?: React.MutableRefObject<{ x: number; z: number; distance: number }>;
  terrainWorkerClient?: QWorldTerrainWorkerClient;
  weatherLayers?: WeatherLayerToggles;
  atmosphereField?: AtmosphereField | null;
  volcanicFallout?: VolcanicFalloutResult | null;
  volcanoSources?: VolcanoSource[];
  weatherRevision?: number;
  onActiveLodChange: (lod: number) => void;
  onBrushStroke: (worldX: number, worldZ: number, lod: number) => void;
  onBrushEnd?: (lod: number) => void;
  onMapClick: (worldX: number, worldZ: number, lod: number) => void;
  onSelectMarker?: (id: string) => void;
  onMoveMarker?: (id: string, worldX: number, worldZ: number, terrainY: number) => void;
  onAddRouteStopPin?: (stop: RouteStop) => void;
  onPlanRoute?: () => void;
  onCameraDistanceChange?: (distance: number) => void;
  onUpdatePolygonVertex: (index: number, worldX: number, worldZ: number) => void;
  onFinishPath: () => void;
}

const LOD_TARGET_DISTANCES = [950000, 400000, 135000, 45000, 15000, 5000, 1650, 550, 185, 62] as const;
const LOD_LOWER_THRESHOLDS = [700000, 230000, 78000, 26000, 8600, 2900, 960, 320, 110, 25] as const;

function computeLodFromDistance(distance: number): number {
  for (let l = 0; l < 9; l++) {
    if (distance > LOD_LOWER_THRESHOLDS[l]) return l;
  }
  return 9;
}

function computeSubGridBlend(distance: number, lod: number): number {
  if (lod >= 9) return 0;
  const low = LOD_LOWER_THRESHOLDS[lod];
  const high = lod === 0 ? 1800000 : LOD_LOWER_THRESHOLDS[lod - 1];
  const t = Math.max(0, Math.min(1, (high - distance) / (high - low)));
  return t * t * (3 - 2 * t);
}

function wrapDeltaX(dx: number): number {
  if (dx > WORLD_SPAN_X * 0.5) return dx - WORLD_SPAN_X;
  if (dx < -WORLD_SPAN_X * 0.5) return dx + WORLD_SPAN_X;
  return dx;
}

function projectWorldToRendered(
  wx: number,
  wy: number,
  wz: number,
  targetX: number,
  targetZ: number,
  globeBlend: number,
  out: THREE.Vector3
): THREE.Vector3 {
  if (globeBlend <= 0.001) {
    return out.set(wx, wy, wz);
  }
  const clampedLon = Math.max(-Math.PI, Math.min(Math.PI, (wx - targetX) / PLANET_RADIUS_YARDS));
  const clampedLat = Math.max(-Math.PI, Math.min(Math.PI, (wz - targetZ) / PLANET_RADIUS_YARDS));
  const r = PLANET_RADIUS_YARDS + wy;
  const cosLat = Math.cos(clampedLat);
  const sX = targetX + r * cosLat * Math.sin(clampedLon);
  const sZ = targetZ + r * Math.sin(clampedLat);
  const sY = 0.65 * r * cosLat * Math.cos(clampedLon) - PLANET_RADIUS_YARDS;
  return out.set(
    wx + (sX - wx) * globeBlend,
    wy + (sY - wy) * globeBlend,
    wz + (sZ - wz) * globeBlend
  );
}

function buildTipAnchoredPinGeometry(radius: number, height: number, colorHex: string): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(radius, height, 8);
  geo.rotateX(Math.PI);
  geo.translate(0, height * 0.5, 0);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function getRouteStopBadgeInfo(idx: number, total: number): { badge: string; color: string } {
  if (idx === 0) return { badge: 'A', color: '#0284c7' };
  if (total >= 2 && idx === total - 1) return { badge: 'B', color: '#d97706' };
  return { badge: total <= 3 ? 'Via' : `V${idx}`, color: '#9333ea' };
}

/**
 * Builds a terrain-draped 3D ribbon mesh for routes & merged road trunks.
 * Uses triangle quads instead of GL_LINES because Windows ANGLE Direct3D11 clamps gl.lineWidth to 1px.
 */
function buildRouteStrandRibbonGeometry(
  pts3d: THREE.Vector3[],
  halfWidth: number,
  colorHex: number,
  style: 'solid' | 'path' | 'building'
): THREE.BufferGeometry | null {
  if (pts3d.length < 2) return null;
  const col = new THREE.Color(colorHex);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    colors.push(col.r, col.g, col.b);
  };

  if (style === 'solid') {
    const n = pts3d.length;
    for (let i = 0; i < n; i++) {
      const p = pts3d[i];
      let tx = 0;
      let tz = 0;
      let outNx = 0;
      let outNz = 1;

      if (i < n - 1) {
        const dx = pts3d[i + 1].x - p.x;
        const dz = pts3d[i + 1].z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        tx += ux;
        tz += uz;
        outNx = -uz;
        outNz = ux;
      }
      if (i > 0) {
        const dx = p.x - pts3d[i - 1].x;
        const dz = p.z - pts3d[i - 1].z;
        const len = Math.hypot(dx, dz) || 1;
        tx += dx / len;
        tz += dz / len;
      }
      const tLen = Math.hypot(tx, tz);
      const nx = tLen > 1e-5 ? -tz / tLen : outNx;
      const nz = tLen > 1e-5 ? tx / tLen : outNz;
      const miterDot = i > 0 && i < n - 1 ? Math.max(0.58, Math.abs(nx * outNx + nz * outNz)) : 1.0;
      const w = halfWidth * Math.min(1.72, 1.0 / miterDot);

      pushVert(p.x + nx * w, p.y, p.z + nz * w);
      pushVert(p.x - nx * w, p.y, p.z - nz * w);
    }

    for (let i = 0; i < n - 1; i++) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  } else {
    const dashLen = style === 'path' ? Math.max(2.2, halfWidth * 2.6) : Math.max(5.0, halfWidth * 5.2);
    const gapLen = style === 'path' ? Math.max(2.6, halfWidth * 3.0) : Math.max(3.2, halfWidth * 3.0);
    const period = dashLen + gapLen;
    let cumDist = 0;

    for (let i = 0; i < pts3d.length - 1; i++) {
      const a = pts3d[i];
      const b = pts3d[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-4) continue;

      const nx = -dz / segLen;
      const nz = dx / segLen;
      const segStart = cumDist;
      const segEnd = cumDist + segLen;

      let cycleStart = Math.floor(segStart / period) * period;
      while (cycleStart < segEnd) {
        const d0 = Math.max(segStart, cycleStart);
        const d1 = Math.min(segEnd, cycleStart + dashLen);
        if (d1 > d0 + 1e-3) {
          const t0 = (d0 - segStart) / segLen;
          const t1 = (d1 - segStart) / segLen;
          const x0 = a.x + dx * t0;
          const y0 = a.y + dy * t0;
          const z0 = a.z + dz * t0;
          const x1 = a.x + dx * t1;
          const y1 = a.y + dy * t1;
          const z1 = a.z + dz * t1;

          const base = positions.length / 3;
          pushVert(x0 + nx * halfWidth, y0, z0 + nz * halfWidth);
          pushVert(x0 - nx * halfWidth, y0, z0 - nz * halfWidth);
          pushVert(x1 + nx * halfWidth, y1, z1 + nz * halfWidth);
          pushVert(x1 - nx * halfWidth, y1, z1 - nz * halfWidth);
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        cycleStart += period;
      }

      cumDist = segEnd;
    }
  }

  if (indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

export const QWorld3DViewport: React.FC<QWorld3DViewportProps> = ({
  chunkTree,
  vectorTree,
  revision,
  terrainRevision = 0,
  toolMode,
  renderMode,
  flatWaterSurface,
  showFaultLines = true,
  worldHours = 79 * 24 + 12,
  baseTempC = 10,
  seaLevel = 0,
  cameraPreset,
  viewAlignment = 'ns',
  resetViewNonce = 0,
  brushRadiusCells,
  draftPoints,
  polygonPoints,
  activeLod,
  selectedMarkerId = null,
  selectedRouteId = null,
  routeStops = [],
  mergeRouteNetwork = true,
  roadSubMode = 'route',
  tempPin = null,
  panToMarkerRequest = null,
  cameraTargetRef,
  terrainWorkerClient: externalWorkerClient,
  weatherLayers = DEFAULT_WEATHER_LAYERS,
  atmosphereField = null,
  volcanicFallout = null,
  volcanoSources = [],
  weatherRevision = 0,
  onActiveLodChange,
  onBrushStroke,
  onBrushEnd,
  onMapClick,
  onSelectMarker,
  onMoveMarker,
  onAddRouteStopPin,
  onPlanRoute,
  onCameraDistanceChange,
  onUpdatePolygonVertex,
  onFinishPath,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);
  const [routeStopPins, setRouteStopPins] = useState<ProjectedRoutePin[]>([]);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);
  const [tempPinScreen, setTempPinScreen] = useState<{ x: number; y: number } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; z: number; h: number } | null>(null);
  const [scaleBar, setScaleBar] = useState<{
    widthPx: number;
    cellSpacing: number;
    totalYards: number;
  }>({ widthPx: 120, cellSpacing: 64, totalYards: 640 });

  const camStateRef = useRef({
    targetX: WORLD_SPAN_X * 0.5,
    targetZ: WORLD_SPAN_Z * 0.5,
    distance: 950000,
    pitchDeg: 48,
    yawDeg: 0,
  });

  const solarDeclinationDeg = computeSolarDeclinationDeg(worldHours);
  const solarDeclBucket = Math.round(solarDeclinationDeg * 10);
  const sunDirRef = useRef(new THREE.Vector3(0, 0, 1));
  const subsolar = computeSubsolarLatLon(worldHours);
  {
    const latRad = (subsolar.latitudeDeg * Math.PI) / 180;
    const lonRad = (subsolar.longitudeDeg * Math.PI) / 180;
    sunDirRef.current
      .set(Math.cos(latRad) * Math.sin(lonRad), Math.sin(latRad), Math.cos(latRad) * Math.cos(lonRad))
      .normalize();
  }

  const propsRef = useRef({
    terrainRevision,
    toolMode,
    renderMode,
    flatWaterSurface,
    showFaultLines,
    solarDeclinationDeg,
    viewAlignment,
    baseTempC,
    seaLevel,
    brushRadiusCells,
    draftPoints,
    polygonPoints,
    activeLod,
    selectedMarkerId,
    selectedRouteId,
    routeStops,
    mergeRouteNetwork,
    roadSubMode,
    tempPin,
    cameraTargetRef,
    weatherLayers,
    atmosphereField,
    volcanicFallout,
    volcanoSources,
    weatherRevision,
    onActiveLodChange,
    onBrushStroke,
    onBrushEnd,
    onMapClick,
    onSelectMarker,
    onMoveMarker,
    onAddRouteStopPin,
    onPlanRoute,
    onCameraDistanceChange,
    onUpdatePolygonVertex,
    onFinishPath,
  });
  propsRef.current = {
    terrainRevision,
    toolMode,
    renderMode,
    flatWaterSurface,
    showFaultLines,
    solarDeclinationDeg,
    viewAlignment,
    baseTempC,
    seaLevel,
    brushRadiusCells,
    draftPoints,
    polygonPoints,
    activeLod,
    selectedMarkerId,
    selectedRouteId,
    routeStops,
    mergeRouteNetwork,
    roadSubMode,
    tempPin,
    cameraTargetRef,
    weatherLayers,
    atmosphereField,
    volcanicFallout,
    volcanoSources,
    weatherRevision,
    onActiveLodChange,
    onBrushStroke,
    onBrushEnd,
    onMapClick,
    onSelectMarker,
    onMoveMarker,
    onAddRouteStopPin,
    onPlanRoute,
    onCameraDistanceChange,
    onUpdatePolygonVertex,
    onFinishPath,
  };

  const rebuildTerrainRef = useRef<() => void>(() => {});
  const rebuildVectorsRef = useRef<() => void>(() => {});
  const rebuildWeatherRef = useRef<() => void>(() => {});
  const updateProjectedOverlaysRef = useRef<() => void>(() => {});
  const labelPointerDownRef = useRef<((e: PointerEvent, markerId: string) => void) | null>(null);
  const flyAnimRef = useRef<{
    startTime: number;
    durationMs: number;
    startX: number;
    deltaX: number;
    startZ: number;
    deltaZ: number;
    startDist: number;
    endDist: number;
  } | null>(null);

  // Smooth pan/zoom flight requests from marker panel ("Show")
  useEffect(() => {
    if (!panToMarkerRequest) return;
    const cam = camStateRef.current;
    const startX = cam.targetX;
    const destX = ((panToMarkerRequest.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
    let deltaX = destX - startX;
    if (deltaX > WORLD_SPAN_X * 0.5) deltaX -= WORLD_SPAN_X;
    if (deltaX < -WORLD_SPAN_X * 0.5) deltaX += WORLD_SPAN_X;
    const startZ = cam.targetZ;
    const destZ = Math.max(0, Math.min(WORLD_SPAN_Z, panToMarkerRequest.z));
    const deltaZ = destZ - startZ;
    const startDist = cam.distance;
    const endDist =
      panToMarkerRequest.distance !== undefined
        ? Math.max(25, Math.min(6500000, panToMarkerRequest.distance))
        : startDist;
    flyAnimRef.current = {
      startTime: performance.now(),
      durationMs: 2000,
      startX,
      deltaX,
      startZ,
      deltaZ,
      startDist,
      endDist,
    };
  }, [panToMarkerRequest]);

  // Reset view to full-world globe when requested
  useEffect(() => {
    if (resetViewNonce <= 0) return;
    const cam = camStateRef.current;
    cam.targetX = WORLD_SPAN_X * 0.5;
    cam.targetZ = WORLD_SPAN_Z * 0.5;
    cam.distance = 3200000;
    cam.pitchDeg = 48;
    cam.yawDeg = 0;
    onActiveLodChange(0);
  }, [resetViewNonce, onActiveLodChange]);

  // Apply camera preset transitions
  useEffect(() => {
    const cam = camStateRef.current;
    if (cameraPreset === 'topdown') {
      cam.pitchDeg = 89;
    } else if (cameraPreset === '3d') {
      cam.pitchDeg = 48;
      if (cam.distance < 300) cam.distance = 3200;
    } else if (cameraPreset === 'people') {
      cam.pitchDeg = 20;
      cam.distance = 60;
      onActiveLodChange(computeLodFromDistance(60));
    }
  }, [cameraPreset, onActiveLodChange]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#071324');
    const horizonFog = new THREE.Fog('#071324', 1e9, 1e9);
    scene.fog = horizonFog;

    const camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / Math.max(1, container.clientHeight),
      1,
      20000000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: false });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfffbeb, 1.2);
    dir.position.set(4000, 8000, 3000);
    scene.add(dir);

    const terrainGroup = new THREE.Group();
    const vectorGroup = new THREE.Group();
    const propGroup = new THREE.Group();
    const weatherGroup = new THREE.Group();
    scene.add(terrainGroup, vectorGroup, propGroup, weatherGroup);

    // Planetary spin-axis pole line & N/S pole sprites (visible when zoomed out to whole-planet view)
    const polePositions = new Float32Array(6);
    const poleGeo = new THREE.BufferGeometry();
    poleGeo.setAttribute('position', new THREE.BufferAttribute(polePositions, 3));
    const poleMat = new THREE.LineBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.9 });
    const poleLine = new THREE.Line(poleGeo, poleMat);
    poleLine.frustumCulled = false;
    poleLine.visible = false;
    scene.add(poleLine);

    const createPoleLabelSprite = (letter: 'N' | 'S', strokeColor: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.arc(32, 32, 26, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 34px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, 32, 34);
      }
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, tex, mat };
    };
    const northPoleBadge = createPoleLabelSprite('N', '#38bdf8');
    const southPoleBadge = createPoleLabelSprite('S', '#fbbf24');

    const gridUniforms = {
      uGridSpacing: { value: chunkTree.getSampleSpacing(propsRef.current.activeLod) },
      uSubGridBlend: { value: 0.0 },
      uShowGrid: { value: 1.0 },
      uCamTarget: { value: new THREE.Vector2(camStateRef.current.targetX, camStateRef.current.targetZ) },
      uGlobeRadius: { value: PLANET_RADIUS_YARDS },
      uGlobeBlend: { value: 0.0 },
      uSunDir: { value: sunDirRef.current.clone() },
      uWorldSpan: { value: new THREE.Vector2(WORLD_SPAN_X, WORLD_SPAN_Z) },
    };

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    terrainMat.customProgramCacheKey = () => 'terrain-grid-lambert-v14';
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGridSpacing = gridUniforms.uGridSpacing;
      shader.uniforms.uSubGridBlend = gridUniforms.uSubGridBlend;
      shader.uniforms.uShowGrid = gridUniforms.uShowGrid;
      shader.uniforms.uCamTarget = gridUniforms.uCamTarget;
      shader.uniforms.uGlobeRadius = gridUniforms.uGlobeRadius;
      shader.uniforms.uGlobeBlend = gridUniforms.uGlobeBlend;
      shader.uniforms.uSunDir = gridUniforms.uSunDir;
      shader.uniforms.uWorldSpan = gridUniforms.uWorldSpan;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vGridLocal;
varying vec2 vChunkOrigin;
varying vec3 vGeoNormal;
uniform vec2 uCamTarget;
uniform vec2 uWorldSpan;
uniform float uGlobeRadius;
uniform float uGlobeBlend;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec2 localXZ = transformed.xz;
vec2 chunkOriginXZ = vec2(modelMatrix[3][0], modelMatrix[3][2]);
vec3 flatWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;
float geoLat = (0.5 - flatWorldPos.z / uWorldSpan.y) * 3.14159265;
float geoLon = (flatWorldPos.x / uWorldSpan.x - 0.5) * 6.28318530;
vec3 computedGeoNormal = vec3(cos(geoLat) * sin(geoLon), sin(geoLat), cos(geoLat) * cos(geoLon));
if (uGlobeBlend > 0.001 && uGlobeRadius > 0.0) {
  float lon = clamp((flatWorldPos.x - uCamTarget.x) / uGlobeRadius, -3.14159265, 3.14159265);
  float lat = clamp((flatWorldPos.z - uCamTarget.y) / uGlobeRadius, -3.14159265, 3.14159265);
  float r = uGlobeRadius + flatWorldPos.y;
  float cosLat = cos(lat);
  float sphereX = uCamTarget.x + r * cosLat * sin(lon);
  float sphereZ = uCamTarget.y + r * sin(lat);
  float sphereY = 0.65 * r * cosLat * cos(lon) - uGlobeRadius;
  transformed.x = mix(transformed.x, sphereX - modelMatrix[3][0], uGlobeBlend);
  transformed.z = mix(transformed.z, sphereZ - modelMatrix[3][2], uGlobeBlend);
  transformed.y = mix(transformed.y, sphereY, uGlobeBlend);
}`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vGridLocal = localXZ;
vChunkOrigin = chunkOriginXZ;
vGeoNormal = computedGeoNormal;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vGridLocal;
varying vec2 vChunkOrigin;
varying vec3 vGeoNormal;
uniform float uGridSpacing;
uniform float uSubGridBlend;
uniform float uShowGrid;
uniform float uGlobeBlend;
uniform vec3 uSunDir;

float evalGridLevel(float s, vec2 localPos, vec2 chunkOrigin, vec2 worldPerPx, float pxScale) {
  float cellPx = s / pxScale;
  if (cellPx < 5.0) return 0.0;
  float opacity = smoothstep(5.0, 12.0, cellPx) * 0.10;
  opacity = mix(opacity, 0.35, smoothstep(12.0, 45.0, cellPx));
  opacity = mix(opacity, 0.65, smoothstep(100.0, 400.0, cellPx));

  vec2 off = s < 0.99 ? vec2(0.0) : mod(chunkOrigin, s);
  vec2 c = off / s + localPos / s;
  vec2 fw = max(worldPerPx / s, vec2(1e-5));
  vec2 g = abs(fract(c - 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
  return line * opacity;
}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (uShowGrid > 0.5) {
  vec2 worldPerPx = max(fwidth(vGridLocal), vec2(1e-4));
  float pxScale = max(worldPerPx.x, worldPerPx.y);
  float logLevel = floor(log(pxScale * 10.0) / 2.30258509);
  float s0 = pow(10.0, logLevel);
  float s1 = s0 * 10.0;
  float s2 = s0 * 100.0;
  float s3 = s0 * 1000.0;

  float a0 = evalGridLevel(s0, vGridLocal, vChunkOrigin, worldPerPx, pxScale);
  float a1 = evalGridLevel(s1, vGridLocal, vChunkOrigin, worldPerPx, pxScale);
  float a2 = evalGridLevel(s2, vGridLocal, vChunkOrigin, worldPerPx, pxScale);
  float a3 = evalGridLevel(s3, vGridLocal, vChunkOrigin, worldPerPx, pxScale);

  float strength = max(max(a0, a1), max(a2, a3));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), strength);
}
float sunDot = dot(normalize(vGeoNormal), normalize(uSunDir));
float dayFactor = smoothstep(-0.10, 0.14, sunDot);
vec3 nightTint = diffuseColor.rgb * vec3(0.18, 0.22, 0.34);
diffuseColor.rgb = mix(nightTint, diffuseColor.rgb, dayFactor);`
        );
    };

    const applyGlobeWarp = (mat: THREE.Material, cacheKey: string) => {
      mat.customProgramCacheKey = () => cacheKey;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uCamTarget = gridUniforms.uCamTarget;
        shader.uniforms.uGlobeRadius = gridUniforms.uGlobeRadius;
        shader.uniforms.uGlobeBlend = gridUniforms.uGlobeBlend;

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
varying float vIsBack;
uniform vec2 uCamTarget;
uniform float uGlobeRadius;
uniform float uGlobeBlend;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vec3 flatWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;
float isBackVertex = 0.0;
if (uGlobeBlend > 0.001 && uGlobeRadius > 0.0) {
  float lon = clamp((flatWorldPos.x - uCamTarget.x) / uGlobeRadius, -3.14159265, 3.14159265);
  float lat = clamp((flatWorldPos.z - uCamTarget.y) / uGlobeRadius, -3.14159265, 3.14159265);
  float r = uGlobeRadius + flatWorldPos.y;
  float cosLat = cos(lat);
  float sphereX = uCamTarget.x + r * cosLat * sin(lon);
  float sphereZ = uCamTarget.y + r * sin(lat);
  float sphereY = 0.65 * r * cosLat * cos(lon) - uGlobeRadius;
  if (cosLat * cos(lon) < -0.02) {
    isBackVertex = 1.0;
  }
  transformed.x = mix(transformed.x, sphereX - modelMatrix[3][0], uGlobeBlend);
  transformed.y = mix(transformed.y, sphereY - modelMatrix[3][1], uGlobeBlend);
  transformed.z = mix(transformed.z, sphereZ - modelMatrix[3][2], uGlobeBlend);
}
vIsBack = isBackVertex;`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
varying float vIsBack;
uniform float uGlobeBlend;`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
if (uGlobeBlend > 0.25 && vIsBack > 0.5) {
  discard;
}`
          );
      };
    };

    // Shared globe-warped material for 3D marker pins (tip anchored directly on terrain surface)
    const pinMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    applyGlobeWarp(pinMat, 'marker-pin-globe-v2');

    // Shared globe-warped materials for tectonic fault lines (red = mountain uplift, blue = depression/canyon/rift)
    const redFaultLineMat = new THREE.LineBasicMaterial({ color: 0xef4444 });
    applyGlobeWarp(redFaultLineMat, 'fault-line-red-globe-v1');
    const blueFaultLineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    applyGlobeWarp(blueFaultLineMat, 'fault-line-blue-globe-v1');

    // Brush preview ring (crisp 1px LineLoop)
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const brushRing = new THREE.LineLoop(ringGeo, ringMat);
    brushRing.visible = false;
    scene.add(brushRing);

    const meshBuilder = new QWorldTerrainMesh(chunkTree);
    const sharedIndexAttr = new THREE.BufferAttribute(meshBuilder.getSharedIndices(), 1);
    const ownsWorker = !externalWorkerClient;
    const workerClient = externalWorkerClient ?? new QWorldTerrainWorkerClient();
    if (ownsWorker) {
      workerClient.syncWorld(chunkTree);
    }

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Shared globe-warped materials for routes & polylines (prevents shader recompilation on vector rebuilds)
    const riverLineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    applyGlobeWarp(riverLineMat, 'poly-line-river-globe-v1');
    const roadLineMat = new THREE.LineBasicMaterial({ color: 0xd97706 });
    applyGlobeWarp(roadLineMat, 'poly-line-road-globe-v1');
    const routeRibbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyGlobeWarp(routeRibbonMat, 'route-ribbon-globe-v1');
    const weatherSolidMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    applyGlobeWarp(weatherSolidMat, 'weather-solid-globe-v1');
    const weatherAlphaMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyGlobeWarp(weatherAlphaMat, 'weather-alpha-globe-v1');

    const sharedMaterials = new Set<THREE.Material>([
      terrainMat,
      pinMat,
      redFaultLineMat,
      blueFaultLineMat,
      riverLineMat,
      roadLineMat,
      routeRibbonMat,
      weatherSolidMat,
      weatherAlphaMat,
    ]);

    const chunkMeshMap = new Map<string, THREE.Mesh>();
    const staleMeshes: THREE.Mesh[] = [];
    const pendingUploads: ChunkMeshMessage[] = [];
    let activeRequestSeq = 0;
    let activeRequestDone = true;
    let activeSpan = chunkTree.getChunkWorldSpan(computeLodFromDistance(camStateRef.current.distance));

    const disposeStaleMeshes = () => {
      while (staleMeshes.length > 0) {
        const m = staleMeshes.pop()!;
        terrainGroup.remove(m);
        if (m.geometry) m.geometry.dispose();
      }
    };

    const flushPendingTerrainUploads = () => {
      if (pendingUploads.length > 0) {
        const startTime = performance.now();
        let uploaded = 0;
        while (pendingUploads.length > 0 && (uploaded < 1 || (uploaded < 4 && performance.now() - startTime < 4.0))) {
          const msg = pendingUploads.shift()!;
          if (msg.requestSeq !== activeRequestSeq) continue;

          const key = `${msg.wrappedCx}:${msg.cz}`;
          const prev = chunkMeshMap.get(key);
          if (prev) {
            terrainGroup.remove(prev);
            if (prev.geometry) prev.geometry.dispose();
          }

          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(msg.positions, 3));
          geo.setAttribute('normal', new THREE.BufferAttribute(msg.normals, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(msg.colors, 3));
          geo.setIndex(sharedIndexAttr);

          const mesh = new THREE.Mesh(geo, terrainMat);
          mesh.frustumCulled = false;
          mesh.userData.wrappedCx = msg.wrappedCx;
          mesh.userData.cz = msg.cz;
          mesh.position.set(msg.cx * activeSpan, 0, msg.cz * activeSpan);
          terrainGroup.add(mesh);
          chunkMeshMap.set(key, mesh);
          uploaded++;
        }
      }

      if (activeRequestDone && pendingUploads.length === 0 && staleMeshes.length > 0) {
        disposeStaleMeshes();
      }
    };

    workerClient.setHandlers({
      onChunkMesh: (msg) => {
        if (msg.refinedChunks) {
          for (const rc of msg.refinedChunks) {
            if (!chunkTree.getChunk(rc.lod, rc.cx, rc.cz)) {
              chunkTree.setChunk(rc);
            }
          }
        }
        if (msg.requestSeq !== activeRequestSeq) return;
        pendingUploads.push(msg);
      },
      onRequestComplete: (msg) => {
        if (msg.requestSeq !== activeRequestSeq) return;
        activeRequestDone = true;
      },
      onRollupComplete: (msg) => {
        for (const c of msg.chunks) {
          chunkTree.setChunk(c);
        }
      },
      onRefinedChunks: (msg) => {
        for (const c of msg.chunks) {
          if (!chunkTree.getChunk(c.lod, c.cx, c.cz)) {
            chunkTree.setChunk(c);
          }
        }
      },
    });

    const clearGroup = (g: THREE.Group, sharedMaterial?: THREE.Material) => {
      while (g.children.length > 0) {
        const child = g.children[0] as THREE.Mesh | THREE.Line;
        g.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (
          child.material &&
          child.material !== sharedMaterial &&
          !sharedMaterials.has(child.material as THREE.Material)
        ) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => {
              if (!sharedMaterials.has(m)) m.dispose();
            });
          } else {
            child.material.dispose();
          }
        }
      }
    };

    let lastVectorBuildDist = camStateRef.current.distance;
    let lastVectorLod = -1;
    let lastTerrainLod = -1;
    let lastTerrainMode: TerrainRenderMode | null = null;
    let lastTerrainFlat: boolean | null = null;
    let lastTerrainTemp: number | null = null;
    let lastTerrainSea: number | null = null;
    let lastTerrainRev = -1;
    let lastAshKey = '';

    const rebuildTerrain = () => {
      const cam = camStateRef.current;
      if (propsRef.current.cameraTargetRef) {
        propsRef.current.cameraTargetRef.current = { x: cam.targetX, z: cam.targetZ, distance: cam.distance };
      }

      const lod = computeLodFromDistance(cam.distance);
      if (lod !== propsRef.current.activeLod) {
        propsRef.current.onActiveLodChange(lod);
      }

      gridUniforms.uGridSpacing.value = chunkTree.getSampleSpacing(lod);
      gridUniforms.uShowGrid.value = 1.0;

      const span = chunkTree.getChunkWorldSpan(lod);
      const chunksX = WORLD_L0_CHUNKS_X * Math.pow(3, lod);
      const chunksZ = WORLD_L0_CHUNKS_Z * Math.pow(3, lod);
      const centerCx = Math.floor(cam.targetX / span);
      const centerCz = Math.floor(cam.targetZ / span);

      const curMode = propsRef.current.renderMode;
      const curFlat = propsRef.current.flatWaterSurface;
      const curTemp = propsRef.current.solarDeclinationDeg;
      const curSea = propsRef.current.seaLevel;
      const curTerrainRev = propsRef.current.terrainRevision;
      const curAshKey = propsRef.current.weatherLayers.renderAshInWorld
        ? `ash:${propsRef.current.weatherRevision}`
        : 'ash:off';

      const canReuseMeshes =
        lastTerrainLod === lod &&
        lastTerrainMode === curMode &&
        lastTerrainFlat === curFlat &&
        lastTerrainTemp === curTemp &&
        lastTerrainSea === curSea &&
        lastTerrainRev === curTerrainRev &&
        lastAshKey === curAshKey;

      if (ownsWorker && lastTerrainRev !== -1 && curTerrainRev !== lastTerrainRev) {
        workerClient.syncWorld(chunkTree);
      }
      if (ownsWorker && curAshKey !== lastAshKey) {
        const f = propsRef.current.weatherLayers.renderAshInWorld ? propsRef.current.volcanicFallout : null;
        workerClient.syncAtmosphere(f ? f.ashFallout : null, f ? f.skyVeil : null);
      }

      if (!canReuseMeshes) {
        for (const mesh of chunkMeshMap.values()) {
          staleMeshes.push(mesh);
        }
        chunkMeshMap.clear();
      }

      activeSpan = span;
      lastTerrainLod = lod;
      lastTerrainMode = curMode;
      lastTerrainFlat = curFlat;
      lastTerrainTemp = curTemp;
      lastTerrainSea = curSea;
      lastTerrainRev = curTerrainRev;
      lastAshKey = curAshKey;

      const ringRadius = lod === 0 ? 4 : lod >= 5 ? 3 : 2;
      const minCx = lod === 0 ? centerCx - 3 : centerCx - ringRadius;
      const maxCx = lod === 0 ? centerCx + 4 : centerCx + ringRadius;

      const needed = new Map<string, { cx: number; cz: number; wrappedCx: number; distSq: number }>();
      for (let cz = centerCz - ringRadius; cz <= centerCz + ringRadius; cz++) {
        if (cz < 0 || cz >= chunksZ) continue;
        for (let cx = minCx; cx <= maxCx; cx++) {
          const wrappedCx = ((cx % chunksX) + chunksX) % chunksX;
          const key = `${wrappedCx}:${cz}`;
          if (!needed.has(key)) {
            const dx = cx - centerCx;
            const dz = cz - centerCz;
            needed.set(key, { cx, cz, wrappedCx, distSq: dx * dx + dz * dz });
          }
        }
      }

      // Evict only meshes that left the visible ring
      for (const [key, mesh] of chunkMeshMap.entries()) {
        if (!needed.has(key)) {
          terrainGroup.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
          chunkMeshMap.delete(key);
        }
      }

      // Reposition existing meshes in-place and queue missing chunks to the background worker
      const missingItems: (ChunkRequestItem & { distSq: number })[] = [];
      for (const [key, item] of needed.entries()) {
        const existing = chunkMeshMap.get(key);
        if (existing) {
          existing.position.set(item.cx * span, 0, item.cz * span);
          continue;
        }
        missingItems.push({ cx: item.cx, cz: item.cz, wrappedCx: item.wrappedCx, distSq: item.distSq });
      }

      if (missingItems.length > 0) {
        missingItems.sort((a, b) => a.distSq - b.distSq);
        const prefetchItems: (ChunkRequestItem & { distSq: number })[] = [];
        if (lod > 0) {
          const prefRadius = ringRadius + 1;
          const seenPrefetch = new Set<string>();
          for (let cz = centerCz - prefRadius; cz <= centerCz + prefRadius; cz++) {
            if (cz < 0 || cz >= chunksZ) continue;
            for (let cx = centerCx - prefRadius; cx <= centerCx + prefRadius; cx++) {
              const wrappedCx = ((cx % chunksX) + chunksX) % chunksX;
              const key = `${wrappedCx}:${cz}`;
              if (needed.has(key) || seenPrefetch.has(key) || chunkTree.getChunk(lod, wrappedCx, cz)) continue;
              seenPrefetch.add(key);
              const dx = cx - centerCx;
              const dz = cz - centerCz;
              prefetchItems.push({ cx, cz, wrappedCx, distSq: dx * dx + dz * dz });
            }
          }
          prefetchItems.sort((a, b) => a.distSq - b.distSq);
        }

        pendingUploads.length = 0;
        activeRequestDone = false;
        activeRequestSeq = workerClient.requestChunks({
          lod,
          mode: curMode,
          flatWaterSurface: curFlat,
          solarDeclinationDeg: curTemp,
          seaLevel: curSea,
          baseTempC: propsRef.current.baseTempC,
          items: missingItems.map(({ cx, cz, wrappedCx }) => ({ cx, cz, wrappedCx })),
          prefetchItems: prefetchItems.map(({ cx, cz, wrappedCx }) => ({ cx, cz, wrappedCx })),
        });
        flushPendingTerrainUploads();
      } else {
        activeRequestSeq++;
        workerClient.cancelBefore(activeRequestSeq);
        pendingUploads.length = 0;
        activeRequestDone = true;
        disposeStaleMeshes();
      }

      // People-level (L7..L9) instanced trees & rocks
      clearGroup(propGroup);
      if (lod >= 7) {
        const visibleBounds = {
          minX: (centerCx - ringRadius) * span,
          maxX: (centerCx + ringRadius + 1) * span,
          minZ: (centerCz - ringRadius) * span,
          maxZ: (centerCz + ringRadius + 1) * span,
        };
        const transforms = meshBuilder.collectVisiblePropTransforms(
          lod,
          visibleBounds,
          2500,
          propsRef.current.solarDeclinationDeg,
          propsRef.current.seaLevel
        );
        const trees = transforms.filter((t) => t.biomeId === 2 || t.biomeId === 6);
        const rocks = transforms.filter((t) => t.biomeId === 3);

        if (trees.length > 0) {
          const treeGeo = new THREE.ConeGeometry(1.6, 5.5, 6);
          treeGeo.translate(0, 2.75, 0);
          const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
          const inst = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
          const dummy = new THREE.Object3D();
          const tmpColor = new THREE.Color();
          const curTemp = propsRef.current.solarDeclinationDeg;
          const activeFallout =
            propsRef.current.weatherLayers.renderAshInWorld ? propsRef.current.volcanicFallout : null;
          trees.forEach((t, i) => {
            const ashNorm = activeFallout
              ? sampleAtmosByteAtWorld(activeFallout.ashFallout, t.x, t.z) / 255
              : 0;
            const app = computeFoliagePropAppearance(
              t.biomeId,
              t.z,
              t.y / ELEVATION_SCALE - propsRef.current.seaLevel,
              curTemp,
              propsRef.current.baseTempC,
              ashNorm
            );
            dummy.position.set(t.x, t.y, t.z);
            dummy.scale.setScalar(t.scale * app.scaleMul);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
            tmpColor.setRGB(app.r, app.g, app.b);
            inst.setColorAt(i, tmpColor);
          });
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          propGroup.add(inst);
        }

        if (rocks.length > 0) {
          const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
          const rockMat = new THREE.MeshLambertMaterial({ color: 0x64748b });
          const inst = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
          const dummy = new THREE.Object3D();
          rocks.forEach((t, i) => {
            dummy.position.set(t.x, t.y + 0.6, t.z);
            dummy.scale.setScalar(t.scale);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
          });
          propGroup.add(inst);
        }
      }
    };

    const updateVectorWrapPositions = () => {
      const tx = camStateRef.current.targetX;
      for (let i = 0; i < vectorGroup.children.length; i++) {
        const child = vectorGroup.children[i];
        const pinX = child.userData.wrapPinX;
        if (typeof pinX === 'number') {
          child.position.x = tx + wrapDeltaX(pinX - tx);
          continue;
        }
        const midX = child.userData.wrapMidX;
        if (typeof midX === 'number') {
          child.position.x = Math.round((tx - midX) / WORLD_SPAN_X) * WORLD_SPAN_X;
        }
      }
    };

    const rebuildVectors = () => {
      const cam = camStateRef.current;
      const lod = computeLodFromDistance(cam.distance);
      const span = chunkTree.getChunkWorldSpan(lod);
      const centerCx = Math.floor(cam.targetX / span);
      const centerCz = Math.floor(cam.targetZ / span);
      const ringRadius = lod === 0 ? 4 : lod >= 5 ? 3 : 2;
      const flatWater = propsRef.current.flatWaterSurface;
      const curSeaLevel = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);

      lastVectorBuildDist = cam.distance;
      lastVectorLod = lod;

      clearGroup(vectorGroup, pinMat);
      const isGlobeMacro = lod <= 2;
      const visibleBounds = isGlobeMacro
        ? { minX: 0, maxX: WORLD_SPAN_X, minZ: 0, maxZ: WORLD_SPAN_Z }
        : {
            minX: (centerCx - ringRadius) * span,
            maxX: (centerCx + ringRadius + 1) * span,
            minZ: (centerCz - ringRadius) * span,
            maxZ: (centerCz + ringRadius + 1) * span,
          };
      const baseQuery = vectorTree.queryVisible(visibleBounds, lod);
      const markerMap = new Map(baseQuery.markers.map((m) => [m.id, m]));
      const routeMap = new Map(baseQuery.routes.map((r) => [r.id, r]));
      const polyMap = new Map(baseQuery.polylines.map((p) => [p.id, p]));

      if (!isGlobeMacro && visibleBounds.minX < 0) {
        const wrapped = vectorTree.queryVisible(
          {
            minX: WORLD_SPAN_X + visibleBounds.minX,
            maxX: WORLD_SPAN_X,
            minZ: visibleBounds.minZ,
            maxZ: visibleBounds.maxZ,
          },
          lod
        );
        for (const m of wrapped.markers) markerMap.set(m.id, m);
        for (const r of wrapped.routes) routeMap.set(r.id, r);
        for (const p of wrapped.polylines) polyMap.set(p.id, p);
      }
      if (!isGlobeMacro && visibleBounds.maxX > WORLD_SPAN_X) {
        const wrapped = vectorTree.queryVisible(
          {
            minX: 0,
            maxX: visibleBounds.maxX - WORLD_SPAN_X,
            minZ: visibleBounds.minZ,
            maxZ: visibleBounds.maxZ,
          },
          lod
        );
        for (const m of wrapped.markers) markerMap.set(m.id, m);
        for (const r of wrapped.routes) routeMap.set(r.id, r);
        for (const p of wrapped.polylines) polyMap.set(p.id, p);
      }

      const markers = Array.from(markerMap.values());
      const routes = Array.from(routeMap.values());
      const polylines = Array.from(polyMap.values());
      const roadPolylines = polylines.filter((p) => p.type === 'road');
      const linearYBias = Math.max(0.6, cam.distance * 0.0007);

      for (const poly of polylines) {
        if (poly.points.length < 2) continue;
        if (poly.type === 'road') continue; // Rendered via terrain-draped ribbon network below
        if (poly.type === 'fault' && !propsRef.current.showFaultLines) continue;
        const yBias = poly.type === 'fault' ? Math.max(2.5, span * 0.0005) : linearYBias;
        const pts = poly.points.map(
          (p) =>
            new THREE.Vector3(
              p.x,
              chunkTree.getSurfaceHeightAt(lod, p.x, p.z, flatWater, curSeaLevel) * ELEVATION_SCALE + yBias,
              p.z
            )
        );
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat =
          poly.type === 'fault'
            ? poly.faultKind === 'depression'
              ? blueFaultLineMat
              : redFaultLineMat
            : riverLineMat;

        // Share geometry across -WORLD_SPAN_X, 0, +WORLD_SPAN_X so horizontal wrap never rebuilds polylines
        for (const offsetX of [-WORLD_SPAN_X, 0, WORLD_SPAN_X]) {
          const line = new THREE.Line(geo, mat);
          line.position.x = offsetX;
          vectorGroup.add(line);
        }
      }

      // Render planned routes & roads as 3D terrain-draped ribbons (thicker along merged busy corridors)
      const spacing = chunkTree.getSampleSpacing(lod);
      const maxRouteSubStep = Math.max(spacing * 0.75, cam.distance * 0.004);
      const routeYBias = Math.max(0.65, cam.distance * 0.00085);

      const strands: MergedRouteStrand[] = propsRef.current.mergeRouteNetwork
        ? buildMergedRouteNetwork({
            routes,
            roadPolylines,
            cellSize: Math.max(6, Math.min(spacing * 0.6, cam.distance * 0.0035)),
            cameraTargetX: cam.targetX,
            selectedRouteId: propsRef.current.selectedRouteId,
          })
        : [
            ...roadPolylines.map((rp) => ({
              points: rp.points,
              state: 'road' as const,
              trafficCount: 1,
              isSelected: false,
            })),
            ...routes.map((rt) => ({
              points: rt.points,
              state: rt.state,
              trafficCount: 1,
              isSelected: propsRef.current.selectedRouteId === rt.id,
            })),
          ];

      strands.sort(
        (a, b) =>
          (a.isSelected ? 100 : 0) +
          Math.min(a.trafficCount, 8) -
          ((b.isSelected ? 100 : 0) + Math.min(b.trafficCount, 8))
      );

      for (const strand of strands) {
        if (strand.points.length < 2) continue;

        // Unwrap X continuously across 0 / WORLD_SPAN_X and center near camera targetX
        const unwrapped: { x: number; z: number }[] = [];
        let curX = strand.points[0].x;
        unwrapped.push({ x: curX, z: strand.points[0].z });
        for (let i = 1; i < strand.points.length; i++) {
          const prevWrapped = ((curX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
          curX += wrapDeltaX(strand.points[i].x - prevWrapped);
          unwrapped.push({ x: curX, z: strand.points[i].z });
        }
        const midX = 0.5 * (unwrapped[0].x + unwrapped[unwrapped.length - 1].x);
        const shiftX = Math.round((cam.targetX - midX) / WORLD_SPAN_X) * WORLD_SPAN_X;

        const strandYBias =
          routeYBias *
          (1 + (strand.isSelected ? 0.38 : Math.min(strand.trafficCount, 6) * 0.05));

        const pts3d: THREE.Vector3[] = [];
        let remainingBudget = 450;
        const segCount = unwrapped.length - 1;
        for (let i = 0; i < segCount; i++) {
          const a = unwrapped[i];
          const b = unwrapped[i + 1];
          const segLen = Math.hypot(b.x - a.x, b.z - a.z);
          const maxForSeg = Math.max(1, Math.floor(remainingBudget / Math.max(1, segCount - i)));
          const steps = Math.max(1, Math.min(Math.ceil(segLen / maxRouteSubStep), maxForSeg));
          remainingBudget -= steps;
          const startS = i === 0 ? 0 : 1;
          for (let s = startS; s <= steps; s++) {
            const t = s / steps;
            const ux = a.x + (b.x - a.x) * t;
            const uz = a.z + (b.z - a.z) * t;
            const sampleX = ((ux % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
            const py =
              chunkTree.getSurfaceHeightAt(lod, sampleX, uz, flatWater, curSeaLevel) * ELEVATION_SCALE +
              strandYBias;
            pts3d.push(new THREE.Vector3(ux, py, uz));
          }
        }

        const baseHalfW =
          strand.state === 'path'
            ? Math.max(0.85, cam.distance * 0.00095)
            : strand.state === 'built_road'
              ? Math.max(1.5, cam.distance * 0.00155)
              : Math.max(1.15, cam.distance * 0.0012);
        const trafficScale = 1 + (Math.min(strand.trafficCount, 8) - 1) * 0.65;
        const selScale = strand.isSelected ? 1.2 : 1.0;
        const halfWidth = baseHalfW * trafficScale * selScale;

        const colorHex = strand.isSelected
          ? 0x38bdf8
          : strand.state === 'path'
            ? 0xfbbf24
            : strand.state === 'building'
              ? 0xfb923c
              : strand.state === 'built_road'
                ? 0xfef3c7
                : strand.trafficCount >= 2
                  ? 0xfbbf24
                  : 0xf59e0b;

        const ribbonStyle =
          strand.state === 'path' ? 'path' : strand.state === 'building' ? 'building' : 'solid';
        const ribbonGeo = buildRouteStrandRibbonGeometry(pts3d, halfWidth, colorHex, ribbonStyle);
        if (ribbonGeo) {
          const mesh = new THREE.Mesh(ribbonGeo, routeRibbonMat);
          mesh.userData.wrapMidX = midX;
          mesh.position.x = shiftX;
          vectorGroup.add(mesh);
        }
      }

      if (propsRef.current.draftPoints.length >= 2) {
        const pts = propsRef.current.draftPoints.map(
          (p) =>
            new THREE.Vector3(
              p.x,
              chunkTree.getSurfaceHeightAt(lod, p.x, p.z, flatWater, curSeaLevel) * ELEVATION_SCALE + 1.0,
              p.z
            )
        );
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const color = propsRef.current.toolMode === 'river' ? 0x7dd3fc : 0xfbbf24;
        vectorGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
      }

      // Polygon area outline & draggable vertex handles
      const polyPts = propsRef.current.polygonPoints;
      if (polyPts.length > 0) {
        const handleRadius = Math.max(4, cam.distance * 0.009);
        const lineVecs: THREE.Vector3[] = [];
        for (const p of polyPts) {
          const py = chunkTree.getSurfaceHeightAt(lod, p.x, p.z, flatWater, curSeaLevel) * ELEVATION_SCALE + handleRadius * 0.5;
          lineVecs.push(new THREE.Vector3(p.x, py, p.z));
          const handleGeo = new THREE.SphereGeometry(handleRadius, 12, 12);
          const handleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          const sphere = new THREE.Mesh(handleGeo, handleMat);
          sphere.position.set(p.x, py, p.z);
          vectorGroup.add(sphere);
        }
        if (polyPts.length >= 2) {
          if (polyPts.length >= 3) lineVecs.push(lineVecs[0].clone());
          const lineGeo = new THREE.BufferGeometry().setFromPoints(lineVecs);
          vectorGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8 })));
        }
      }

      // Marker 3D pins (tip snapped directly to terrain surface height)
      const pinScale = Math.max(4, cam.distance * 0.012);
      for (const m of markers) {
        const preset = MARKER_PRESETS.find((p) => p.category === m.category);
        const isSel = propsRef.current.selectedMarkerId === m.id;
        const pinRadius = pinScale * (isSel ? 0.6 : 0.45);
        const pinHeight = pinScale * (isSel ? 1.8 : 1.4);
        const pinColor = isSel ? '#38bdf8' : (preset?.color ?? '#f59e0b');
        const pinGeo = buildTipAnchoredPinGeometry(pinRadius, pinHeight, pinColor);
        const pin = new THREE.Mesh(pinGeo, pinMat);
        const renderX = cam.targetX + wrapDeltaX(m.x - cam.targetX);
        const surfaceY = chunkTree.getSurfaceHeightAt(lod, m.x, m.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
        pin.userData.wrapPinX = m.x;
        pin.position.set(renderX, surfaceY, m.z);
        vectorGroup.add(pin);
      }

      // Temporary marker pin (when clicking map in marker mode)
      const tp = propsRef.current.tempPin;
      if (tp) {
        const pinGeo = buildTipAnchoredPinGeometry(pinScale * 0.55, pinScale * 1.6, '#22d3ee');
        const pin = new THREE.Mesh(pinGeo, pinMat);
        const renderX = cam.targetX + wrapDeltaX(tp.x - cam.targetX);
        const surfaceY = chunkTree.getSurfaceHeightAt(lod, tp.x, tp.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
        pin.userData.wrapPinX = tp.x;
        pin.position.set(renderX, surfaceY, tp.z);
        vectorGroup.add(pin);
      }

      // Active route planner custom terrain pins & guide preview when in Road tool
      const activeStops = propsRef.current.routeStops ?? [];
      if (propsRef.current.toolMode === 'road' && activeStops.length > 0) {
        for (let i = 0; i < activeStops.length; i++) {
          const st = activeStops[i];
          if (st.markerId) continue; // Marker stops already have a 3D marker pin
          const info = getRouteStopBadgeInfo(i, activeStops.length);
          const pinGeo = buildTipAnchoredPinGeometry(pinScale * 0.5, pinScale * 1.55, info.color);
          const pin = new THREE.Mesh(pinGeo, pinMat);
          const renderX = cam.targetX + wrapDeltaX(st.x - cam.targetX);
          const surfaceY =
            chunkTree.getSurfaceHeightAt(lod, st.x, st.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
          pin.userData.wrapPinX = st.x;
          pin.position.set(renderX, surfaceY, st.z);
          vectorGroup.add(pin);
        }

        if (activeStops.length >= 2) {
          const unwrappedStops: { x: number; z: number }[] = [];
          let curX = activeStops[0].x;
          unwrappedStops.push({ x: curX, z: activeStops[0].z });
          for (let i = 1; i < activeStops.length; i++) {
            const prevW = ((curX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
            curX += wrapDeltaX(activeStops[i].x - prevW);
            unwrappedStops.push({ x: curX, z: activeStops[i].z });
          }
          const midX = 0.5 * (unwrappedStops[0].x + unwrappedStops[unwrappedStops.length - 1].x);
          const shiftX = Math.round((cam.targetX - midX) / WORLD_SPAN_X) * WORLD_SPAN_X;
          const guidePts = unwrappedStops.map((p) => {
            const sx = ((p.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
            const sy =
              chunkTree.getSurfaceHeightAt(lod, sx, p.z, flatWater, curSeaLevel) * ELEVATION_SCALE +
              routeYBias * 1.6;
            return new THREE.Vector3(p.x, sy, p.z);
          });
          const guideRibbon = buildRouteStrandRibbonGeometry(
            guidePts,
            Math.max(0.75, cam.distance * 0.00085),
            0x38bdf8,
            'path'
          );
          if (guideRibbon) {
            const guideMesh = new THREE.Mesh(guideRibbon, routeRibbonMat);
            guideMesh.userData.wrapMidX = midX;
            guideMesh.position.x = shiftX;
            vectorGroup.add(guideMesh);
          }
        }
      }
    };

    const clearWeatherGroup = () => {
      const disposedGeos = new Set<THREE.BufferGeometry>();
      while (weatherGroup.children.length > 0) {
        const obj = weatherGroup.children.pop()!;
        weatherGroup.remove(obj);
        if (obj instanceof THREE.Mesh && obj.geometry && !disposedGeos.has(obj.geometry)) {
          disposedGeos.add(obj.geometry);
          obj.geometry.dispose();
        }
      }
    };

    const addWrappedWeatherMesh = (geo: THREE.BufferGeometry | null, mat: THREE.Material) => {
      if (!geo) return;
      for (const offsetX of [-WORLD_SPAN_X, 0, WORLD_SPAN_X]) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = offsetX;
        mesh.frustumCulled = false;
        weatherGroup.add(mesh);
      }
    };

    const rebuildWeather = () => {
      clearWeatherGroup();
      const cam = camStateRef.current;
      const p = propsRef.current;
      const layers = p.weatherLayers;
      const atmos = p.atmosphereField;
      const fallout = p.volcanicFallout;
      const curSea = p.seaLevel + getSeaLevelOffsetForTemp(p.solarDeclinationDeg);

      meshBuilder.setAtmosphereOverlays(
        layers.renderAshInWorld && fallout ? fallout.ashFallout : null,
        layers.renderAshInWorld && fallout ? fallout.skyVeil : null
      );

      if (layers.showStormRisk && atmos) {
        addWrappedWeatherMesh(
          buildStormRiskGeometry(chunkTree, atmos, cam.distance, p.flatWaterSurface, curSea),
          weatherAlphaMat
        );
      }
      if (layers.showFalloutOverlay && fallout) {
        addWrappedWeatherMesh(
          buildFalloutOverlayGeometry(chunkTree, fallout, cam.distance, p.flatWaterSurface, curSea),
          weatherAlphaMat
        );
      }
      if (layers.showSurfaceWind && atmos) {
        addWrappedWeatherMesh(
          buildWindArrowGeometry(chunkTree, atmos, false, cam.distance, p.flatWaterSurface, curSea),
          weatherSolidMat
        );
      }
      if (layers.showHighWind && atmos) {
        addWrappedWeatherMesh(
          buildWindArrowGeometry(chunkTree, atmos, true, cam.distance, p.flatWaterSurface, curSea),
          weatherSolidMat
        );
      }
      if ((layers.renderAshInWorld || layers.showFalloutOverlay) && atmos && p.volcanoSources.length > 0) {
        addWrappedWeatherMesh(
          buildVolcanoPlumesGeometry(
            chunkTree,
            atmos,
            p.volcanoSources,
            cam.distance,
            p.flatWaterSurface,
            curSea
          ),
          weatherSolidMat
        );
      }
    };

    const rebuildVisibleScene = () => {
      rebuildWeather();
      rebuildTerrain();
      rebuildVectors();
    };

    rebuildTerrainRef.current = rebuildTerrain;
    rebuildVectorsRef.current = rebuildVectors;
    rebuildWeatherRef.current = rebuildWeather;
    rebuildVisibleScene();

    const rayU = new THREE.Vector3();
    const rayV = new THREE.Vector3();
    const rayTmp = new THREE.Vector3();
    const rayCand = new THREE.Vector3();

    const getHitPoint = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      const globeBlend = gridUniforms.uGlobeBlend.value;
      if (globeBlend <= 0.001) {
        const hits = raycaster.intersectObjects(terrainGroup.children, false);
        if (hits.length > 0) return hits[0].point;

        const planeHit = new THREE.Vector3();
        return raycaster.ray.intersectPlane(fallbackPlane, planeHit);
      }

      // Globe-warped ray intersection matching the vertex shader & marker projection
      const cam = camStateRef.current;
      const lod = computeLodFromDistance(cam.distance);
      const flatWater = propsRef.current.flatWaterSurface;
      const curSeaLevel = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;

      if (Math.abs(dir.y) < 0.9) {
        rayTmp.set(0, 1, 0);
      } else {
        rayTmp.set(1, 0, 0);
      }
      rayU.crossVectors(rayTmp, dir).normalize();
      rayV.crossVectors(dir, rayU).normalize();

      const maxHalfSpan = PLANET_RADIUS_YARDS * Math.PI * 0.495;
      let wx = cam.targetX;
      let wz = cam.targetZ;
      let wy = 0;

      const evalRayError = (x: number, y: number, z: number): [number, number] => {
        projectWorldToRendered(x, y, z, cam.targetX, cam.targetZ, globeBlend, rayCand);
        rayTmp.subVectors(rayCand, origin);
        return [rayTmp.dot(rayU), rayTmp.dot(rayV)];
      };

      for (let iter = 0; iter < 8; iter++) {
        if (iter >= 5) {
          const wrappedSampleX = ((wx % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
          const clampedSampleZ = Math.max(0, Math.min(WORLD_SPAN_Z, wz));
          wy = chunkTree.getSurfaceHeightAt(lod, wrappedSampleX, clampedSampleZ, flatWater, curSeaLevel) * ELEVATION_SCALE;
        }
        const [u0, v0] = evalRayError(wx, wy, wz);
        if (iter >= 5 && u0 * u0 + v0 * v0 < 0.25) break;

        const eps = 12;
        const [uX, vX] = evalRayError(wx + eps, wy, wz);
        const [uZ, vZ] = evalRayError(wx, wy, wz + eps);
        const duDx = (uX - u0) / eps;
        const dvDx = (vX - v0) / eps;
        const duDz = (uZ - u0) / eps;
        const dvDz = (vZ - v0) / eps;
        const det = duDx * dvDz - duDz * dvDx;
        if (Math.abs(det) < 1e-12) break;

        let stepX = -(dvDz * u0 - duDz * v0) / det;
        let stepZ = -(-dvDx * u0 + duDx * v0) / det;
        const stepMag = Math.hypot(stepX, stepZ);
        const maxStep = PLANET_RADIUS_YARDS * 0.42;
        if (stepMag > maxStep) {
          const s = maxStep / stepMag;
          stepX *= s;
          stepZ *= s;
        }

        wx = Math.max(cam.targetX - maxHalfSpan, Math.min(cam.targetX + maxHalfSpan, wx + stepX));
        wz = Math.max(
          Math.max(0, cam.targetZ - maxHalfSpan),
          Math.min(Math.min(WORLD_SPAN_Z, cam.targetZ + maxHalfSpan), wz + stepZ)
        );
      }

      const wrappedFinalX = ((wx % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
      const clampedFinalZ = Math.max(0, Math.min(WORLD_SPAN_Z, wz));
      wy = chunkTree.getSurfaceHeightAt(lod, wrappedFinalX, clampedFinalZ, flatWater, curSeaLevel) * ELEVATION_SCALE;
      const [finalU, finalV] = evalRayError(wx, wy, wz);
      const rayForwardT = rayTmp.subVectors(rayCand, origin).dot(dir);
      const maxTolerance = Math.max(800, cam.distance * 0.004);
      if (rayForwardT <= 0 || finalU * finalU + finalV * finalV > maxTolerance * maxTolerance) {
        return null;
      }

      return new THREE.Vector3(wx, wy, clampedFinalZ);
    };

    const pickProjVec = new THREE.Vector3();
    const pickMarkerAtPointer = (clientX: number, clientY: number, hit: THREE.Vector3 | null) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const cam = camStateRef.current;
      const lod = computeLodFromDistance(cam.distance);
      const globeBlend = gridUniforms.uGlobeBlend.value;
      const flatWater = propsRef.current.flatWaterSurface;
      const curSeaLevel = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);
      const pinScale = Math.max(4, cam.distance * 0.012);

      const worldPickRadius = Math.max(25, cam.distance * 0.03);
      const worldPickSq = worldPickRadius * worldPickRadius;
      const screenPickSq = 20 * 20;

      let bestMarker: ReturnType<typeof vectorTree.getMarker> = undefined;
      let bestScore = Infinity;

      for (const m of vectorTree.getAllMarkers()) {
        if (lod < m.minLod || lod > m.maxLod) continue;
        const dx = wrapDeltaX(m.x - cam.targetX);
        const dz = m.z - cam.targetZ;
        const dLon = dx / PLANET_RADIUS_YARDS;
        const dLat = dz / PLANET_RADIUS_YARDS;
        if (globeBlend > 0.5 && (Math.abs(dLon) > Math.PI * 0.5 || Math.abs(dLat) > Math.PI * 0.5)) {
          continue;
        }

        // Check screen-space proximity to marker pin tip and head
        const surfaceY = chunkTree.getSurfaceHeightAt(lod, m.x, m.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
        const headOffset = pinScale * (propsRef.current.selectedMarkerId === m.id ? 1.8 : 1.4);
        let minScreenSq = Infinity;
        for (const sampleY of [surfaceY, surfaceY + headOffset * 0.5, surfaceY + headOffset]) {
          projectWorldToRendered(cam.targetX + dx, sampleY, cam.targetZ + dz, cam.targetX, cam.targetZ, globeBlend, pickProjVec);
          pickProjVec.project(camera);
          if (pickProjVec.z <= 1) {
            const sx = (pickProjVec.x * 0.5 + 0.5) * w;
            const sy = (-pickProjVec.y * 0.5 + 0.5) * h;
            const dSq = (sx - px) * (sx - px) + (sy - py) * (sy - py);
            if (dSq < minScreenSq) minScreenSq = dSq;
          }
        }

        let worldSq = Infinity;
        if (hit) {
          const hdx = wrapDeltaX(m.x - hit.x);
          const hdz = m.z - hit.z;
          worldSq = hdx * hdx + hdz * hdz;
        }

        if (minScreenSq <= screenPickSq || worldSq <= worldPickSq) {
          const normScore = Math.min(minScreenSq / screenPickSq, worldSq / worldPickSq);
          if (normScore < bestScore) {
            bestScore = normScore;
            bestMarker = m;
          }
        }
      }

      return bestMarker ?? null;
    };

    let isDragging = false;
    let dragMode: 'pan' | 'orbit' | 'brush' | 'polyVertex' | 'marker' | null = null;
    let dragVertexIndex = -1;
    let dragMarkerId: string | null = null;
    let pendingPinMarkerId: string | null = null;
    let pendingTerrainPinClick = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let markerHasMoved = false;
    let lastClientX = 0;
    let lastClientY = 0;
    let lastChunkCenterKey = '';
    let lastHoverRaycastTime = 0;

    labelPointerDownRef.current = (e: PointerEvent, markerId: string) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      pendingTerrainPinClick = false;

      if (e.button === 2 || (e.button === 0 && e.altKey)) {
        isDragging = true;
        dragMode = 'orbit';
        return;
      }
      if (e.button === 1) {
        isDragging = true;
        dragMode = 'pan';
        return;
      }
      if (e.button === 0) {
        flyAnimRef.current = null;
        propsRef.current.onSelectMarker?.(markerId);
        const m = vectorTree.getMarker(markerId);
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        markerHasMoved = false;
        if (propsRef.current.toolMode === 'road' && propsRef.current.roadSubMode === 'pins') {
          pendingPinMarkerId = markerId;
        }
        if (m && !m.locked) {
          isDragging = true;
          dragMode = 'marker';
          dragMarkerId = markerId;
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      pendingPinMarkerId = null;
      pendingTerrainPinClick = false;

      if (e.button === 2 || (e.button === 0 && e.altKey)) {
        if (propsRef.current.toolMode === 'river' || propsRef.current.toolMode === 'road') {
          if (e.button === 2 && propsRef.current.draftPoints.length >= 2) {
            propsRef.current.onFinishPath();
            return;
          }
          if (
            e.button === 2 &&
            propsRef.current.toolMode === 'road' &&
            propsRef.current.roadSubMode === 'pins' &&
            (propsRef.current.routeStops?.length ?? 0) >= 2
          ) {
            propsRef.current.onPlanRoute?.();
            return;
          }
        }
        isDragging = true;
        dragMode = 'orbit';
        return;
      }

      if (e.button === 1) {
        isDragging = true;
        dragMode = 'pan';
        return;
      }

      if (e.button === 0) {
        const mode = propsRef.current.toolMode;
        const hit = getHitPoint(e.clientX, e.clientY);

        const isRoadRouteMode = mode === 'road' && propsRef.current.roadSubMode !== 'freehand';
        if (
          mode === 'marker' ||
          mode === 'select' ||
          isRoadRouteMode ||
          (mode === 'road' && propsRef.current.draftPoints.length === 0)
        ) {
          const picked = pickMarkerAtPointer(e.clientX, e.clientY, hit);
          if (picked) {
            flyAnimRef.current = null;
            propsRef.current.onSelectMarker?.(picked.id);
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            markerHasMoved = false;
            if (mode === 'road' && propsRef.current.roadSubMode === 'pins') {
              pendingPinMarkerId = picked.id;
            }
            if (!picked.locked) {
              isDragging = true;
              dragMode = 'marker';
              dragMarkerId = picked.id;
            }
            return;
          }
          if (mode === 'select' || isRoadRouteMode) {
            isDragging = true;
            dragMode = 'pan';
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            if (mode === 'road' && propsRef.current.roadSubMode === 'pins') {
              pendingTerrainPinClick = true;
            }
            return;
          }
        }

        if (!hit) return;
        const lod = computeLodFromDistance(camStateRef.current.distance);

        if (mode === 'elevate' || mode === 'biome') {
          isDragging = true;
          dragMode = 'brush';
          propsRef.current.onBrushStroke(hit.x, hit.z, lod);
        } else if (mode === 'polygon') {
          // Grab nearest vertex if within pick radius, otherwise add a new vertex
          const pickRadius = Math.max(12, camStateRef.current.distance * 0.025);
          const pickSq = pickRadius * pickRadius;
          let hitIdx = -1;
          let bestSq = pickSq;
          propsRef.current.polygonPoints.forEach((p, idx) => {
            const dx = p.x - hit.x;
            const dz = p.z - hit.z;
            const dSq = dx * dx + dz * dz;
            if (dSq < bestSq) {
              bestSq = dSq;
              hitIdx = idx;
            }
          });
          if (hitIdx >= 0) {
            isDragging = true;
            dragMode = 'polyVertex';
            dragVertexIndex = hitIdx;
          } else {
            propsRef.current.onMapClick(hit.x, hit.z, lod);
          }
        } else if (mode === 'marker') {
          const wrappedX = ((hit.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
          const clampedZ = Math.max(0, Math.min(WORLD_SPAN_Z, hit.z));
          propsRef.current.onMapClick(wrappedX, clampedZ, lod);
        } else if (mode === 'river' || mode === 'road') {
          propsRef.current.onMapClick(hit.x, hit.z, lod);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      if (isDragging && dragMode === 'orbit') {
        camStateRef.current.yawDeg -= dx * 0.35;
        camStateRef.current.pitchDeg = Math.max(2, Math.min(89, camStateRef.current.pitchDeg + dy * 0.35));
        return;
      }

      if (isDragging && dragMode === 'pan') {
        const cam = camStateRef.current;
        const panScale = cam.distance * (0.0014 + 0.0012 * gridUniforms.uGlobeBlend.value);
        const yawRad = (cam.yawDeg * Math.PI) / 180;
        const cos = Math.cos(yawRad);
        const sin = Math.sin(yawRad);
        cam.targetX = (((cam.targetX - (dx * cos + dy * sin) * panScale) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        cam.targetZ = Math.max(0, Math.min(WORLD_SPAN_Z, cam.targetZ - (-dx * sin + dy * cos) * panScale));
        return;
      }

      if (isDragging && dragMode === 'marker' && dragMarkerId) {
        const marker = vectorTree.getMarker(dragMarkerId);
        if (!marker || marker.locked) {
          isDragging = false;
          dragMode = null;
          dragMarkerId = null;
          markerHasMoved = false;
          setDraggingMarkerId(null);
          return;
        }
        if (!markerHasMoved) {
          const moveDx = e.clientX - dragStartX;
          const moveDy = e.clientY - dragStartY;
          if (moveDx * moveDx + moveDy * moveDy < 9) return;
          markerHasMoved = true;
          setDraggingMarkerId(dragMarkerId);
        }
        const hit = getHitPoint(e.clientX, e.clientY);
        if (!hit) return;
        const lod = computeLodFromDistance(camStateRef.current.distance);
        const wrappedX = ((hit.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        const clampedZ = Math.max(0, Math.min(WORLD_SPAN_Z, hit.z));
        const curSea = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);
        const surfaceElev = chunkTree.getSurfaceHeightAt(lod, wrappedX, clampedZ, propsRef.current.flatWaterSurface, curSea);
        setCursorWorld({ x: Math.round(wrappedX), z: Math.round(clampedZ), h: Math.round(surfaceElev) });
        propsRef.current.onMoveMarker?.(dragMarkerId, wrappedX, clampedZ, surfaceElev);
        rebuildVectors();
        updateProjectedOverlaysRef.current();
        return;
      }

      if (!isDragging && propsRef.current.toolMode === 'select') {
        const now = performance.now();
        if (now - lastHoverRaycastTime < 45) return;
        lastHoverRaycastTime = now;
      }

      const hit = getHitPoint(e.clientX, e.clientY);
      if (hit) {
        const lod = computeLodFromDistance(camStateRef.current.distance);
        const wrappedHitX = ((hit.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        const clampedHitZ = Math.max(0, Math.min(WORLD_SPAN_Z, hit.z));
        const curSea = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);
        const h = Math.round(
          chunkTree.getSurfaceHeightAt(lod, wrappedHitX, clampedHitZ, propsRef.current.flatWaterSurface, curSea)
        );
        const rx = Math.round(wrappedHitX);
        const rz = Math.round(clampedHitZ);
        setCursorWorld((prev) =>
          prev && prev.x === rx && prev.z === rz && prev.h === h ? prev : { x: rx, z: rz, h }
        );

        if (isDragging && dragMode === 'polyVertex' && dragVertexIndex >= 0) {
          propsRef.current.onUpdatePolygonVertex(dragVertexIndex, hit.x, hit.z);
          return;
        }

        if (propsRef.current.toolMode === 'elevate' || propsRef.current.toolMode === 'biome') {
          const radius = propsRef.current.brushRadiusCells * chunkTree.getSampleSpacing(lod);
          const gb = gridUniforms.uGlobeBlend.value;
          const cam = camStateRef.current;
          const dLon = (hit.x - cam.targetX) / PLANET_RADIUS_YARDS;
          const dLat = (hit.z - cam.targetZ) / PLANET_RADIUS_YARDS;
          if (gb > 0.5 && (Math.abs(dLon) > Math.PI * 0.5 || Math.abs(dLat) > Math.PI * 0.5)) {
            brushRing.visible = false;
          } else {
            brushRing.visible = true;
            projectWorldToRendered(hit.x, hit.y + 1.2, hit.z, cam.targetX, cam.targetZ, gb, brushRing.position);
            brushRing.scale.setScalar(radius);
          }

          if (isDragging && dragMode === 'brush') {
            propsRef.current.onBrushStroke(hit.x, hit.z, lod);
          }
        } else {
          brushRing.visible = false;
        }
      } else {
        brushRing.visible = false;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasBrush = isDragging && dragMode === 'brush';
      const clickPinMarkerId = pendingPinMarkerId;
      const clickTerrainPin = pendingTerrainPinClick;
      const didMoveMarker = markerHasMoved;

      isDragging = false;
      dragMode = null;
      dragMarkerId = null;
      pendingPinMarkerId = null;
      pendingTerrainPinClick = false;
      markerHasMoved = false;
      setDraggingMarkerId(null);

      if (wasBrush) {
        const lod = computeLodFromDistance(camStateRef.current.distance);
        propsRef.current.onBrushEnd?.(lod);
        return;
      }

      if (
        e.button === 0 &&
        propsRef.current.toolMode === 'road' &&
        propsRef.current.roadSubMode === 'pins'
      ) {
        if (clickPinMarkerId && !didMoveMarker) {
          const m = vectorTree.getMarker(clickPinMarkerId);
          if (m) {
            propsRef.current.onAddRouteStopPin?.({
              markerId: m.id,
              label: m.name,
              x: m.x,
              z: m.z,
            });
          }
          return;
        }
        if (clickTerrainPin) {
          const moveDx = e.clientX - dragStartX;
          const moveDy = e.clientY - dragStartY;
          if (moveDx * moveDx + moveDy * moveDy <= 25) {
            const hit = getHitPoint(e.clientX, e.clientY);
            if (hit) {
              const wrappedX = ((hit.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
              const clampedZ = Math.max(0, Math.min(WORLD_SPAN_Z, hit.z));
              propsRef.current.onAddRouteStopPin?.({
                label: 'Pin',
                x: Math.round(wrappedX),
                z: Math.round(clampedZ),
              });
            }
          }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      flyAnimRef.current = null;
      const cam = camStateRef.current;
      const oldDist = cam.distance;
      const factor = e.deltaY > 0 ? 1.14 : 0.88;
      const newDist = Math.max(25, Math.min(6500000, oldDist * factor));
      if (newDist === oldDist) return;

      const hit = getHitPoint(e.clientX, e.clientY);
      if (hit) {
        const scale = newDist / oldDist;
        cam.targetX = (((hit.x + (cam.targetX - hit.x) * scale) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        cam.targetZ = Math.max(0, Math.min(WORLD_SPAN_Z, hit.z + (cam.targetZ - hit.z) * scale));
      }
      cam.distance = newDist;
      propsRef.current.onCameraDistanceChange?.(newDist);

      // Sync camera immediately so rapid wheel ticks within one frame stay locked to the cursor
      if (propsRef.current.cameraTargetRef) {
        propsRef.current.cameraTargetRef.current = { x: cam.targetX, z: cam.targetZ, distance: cam.distance };
      }

      const lod = computeLodFromDistance(cam.distance);
      const targetY = chunkTree.getHeightAt(lod, cam.targetX, cam.targetZ) * ELEVATION_SCALE;
      const yawRad = (cam.yawDeg * Math.PI) / 180;
      const pitchRad = (cam.pitchDeg * Math.PI) / 180;
      const horiz = cam.distance * Math.cos(pitchRad);
      camera.position.set(
        cam.targetX + horiz * Math.sin(yawRad),
        targetY + cam.distance * Math.sin(pitchRad),
        cam.targetZ + horiz * Math.cos(yawRad)
      );
      camera.lookAt(cam.targetX, targetY, cam.targetZ);
      camera.updateMatrixWorld();
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const cam = camStateRef.current;
        if (e.key === 'ArrowRight') {
          cam.targetX = (((cam.targetX + WORLD_SPAN_X * 0.25) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        } else if (e.key === 'ArrowLeft') {
          cam.targetX = (((cam.targetX - WORLD_SPAN_X * 0.25) % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
        } else if (e.key === 'ArrowUp') {
          cam.targetZ = Math.max(0, cam.targetZ - WORLD_SPAN_Z * 0.5);
        } else if (e.key === 'ArrowDown') {
          cam.targetZ = Math.min(WORLD_SPAN_Z, cam.targetZ + WORLD_SPAN_Z * 0.5);
        }
        return;
      }
      if (e.altKey) {
        let digit = -1;
        if (e.code.startsWith('Digit')) {
          digit = Number(e.code.slice(5));
        } else if (e.code.startsWith('Numpad')) {
          digit = Number(e.code.slice(6));
        } else if (e.key >= '0' && e.key <= '9') {
          digit = Number(e.key);
        }
        if (digit >= 0 && digit <= 9) {
          e.preventDefault();
          const nextDist = LOD_TARGET_DISTANCES[digit];
          camStateRef.current.distance = nextDist;
          propsRef.current.onCameraDistanceChange?.(nextDist);
          propsRef.current.onActiveLodChange(digit);
          rebuildTerrainRef.current();
          rebuildVectorsRef.current();
          return;
        }
      }
      if (e.key === 'Enter') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          if (propsRef.current.draftPoints.length >= 2) {
            propsRef.current.onFinishPath();
            return;
          }
          if (
            propsRef.current.toolMode === 'road' &&
            (propsRef.current.routeStops?.length ?? 0) >= 2
          ) {
            propsRef.current.onPlanRoute?.();
            return;
          }
        }
      }
      keysDown.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.key.toLowerCase());

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    const wheelTarget = container.parentElement ?? dom;
    wheelTarget.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    let animId = 0;
    let labelTick = 0;
    const projVec = new THREE.Vector3();

    const updateProjectedOverlays = () => {
      if (!container) return;
      const cam = camStateRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const lod = computeLodFromDistance(cam.distance);
      const globeBlend = gridUniforms.uGlobeBlend.value;
      const flatWater = propsRef.current.flatWaterSurface;
      const curSeaLevel = propsRef.current.seaLevel + getSeaLevelOffsetForTemp(propsRef.current.solarDeclinationDeg);
      const pinScale = Math.max(4, cam.distance * 0.012);

      const nextLabels: ProjectedLabel[] = [];
      for (const m of vectorTree.getAllMarkers()) {
        if (lod < m.minLod || lod > m.maxLod) continue;
        const dx = wrapDeltaX(m.x - cam.targetX);
        const dz = m.z - cam.targetZ;
        const dLon = dx / PLANET_RADIUS_YARDS;
        const dLat = dz / PLANET_RADIUS_YARDS;
        if (globeBlend > 0.5 && (Math.abs(dLon) > Math.PI * 0.5 || Math.abs(dLat) > Math.PI * 0.5)) continue;

        const surfaceY = chunkTree.getSurfaceHeightAt(lod, m.x, m.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
        const pinHeadOffset = pinScale * (propsRef.current.selectedMarkerId === m.id ? 1.8 : 1.4);
        const my = surfaceY + pinHeadOffset;
        projectWorldToRendered(cam.targetX + dx, my, cam.targetZ + dz, cam.targetX, cam.targetZ, globeBlend, projVec);
        projVec.project(camera);
        if (projVec.z > 1) continue;
        const sx = (projVec.x * 0.5 + 0.5) * w;
        const sy = (-projVec.y * 0.5 + 0.5) * h;
        if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
        const preset = MARKER_PRESETS.find((p) => p.category === m.category);
        nextLabels.push({
          id: m.id,
          name: m.name,
          icon: preset?.icon ?? '📍',
          color: preset?.color ?? '#f59e0b',
          screenX: Math.round(sx),
          screenY: Math.round(sy),
          worldX: m.x,
          worldZ: m.z,
          locked: m.locked,
        });
      }
      setLabels((prev) => {
        if (prev.length !== nextLabels.length) return nextLabels;
        for (let i = 0; i < prev.length; i++) {
          const a = prev[i];
          const b = nextLabels[i];
          if (
            a.id !== b.id ||
            a.screenX !== b.screenX ||
            a.screenY !== b.screenY ||
            a.name !== b.name ||
            a.locked !== b.locked ||
            a.color !== b.color
          ) {
            return nextLabels;
          }
        }
        return prev;
      });

      // Project temporary marker pin if placed
      const tp = propsRef.current.tempPin;
      if (tp) {
        const dx = wrapDeltaX(tp.x - cam.targetX);
        const dz = tp.z - cam.targetZ;
        const surfaceY = chunkTree.getSurfaceHeightAt(lod, tp.x, tp.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
        const my = surfaceY + pinScale * 1.6;
        projectWorldToRendered(cam.targetX + dx, my, cam.targetZ + dz, cam.targetX, cam.targetZ, globeBlend, projVec);
        projVec.project(camera);
        const sx = Math.round((projVec.x * 0.5 + 0.5) * w);
        const sy = Math.round((-projVec.y * 0.5 + 0.5) * h);
        if (projVec.z <= 1 && sx >= 0 && sx <= w && sy >= 0 && sy <= h) {
          setTempPinScreen((prev) => (prev && prev.x === sx && prev.y === sy ? prev : { x: sx, y: sy }));
        } else {
          setTempPinScreen((prev) => (prev === null ? prev : null));
        }
      } else {
        setTempPinScreen((prev) => (prev === null ? prev : null));
      }

      // Project custom non-marker route stop pins when in Road tool
      const activeStops = propsRef.current.routeStops ?? [];
      if (propsRef.current.toolMode === 'road' && activeStops.length > 0) {
        const nextPins: ProjectedRoutePin[] = [];
        for (let i = 0; i < activeStops.length; i++) {
          const st = activeStops[i];
          if (st.markerId) continue;
          const dx = wrapDeltaX(st.x - cam.targetX);
          const dz = st.z - cam.targetZ;
          const dLon = dx / PLANET_RADIUS_YARDS;
          const dLat = dz / PLANET_RADIUS_YARDS;
          if (globeBlend > 0.5 && (Math.abs(dLon) > Math.PI * 0.5 || Math.abs(dLat) > Math.PI * 0.5)) continue;
          const surfaceY = chunkTree.getSurfaceHeightAt(lod, st.x, st.z, flatWater, curSeaLevel) * ELEVATION_SCALE;
          const my = surfaceY + pinScale * 1.55;
          projectWorldToRendered(cam.targetX + dx, my, cam.targetZ + dz, cam.targetX, cam.targetZ, globeBlend, projVec);
          projVec.project(camera);
          if (projVec.z > 1) continue;
          const sx = Math.round((projVec.x * 0.5 + 0.5) * w);
          const sy = Math.round((-projVec.y * 0.5 + 0.5) * h);
          if (sx < 0 || sx > w || sy < 0 || sy > h) continue;
          const info = getRouteStopBadgeInfo(i, activeStops.length);
          nextPins.push({
            index: i,
            badge: info.badge,
            label: st.label,
            color: info.color,
            screenX: sx,
            screenY: sy,
          });
        }
        setRouteStopPins((prev) => {
          if (prev.length !== nextPins.length) return nextPins;
          for (let i = 0; i < prev.length; i++) {
            const a = prev[i];
            const b = nextPins[i];
            if (
              a.index !== b.index ||
              a.badge !== b.badge ||
              a.label !== b.label ||
              a.screenX !== b.screenX ||
              a.screenY !== b.screenY
            ) {
              return nextPins;
            }
          }
          return prev;
        });
      } else {
        setRouteStopPins((prev) => (prev.length === 0 ? prev : []));
      }

      // Project 10 visible power-of-10 grid squares horizontally at camera target for accurate scale bar
      const yawRad = (cam.yawDeg * Math.PI) / 180;
      const rightX = Math.cos(yawRad);
      const rightZ = -Math.sin(yawRad);
      const targetY = chunkTree.getHeightAt(lod, cam.targetX, cam.targetZ) * ELEVATION_SCALE;
      const probeYards = Math.max(1, cam.distance * 0.1);
      projVec.set(cam.targetX, targetY, cam.targetZ).project(camera);
      const sx1 = (projVec.x * 0.5 + 0.5) * w;
      projVec
        .set(cam.targetX + rightX * probeYards, targetY, cam.targetZ + rightZ * probeYards)
        .project(camera);
      const sxProbe = (projVec.x * 0.5 + 0.5) * w;
      const pxScale = probeYards / Math.max(1, Math.abs(sxProbe - sx1));
      const gridSpacing = Math.pow(10, Math.floor(Math.log10(pxScale * 10)));
      const totalYards = gridSpacing * 10;
      projVec
        .set(cam.targetX + rightX * totalYards, targetY, cam.targetZ + rightZ * totalYards)
        .project(camera);
      const sx2 = (projVec.x * 0.5 + 0.5) * w;
      const widthPx = Math.max(24, Math.min(360, Math.round(Math.abs(sx2 - sx1))));
      setScaleBar((prev) =>
        prev.widthPx === widthPx && prev.cellSpacing === gridSpacing
          ? prev
          : { widthPx, cellSpacing: gridSpacing, totalYards }
      );
    };
    updateProjectedOverlaysRef.current = updateProjectedOverlays;

    const _camFwd = new THREE.Vector3();
    const _baseUp = new THREE.Vector3(0, 1, 0);
    let currentRollRad = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const cam = camStateRef.current;

      // WASD / Arrow smooth pan
      const moveSpeed = cam.distance * (0.015 + 0.02 * gridUniforms.uGlobeBlend.value);
      const yawRad = (cam.yawDeg * Math.PI) / 180;
      const forwardX = -Math.sin(yawRad);
      const forwardZ = -Math.cos(yawRad);
      const rightX = Math.cos(yawRad);
      const rightZ = -Math.sin(yawRad);

      if (keysDown.has('w') || keysDown.has('arrowup')) {
        flyAnimRef.current = null;
        cam.targetX += forwardX * moveSpeed;
        cam.targetZ += forwardZ * moveSpeed;
      }
      if (keysDown.has('s') || keysDown.has('arrowdown')) {
        flyAnimRef.current = null;
        cam.targetX -= forwardX * moveSpeed;
        cam.targetZ -= forwardZ * moveSpeed;
      }
      if (keysDown.has('a') || keysDown.has('arrowleft')) {
        flyAnimRef.current = null;
        cam.targetX -= rightX * moveSpeed;
        cam.targetZ -= rightZ * moveSpeed;
      }
      if (keysDown.has('d') || keysDown.has('arrowright')) {
        flyAnimRef.current = null;
        cam.targetX += rightX * moveSpeed;
        cam.targetZ += rightZ * moveSpeed;
      }

      if (flyAnimRef.current) {
        const anim = flyAnimRef.current;
        const rawT = Math.min(1, (performance.now() - anim.startTime) / anim.durationMs);
        const ease = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);
        cam.targetX = anim.startX + anim.deltaX * ease;
        cam.targetZ = anim.startZ + anim.deltaZ * ease;
        cam.distance = anim.startDist * Math.pow(anim.endDist / anim.startDist, ease);
        if (rawT >= 1) {
          flyAnimRef.current = null;
        }
      }
      cam.targetX = ((cam.targetX % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
      cam.targetZ = Math.max(0, Math.min(WORLD_SPAN_Z, cam.targetZ));

      if (propsRef.current.cameraTargetRef) {
        propsRef.current.cameraTargetRef.current = { x: cam.targetX, z: cam.targetZ, distance: cam.distance };
      }

      const lod = computeLodFromDistance(cam.distance);
      gridUniforms.uCamTarget.value.set(cam.targetX, cam.targetZ);
      gridUniforms.uSubGridBlend.value = computeSubGridBlend(cam.distance, lod);
      const globeT = Math.max(0, Math.min(1, (cam.distance - 20000) / (1800000 - 20000)));
      const globeBlend = globeT * globeT * (3 - 2 * globeT);
      gridUniforms.uGlobeBlend.value = globeBlend;
      gridUniforms.uSunDir.value.copy(sunDirRef.current);

      const showPoleAxis = globeBlend > 0.95 && cam.distance >= 2200000;
      poleLine.visible = showPoleAxis;
      northPoleBadge.sprite.visible = showPoleAxis;
      southPoleBadge.sprite.visible = showPoleAxis;
      if (showPoleAxis) {
        const r = PLANET_RADIUS_YARDS;
        const latN = Math.max(-Math.PI, Math.min(Math.PI, (0 - cam.targetZ) / r));
        const latS = Math.max(-Math.PI, Math.min(Math.PI, (WORLD_SPAN_Z - cam.targetZ) / r));
        const dirNy = 0.65 * Math.cos(latN);
        const dirNz = Math.sin(latN);
        const lenN = Math.hypot(dirNy, dirNz) || 1;
        const dirSy = 0.65 * Math.cos(latS);
        const dirSz = Math.sin(latS);
        const lenS = Math.hypot(dirSy, dirSz) || 1;

        const ext = r * 0.25;
        const tipNx = cam.targetX;
        const tipNy = dirNy * r - r + (dirNy / lenN) * ext;
        const tipNz = cam.targetZ + dirNz * r + (dirNz / lenN) * ext;
        const tipSx = cam.targetX;
        const tipSy = dirSy * r - r + (dirSy / lenS) * ext;
        const tipSz = cam.targetZ + dirSz * r + (dirSz / lenS) * ext;

        polePositions[0] = tipNx;
        polePositions[1] = tipNy;
        polePositions[2] = tipNz;
        polePositions[3] = tipSx;
        polePositions[4] = tipSy;
        polePositions[5] = tipSz;
        (poleGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

        const labelExt = r * 0.34;
        northPoleBadge.sprite.position.set(
          cam.targetX,
          dirNy * r - r + (dirNy / lenN) * labelExt,
          cam.targetZ + dirNz * r + (dirNz / lenN) * labelExt
        );
        southPoleBadge.sprite.position.set(
          cam.targetX,
          dirSy * r - r + (dirSy / lenS) * labelExt,
          cam.targetZ + dirSz * r + (dirSz / lenS) * labelExt
        );
        const badgeSize = r * 0.2;
        northPoleBadge.sprite.scale.set(badgeSize, badgeSize, 1);
        southPoleBadge.sprite.scale.set(badgeSize, badgeSize, 1);
      }
      const targetY = chunkTree.getHeightAt(lod, cam.targetX, cam.targetZ) * ELEVATION_SCALE;
      const lookAtY = targetY - PLANET_RADIUS_YARDS * globeBlend;
      const orbitDist = cam.distance + PLANET_RADIUS_YARDS * globeBlend;
      const effectivePitchDeg = cam.pitchDeg + (88 - cam.pitchDeg) * globeBlend;
      const pitchRad = (effectivePitchDeg * Math.PI) / 180;
      const horiz = orbitDist * Math.cos(pitchRad);
      const camX = cam.targetX + horiz * Math.sin(yawRad);
      const camZ = cam.targetZ + horiz * Math.cos(yawRad);
      const groundAtCam = chunkTree.getHeightAt(lod, camX, camZ) * ELEVATION_SCALE;
      const camY = Math.max(groundAtCam + 1.5, lookAtY + orbitDist * Math.sin(pitchRad));

      let targetRollRad = 0;
      if (propsRef.current.viewAlignment === 'sun' && globeBlend > 0.5) {
        targetRollRad = -(propsRef.current.solarDeclinationDeg * Math.PI) / 180;
      }
      currentRollRad += (targetRollRad - currentRollRad) * 0.18;

      camera.position.set(camX, camY, camZ);
      if (Math.abs(currentRollRad) > 0.0005) {
        _camFwd.set(cam.targetX - camX, lookAtY - camY, cam.targetZ - camZ).normalize();
        camera.up.copy(_baseUp).applyAxisAngle(_camFwd, currentRollRad);
      } else {
        camera.up.copy(_baseUp);
      }
      camera.lookAt(cam.targetX, lookAtY, cam.targetZ);

      const desiredNear = Math.max(1, cam.distance * 0.02);
      const desiredFar = Math.max(20000, cam.distance * 8 + PLANET_RADIUS_YARDS * 4);
      if (
        Math.abs(camera.near - desiredNear) > desiredNear * 0.15 ||
        Math.abs(camera.far - desiredFar) > desiredFar * 0.15
      ) {
        camera.near = desiredNear;
        camera.far = desiredFar;
        camera.updateProjectionMatrix();
      }

      // Rebuild chunks if LOD or center chunk shifted
      const span = chunkTree.getChunkWorldSpan(lod);
      if (globeBlend < 0.3 && lod > 0) {
        const ringRad = lod >= 5 ? 3 : 2;
        const maxVisDist = span * ringRad;
        horizonFog.near = maxVisDist * 0.65;
        horizonFog.far = maxVisDist * 1.05;
      } else {
        horizonFog.near = 1e9;
        horizonFog.far = 1e9;
      }
      const cx = Math.floor(cam.targetX / span);
      const cz = Math.floor(cam.targetZ / span);
      const centerKey = `${lod}:${cx}:${cz}`;
      if (centerKey !== lastChunkCenterKey) {
        lastChunkCenterKey = centerKey;
        if (lod === 0 && chunkMeshMap.size === WORLD_L0_CHUNKS_X * WORLD_L0_CHUNKS_Z) {
          // All L0 globe chunks are already loaded; reposition wrapped X in-place without stalling
          for (const mesh of chunkMeshMap.values()) {
            const wrappedCx = mesh.userData.wrappedCx as number;
            const relCenter = wrapDeltaX((wrappedCx + 0.5) * span - cam.targetX);
            mesh.position.x = cam.targetX + relCenter - 0.5 * span;
          }
        } else {
          rebuildTerrain();
        }
        if (lod !== lastVectorLod || lod > 2 || Math.abs(cam.distance - lastVectorBuildDist) > lastVectorBuildDist * 0.12) {
          rebuildVectors();
        } else {
          updateVectorWrapPositions();
        }
      } else if (Math.abs(cam.distance - lastVectorBuildDist) > lastVectorBuildDist * 0.12) {
        rebuildVectors();
      } else {
        updateVectorWrapPositions();
      }

      flushPendingTerrainUploads();
      renderer.render(scene, camera);

      // Update projected marker labels smoothly (every frame during marker drag, else every 2 frames)
      labelTick++;
      if ((dragMode === 'marker' || labelTick % 2 === 0) && container) {
        updateProjectedOverlays();
      }
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      labelPointerDownRef.current = null;
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      wheelTarget.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      chunkMeshMap.clear();
      staleMeshes.length = 0;
      pendingUploads.length = 0;
      if (ownsWorker) {
        workerClient.dispose();
      } else {
        workerClient.setHandlers({});
      }
      clearGroup(terrainGroup, terrainMat);
      clearGroup(vectorGroup, pinMat);
      clearGroup(propGroup);
      clearWeatherGroup();
      sharedMaterials.forEach((m) => m.dispose());
      ringGeo.dispose();
      ringMat.dispose();
      poleGeo.dispose();
      poleMat.dispose();
      northPoleBadge.tex.dispose();
      northPoleBadge.mat.dispose();
      southPoleBadge.tex.dispose();
      southPoleBadge.mat.dispose();
      renderer.dispose();
      if (dom.parentNode === container) {
        container.removeChild(dom);
      }
    };
  }, [chunkTree, vectorTree]);

  // Rebuild terrain chunk meshes ONLY when terrain data or terrain visual mode changes
  useEffect(() => {
    rebuildTerrainRef.current();
  }, [
    terrainRevision,
    renderMode,
    flatWaterSurface,
    solarDeclBucket,
    baseTempC,
    seaLevel,
    weatherRevision,
    weatherLayers.renderAshInWorld,
  ]);

  // Rebuild atmospheric / storm / wind / volcanic overlays when weather layers or world state change
  useEffect(() => {
    rebuildWeatherRef.current();
  }, [
    weatherRevision,
    weatherLayers,
    flatWaterSurface,
    solarDeclBucket,
    seaLevel,
    activeLod,
  ]);

  // Rebuild vector overlays (markers, paths, polygons, routes) when vector/marker state or terrain changes
  useEffect(() => {
    rebuildVectorsRef.current();
    updateProjectedOverlaysRef.current();
  }, [
    revision,
    terrainRevision,
    renderMode,
    flatWaterSurface,
    solarDeclBucket,
    seaLevel,
    showFaultLines,
    draftPoints,
    polygonPoints,
    toolMode,
    roadSubMode,
    routeStops,
    mergeRouteNetwork,
    tempPin,
    selectedMarkerId,
    selectedRouteId,
  ]);

  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        cursor: draggingMarkerId
          ? 'grabbing'
          : toolMode === 'road' && roadSubMode === 'pins'
            ? 'crosshair'
            : undefined,
      }}
    >
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Projected Markers: draggable (when unlocked) & clickable icon + faint click-through name above/right */}
      {labels.map((lbl) => {
        const isSelected = selectedMarkerId === lbl.id;
        const isDraggingThis = draggingMarkerId === lbl.id;
        let routeBadgeText: string | null = null;
        let routeBadgeColor = '#0284c7';
        if (toolMode === 'road' && routeStops.length > 0) {
          const matchedIndices: number[] = [];
          for (let i = 0; i < routeStops.length; i++) {
            if (routeStops[i].markerId === lbl.id) matchedIndices.push(i);
          }
          if (matchedIndices.length > 0) {
            const firstInfo = getRouteStopBadgeInfo(matchedIndices[0], routeStops.length);
            routeBadgeColor = firstInfo.color;
            routeBadgeText = matchedIndices
              .map((idx) => getRouteStopBadgeInfo(idx, routeStops.length).badge)
              .join('·');
          }
        }
        return (
          <React.Fragment key={lbl.id}>
            <div
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                labelPointerDownRef.current?.(e.nativeEvent, lbl.id);
              }}
              title={
                lbl.locked
                  ? `${lbl.name} (Locked • click to select)`
                  : `${lbl.name} (Drag to move • click to select)`
              }
              style={{
                position: 'absolute',
                left: `${lbl.screenX}px`,
                top: `${lbl.screenY}px`,
                transform: 'translate(-50%, -50%)',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                userSelect: 'none',
                touchAction: 'none',
                cursor: isDraggingThis ? 'grabbing' : lbl.locked ? 'pointer' : 'grab',
                background: isSelected ? 'rgba(3, 105, 161, 0.92)' : 'rgba(15, 23, 42, 0.78)',
                border: `1.5px solid ${isSelected ? '#38bdf8' : routeBadgeText ? '#fbbf24' : lbl.color}`,
                boxShadow: isSelected
                  ? '0 0 0 2px rgba(56, 189, 248, 0.45)'
                  : routeBadgeText
                    ? '0 0 0 2px rgba(251, 191, 36, 0.4)'
                    : 'none',
                borderRadius: '9999px',
                fontSize: '12px',
                lineHeight: 1,
              }}
            >
              {lbl.icon}
              {routeBadgeText && (
                <span
                  style={{
                    position: 'absolute',
                    left: '-6px',
                    top: '-6px',
                    fontSize: '9px',
                    fontWeight: 800,
                    lineHeight: 1,
                    background: routeBadgeColor,
                    color: '#f8fafc',
                    borderRadius: '9999px',
                    padding: '2px 4px',
                    border: '1px solid #f8fafc',
                    pointerEvents: 'none',
                  }}
                >
                  {routeBadgeText}
                </span>
              )}
              {lbl.locked && (
                <span
                  style={{
                    position: 'absolute',
                    right: '-5px',
                    bottom: '-4px',
                    fontSize: '9px',
                    lineHeight: 1,
                    background: '#0f172a',
                    borderRadius: '9999px',
                    padding: '1px',
                    border: '1px solid rgba(245, 158, 11, 0.7)',
                    pointerEvents: 'none',
                  }}
                >
                  🔒
                </span>
              )}
            </div>
            <div
              style={{
                position: 'absolute',
                left: `${lbl.screenX + 14}px`,
                top: `${lbl.screenY - 12}px`,
                transform: 'translate(0, -50%)',
                pointerEvents: 'none',
                background: 'rgba(15, 23, 42, 0.28)',
                borderRadius: '3px',
                padding: '1px 5px',
                fontSize: '11px',
                fontWeight: 600,
                color: isSelected ? 'rgba(224, 242, 254, 0.92)' : 'rgba(248, 250, 252, 0.68)',
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
                whiteSpace: 'nowrap',
              }}
            >
              {lbl.name}
            </div>
          </React.Fragment>
        );
      })}

      {/* Projected Custom Route Stop Terrain Pins */}
      {routeStopPins.map((pin) => (
        <div
          key={`route-pin-${pin.index}`}
          style={{
            position: 'absolute',
            left: `${pin.screenX}px`,
            top: `${pin.screenY}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(15, 23, 42, 0.9)',
            border: `1.5px solid ${pin.color}`,
            borderRadius: '9999px',
            padding: '2px 7px 2px 4px',
            fontSize: '10px',
            fontWeight: 700,
            color: '#f8fafc',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.45)',
          }}
        >
          <span
            style={{
              background: pin.color,
              color: '#f8fafc',
              borderRadius: '9999px',
              padding: '1px 4px',
              fontSize: '9px',
              fontWeight: 800,
            }}
          >
            {pin.badge}
          </span>
          <span>{pin.label}</span>
        </div>
      ))}

      {/* Temporary Marker Pin Badge */}
      {tempPinScreen && (
        <div
          style={{
            position: 'absolute',
            left: `${tempPinScreen.x}px`,
            top: `${tempPinScreen.y}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            background: 'rgba(14, 116, 144, 0.92)',
            border: '1px dashed #22d3ee',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#ecfeff',
            whiteSpace: 'nowrap',
          }}
        >
          📌 New Pin
        </div>
      )}

      {/* Quick Marker Jump List */}
      {vectorTree.getMarkerCount() > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '44px',
            left: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            maxWidth: '380px',
            pointerEvents: 'auto',
          }}
        >
          {vectorTree.getAllMarkers().map((m) => (
            <button
              key={m.id}
              onClick={() => {
                camStateRef.current.targetX = ((m.x % WORLD_SPAN_X) + WORLD_SPAN_X) % WORLD_SPAN_X;
                camStateRef.current.targetZ = Math.max(0, Math.min(WORLD_SPAN_Z, m.z));
                if (propsRef.current.toolMode === 'road') {
                  propsRef.current.onSelectMarker?.(m.id);
                }
              }}
              title={`Pan to ${m.name}`}
              style={{
                padding: '3px 7px',
                borderRadius: '4px',
                border: '1px solid #334155',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#cbd5e1',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              📍 {m.name}
            </button>
          ))}
        </div>
      )}

      {/* Cursor Telemetry HUD */}
      {cursorWorld && (
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '5px 10px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#94a3b8',
            pointerEvents: 'none',
          }}
        >
          X: <strong style={{ color: '#f8fafc' }}>{cursorWorld.x}</strong> | Z:{' '}
          <strong style={{ color: '#f8fafc' }}>{cursorWorld.z}</strong> | Elev:{' '}
          <strong style={{ color: cursorWorld.h <= seaLevel ? '#38bdf8' : '#4ade80' }}>
            {cursorWorld.h} yd
          </strong>
        </div>
      )}

      {/* Fine-Grid Scale Bar (10 cells) */}
      <div
        style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid #334155',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '11px',
          fontFamily: 'monospace',
          color: '#cbd5e1',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#94a3b8' }}>1 grid = {scaleBar.cellSpacing} yd</span>
          <strong style={{ color: '#f8fafc' }}>
            {scaleBar.totalYards >= 1760
              ? `${(scaleBar.totalYards / 1760).toFixed(2)} mi (${scaleBar.totalYards.toLocaleString()} yd)`
              : `${scaleBar.totalYards.toLocaleString()} yd`}
          </strong>
        </div>
        <div
          style={{
            position: 'relative',
            width: `${scaleBar.widthPx}px`,
            height: '8px',
            borderBottom: '2px solid #38bdf8',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          }}
        >
          {Array.from({ length: 11 }, (_, i) => (
            <div
              key={i}
              style={{
                width: i === 0 || i === 10 ? '2px' : '1px',
                height: i === 0 || i === 5 || i === 10 ? '8px' : '5px',
                background: i === 0 || i === 10 ? '#38bdf8' : '#94a3b8',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
