import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { QWorldChunkTree } from '../core/QWorldChunkTree';
import { QWorldTerrainMesh, TerrainRenderMode } from '../core/QWorldTerrainMesh';
import { QWorldVectorTree, WorldPoint2D } from '../core/QWorldVectorTree';
import { EditorToolMode, CameraPresetMode, MARKER_PRESETS } from '../core/QWorldEditorTypes';

interface ProjectedLabel {
  id: string;
  name: string;
  icon: string;
  color: string;
  screenX: number;
  screenY: number;
}

interface QWorld3DViewportProps {
  chunkTree: QWorldChunkTree;
  vectorTree: QWorldVectorTree;
  revision: number;
  toolMode: EditorToolMode;
  renderMode: TerrainRenderMode;
  cameraPreset: CameraPresetMode;
  brushRadiusCells: number;
  draftPoints: WorldPoint2D[];
  activeLod: number;
  onActiveLodChange: (lod: number) => void;
  onBrushStroke: (worldX: number, worldZ: number, lod: number) => void;
  onBrushEnd?: (lod: number) => void;
  onMapClick: (worldX: number, worldZ: number, lod: number) => void;
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

export const QWorld3DViewport: React.FC<QWorld3DViewportProps> = ({
  chunkTree,
  vectorTree,
  revision,
  toolMode,
  renderMode,
  cameraPreset,
  brushRadiusCells,
  draftPoints,
  activeLod,
  onActiveLodChange,
  onBrushStroke,
  onBrushEnd,
  onMapClick,
  onFinishPath,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; z: number; h: number } | null>(null);
  const [scaleBar, setScaleBar] = useState<{
    widthPx: number;
    cellSpacing: number;
    totalYards: number;
  }>({ widthPx: 120, cellSpacing: 64, totalYards: 640 });

  const camStateRef = useRef({
    targetX: 797161,
    targetZ: 797161,
    distance: 950000,
    pitchDeg: 48,
    yawDeg: 0,
  });

  const propsRef = useRef({
    toolMode,
    renderMode,
    brushRadiusCells,
    draftPoints,
    activeLod,
    onActiveLodChange,
    onBrushStroke,
    onBrushEnd,
    onMapClick,
    onFinishPath,
  });
  propsRef.current = {
    toolMode,
    renderMode,
    brushRadiusCells,
    draftPoints,
    activeLod,
    onActiveLodChange,
    onBrushStroke,
    onBrushEnd,
    onMapClick,
    onFinishPath,
  };

  const rebuildSceneRef = useRef<() => void>(() => {});

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
    scene.fog = new THREE.FogExp2('#071324', 0.0000008);

    const camera = new THREE.PerspectiveCamera(
      52,
      container.clientWidth / Math.max(1, container.clientHeight),
      1,
      6000000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfffbeb, 1.1);
    dir.position.set(4000, 8000, 3000);
    scene.add(dir);

    const terrainGroup = new THREE.Group();
    const vectorGroup = new THREE.Group();
    const propGroup = new THREE.Group();
    scene.add(terrainGroup, vectorGroup, propGroup);

    const EARTH_RADIUS_YARDS = 3959 * 1760; // 6,967,840 yd (Earth radius)
    const gridUniforms = {
      uGridSpacing: { value: chunkTree.getSampleSpacing(propsRef.current.activeLod) },
      uSubGridBlend: { value: 0.0 },
      uShowGrid: { value: propsRef.current.toolMode === 'elevate' ? 1.0 : 0.0 },
      uCamTarget: { value: new THREE.Vector2(camStateRef.current.targetX, camStateRef.current.targetZ) },
      uGlobeRadius: { value: EARTH_RADIUS_YARDS },
      uGlobeBlend: { value: 0.0 },
    };

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    terrainMat.customProgramCacheKey = () => 'terrain-grid-lambert-v3';
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGridSpacing = gridUniforms.uGridSpacing;
      shader.uniforms.uSubGridBlend = gridUniforms.uSubGridBlend;
      shader.uniforms.uShowGrid = gridUniforms.uShowGrid;
      shader.uniforms.uCamTarget = gridUniforms.uCamTarget;
      shader.uniforms.uGlobeRadius = gridUniforms.uGlobeRadius;
      shader.uniforms.uGlobeBlend = gridUniforms.uGlobeBlend;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vGridWorldPos;
uniform vec2 uCamTarget;
uniform float uGlobeRadius;
uniform float uGlobeBlend;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec3 flatWorldPos = (modelMatrix * vec4( transformed, 1.0 )).xyz;
if (uGlobeBlend > 0.001 && uGlobeRadius > 0.0) {
  vec2 gd = flatWorldPos.xz - uCamTarget;
  float drop = dot(gd, gd) / (2.0 * uGlobeRadius);
  transformed.y -= drop * uGlobeBlend;
}`
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vGridWorldPos = flatWorldPos;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vGridWorldPos;
uniform float uGridSpacing;
uniform float uSubGridBlend;
uniform float uShowGrid;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if (uShowGrid > 0.5 && uGridSpacing > 0.0) {
  vec2 coord = vGridWorldPos.xz / uGridSpacing;
  vec2 fw = max(fwidth(coord), vec2(0.0001));
  vec2 grid = abs(fract(coord - 0.5) - 0.5) / fw;
  float line = min(grid.x, grid.y);
  float gridAlpha = 1.0 - min(line, 1.0);
  float fade = 1.0 - smoothstep(0.35, 0.85, max(fw.x, fw.y));
  float strength = gridAlpha * fade * 0.38;

  if (uSubGridBlend > 0.01) {
    vec2 subCoord = coord * 3.0;
    vec2 subFw = max(fwidth(subCoord), vec2(0.0001));
    vec2 subGrid = abs(fract(subCoord - 0.5) - 0.5) / subFw;
    float subLine = min(subGrid.x, subGrid.y);
    float subAlpha = 1.0 - min(subLine, 1.0);
    float subFade = 1.0 - smoothstep(0.35, 0.85, max(subFw.x, subFw.y));
    strength = max(strength, subAlpha * subFade * 0.38 * uSubGridBlend);
  }

  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.07, 0.12), strength);
}`
        );
    };

    // Brush preview ring
    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    const brushRing = new THREE.Mesh(ringGeo, ringMat);
    brushRing.visible = false;
    scene.add(brushRing);

    const meshBuilder = new QWorldTerrainMesh(chunkTree);
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const clearGroup = (g: THREE.Group) => {
      while (g.children.length > 0) {
        const child = g.children[0] as THREE.Mesh | THREE.Line;
        g.remove(child);
        if (child.geometry) child.geometry.dispose();
      }
    };

    const rebuildVisibleScene = () => {
      const cam = camStateRef.current;
      const lod = computeLodFromDistance(cam.distance);
      if (lod !== propsRef.current.activeLod) {
        propsRef.current.onActiveLodChange(lod);
      }

      gridUniforms.uGridSpacing.value = chunkTree.getSampleSpacing(lod);
      gridUniforms.uShowGrid.value = propsRef.current.toolMode === 'elevate' ? 1.0 : 0.0;

      const span = chunkTree.getChunkWorldSpan(lod);
      const centerCx = Math.floor(cam.targetX / span);
      const centerCz = Math.floor(cam.targetZ / span);

      clearGroup(terrainGroup);
      const ringRadius = lod >= 7 ? 2 : 1;
      for (let cz = centerCz - ringRadius; cz <= centerCz + ringRadius; cz++) {
        for (let cx = centerCx - ringRadius; cx <= centerCx + ringRadius; cx++) {
          if (lod > 0) {
            chunkTree.refineChunkOnZoom(lod, cx, cz);
          }
          const geo = meshBuilder.buildChunkGeometry(lod, cx, cz, propsRef.current.renderMode);
          const mesh = new THREE.Mesh(geo, terrainMat);
          terrainGroup.add(mesh);
        }
      }

      // Vector overlays (rivers, roads, draft, markers)
      clearGroup(vectorGroup);
      const visibleBounds = {
        minX: (centerCx - ringRadius) * span,
        maxX: (centerCx + ringRadius + 1) * span,
        minZ: (centerCz - ringRadius) * span,
        maxZ: (centerCz + ringRadius + 1) * span,
      };
      const { markers, polylines } = vectorTree.queryVisible(visibleBounds, lod);
      const flows = vectorTree.recalculateRiverFlows(15);

      for (const poly of polylines) {
        if (poly.points.length < 2) continue;
        const pts = poly.points.map(
          (p) => new THREE.Vector3(p.x, chunkTree.getHeightAt(lod, p.x, p.z) * 0.05 + 0.6, p.z)
        );
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const color = poly.type === 'river' ? 0x38bdf8 : 0xd97706;
        const mat = new THREE.LineBasicMaterial({
          color,
          linewidth: poly.type === 'river' ? Math.min(4, 1 + (flows.get(poly.id) ?? 1) * 0.3) : 2,
        });
        vectorGroup.add(new THREE.Line(geo, mat));
      }

      if (propsRef.current.draftPoints.length >= 2) {
        const pts = propsRef.current.draftPoints.map(
          (p) => new THREE.Vector3(p.x, chunkTree.getHeightAt(lod, p.x, p.z) * 0.05 + 1.0, p.z)
        );
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const color = propsRef.current.toolMode === 'river' ? 0x7dd3fc : 0xfbbf24;
        vectorGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
      }

      // Marker 3D pins
      const pinScale = Math.max(4, cam.distance * 0.012);
      for (const m of markers) {
        const preset = MARKER_PRESETS.find((p) => p.category === m.category);
        const pinGeo = new THREE.ConeGeometry(pinScale * 0.45, pinScale * 1.4, 8);
        pinGeo.rotateX(Math.PI);
        const pinMat = new THREE.MeshBasicMaterial({ color: preset?.color ?? '#f59e0b' });
        const pin = new THREE.Mesh(pinGeo, pinMat);
        const y = chunkTree.getHeightAt(lod, m.x, m.z) * 0.05 + pinScale * 0.8;
        pin.position.set(m.x, y, m.z);
        vectorGroup.add(pin);
      }

      // People-level (L7..L9) instanced trees & rocks
      clearGroup(propGroup);
      if (lod >= 7) {
        const transforms = meshBuilder.collectVisiblePropTransforms(lod, visibleBounds, 2500);
        const trees = transforms.filter((t) => t.biomeId === 2 || t.biomeId === 6);
        const rocks = transforms.filter((t) => t.biomeId === 3);

        if (trees.length > 0) {
          const treeGeo = new THREE.ConeGeometry(1.6, 5.5, 6);
          treeGeo.translate(0, 2.75, 0);
          const treeMat = new THREE.MeshLambertMaterial({ color: 0x166534 });
          const inst = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
          const dummy = new THREE.Object3D();
          trees.forEach((t, i) => {
            dummy.position.set(t.x, t.y, t.z);
            dummy.scale.setScalar(t.scale);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
          });
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

    rebuildSceneRef.current = rebuildVisibleScene;
    rebuildVisibleScene();

    const getHitPoint = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      const hits = raycaster.intersectObjects(terrainGroup.children, false);
      if (hits.length > 0) return hits[0].point;

      const planeHit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(fallbackPlane, planeHit);
    };

    let isDragging = false;
    let dragMode: 'pan' | 'orbit' | 'brush' | null = null;
    let lastClientX = 0;
    let lastClientY = 0;
    let lastChunkCenterKey = '';

    const onPointerDown = (e: PointerEvent) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      if (e.button === 2 || (e.button === 0 && e.altKey)) {
        if (propsRef.current.toolMode === 'river' || propsRef.current.toolMode === 'road') {
          if (e.button === 2 && propsRef.current.draftPoints.length >= 2) {
            propsRef.current.onFinishPath();
            return;
          }
        }
        isDragging = true;
        dragMode = 'orbit';
        return;
      }

      if (e.button === 1 || (e.button === 0 && propsRef.current.toolMode === 'select')) {
        isDragging = true;
        dragMode = 'pan';
        return;
      }

      if (e.button === 0) {
        const hit = getHitPoint(e.clientX, e.clientY);
        if (!hit) return;
        const lod = computeLodFromDistance(camStateRef.current.distance);

        if (propsRef.current.toolMode === 'elevate' || propsRef.current.toolMode === 'biome') {
          isDragging = true;
          dragMode = 'brush';
          propsRef.current.onBrushStroke(hit.x, hit.z, lod);
        } else if (
          propsRef.current.toolMode === 'marker' ||
          propsRef.current.toolMode === 'river' ||
          propsRef.current.toolMode === 'road'
        ) {
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
        camStateRef.current.pitchDeg = Math.max(10, Math.min(89, camStateRef.current.pitchDeg + dy * 0.35));
        return;
      }

      if (isDragging && dragMode === 'pan') {
        const cam = camStateRef.current;
        const panScale = cam.distance * 0.0014;
        const yawRad = (cam.yawDeg * Math.PI) / 180;
        const cos = Math.cos(yawRad);
        const sin = Math.sin(yawRad);
        cam.targetX -= (dx * cos + dy * sin) * panScale;
        cam.targetZ -= (-dx * sin + dy * cos) * panScale;
        return;
      }

      const hit = getHitPoint(e.clientX, e.clientY);
      if (hit) {
        const lod = computeLodFromDistance(camStateRef.current.distance);
        const h = chunkTree.getHeightAt(lod, hit.x, hit.z);
        setCursorWorld({ x: Math.round(hit.x), z: Math.round(hit.z), h });

        if (propsRef.current.toolMode === 'elevate' || propsRef.current.toolMode === 'biome') {
          const radius = propsRef.current.brushRadiusCells * chunkTree.getSampleSpacing(lod);
          brushRing.visible = true;
          brushRing.position.set(hit.x, hit.y + 1.2, hit.z);
          brushRing.scale.setScalar(radius);

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

    const onPointerUp = () => {
      const wasBrush = isDragging && dragMode === 'brush';
      isDragging = false;
      dragMode = null;
      if (wasBrush) {
        const lod = computeLodFromDistance(camStateRef.current.distance);
        propsRef.current.onBrushEnd?.(lod);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.14 : 0.88;
      camStateRef.current.distance = Math.max(25, Math.min(2500000, camStateRef.current.distance * factor));
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
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
          camStateRef.current.distance = LOD_TARGET_DISTANCES[digit];
          propsRef.current.onActiveLodChange(digit);
          rebuildSceneRef.current();
          return;
        }
      }
      if (e.key === 'Enter' && propsRef.current.draftPoints.length >= 2) {
        propsRef.current.onFinishPath();
      }
      keysDown.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.key.toLowerCase());

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
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

    let animId = 0;
    let labelTick = 0;
    const projVec = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const cam = camStateRef.current;

      // WASD / Arrow smooth pan
      const moveSpeed = cam.distance * 0.015;
      const yawRad = (cam.yawDeg * Math.PI) / 180;
      const forwardX = -Math.sin(yawRad);
      const forwardZ = -Math.cos(yawRad);
      const rightX = Math.cos(yawRad);
      const rightZ = -Math.sin(yawRad);

      if (keysDown.has('w') || keysDown.has('arrowup')) {
        cam.targetX += forwardX * moveSpeed;
        cam.targetZ += forwardZ * moveSpeed;
      }
      if (keysDown.has('s') || keysDown.has('arrowdown')) {
        cam.targetX -= forwardX * moveSpeed;
        cam.targetZ -= forwardZ * moveSpeed;
      }
      if (keysDown.has('a') || keysDown.has('arrowleft')) {
        cam.targetX -= rightX * moveSpeed;
        cam.targetZ -= rightZ * moveSpeed;
      }
      if (keysDown.has('d') || keysDown.has('arrowright')) {
        cam.targetX += rightX * moveSpeed;
        cam.targetZ += rightZ * moveSpeed;
      }

      const lod = computeLodFromDistance(cam.distance);
      gridUniforms.uCamTarget.value.set(cam.targetX, cam.targetZ);
      gridUniforms.uSubGridBlend.value = computeSubGridBlend(cam.distance, lod);
      const globeT = Math.max(0, Math.min(1, (cam.distance - 20000) / (450000 - 20000)));
      gridUniforms.uGlobeBlend.value = globeT * globeT * (3 - 2 * globeT);
      const targetY = chunkTree.getHeightAt(lod, cam.targetX, cam.targetZ) * 0.05;
      const pitchRad = (cam.pitchDeg * Math.PI) / 180;
      const horiz = cam.distance * Math.cos(pitchRad);

      camera.position.set(
        cam.targetX + horiz * Math.sin(yawRad),
        targetY + cam.distance * Math.sin(pitchRad),
        cam.targetZ + horiz * Math.cos(yawRad)
      );
      camera.lookAt(cam.targetX, targetY, cam.targetZ);

      // Rebuild chunks if LOD or center chunk shifted
      const span = chunkTree.getChunkWorldSpan(lod);
      const cx = Math.floor(cam.targetX / span);
      const cz = Math.floor(cam.targetZ / span);
      const centerKey = `${lod}:${cx}:${cz}`;
      if (centerKey !== lastChunkCenterKey) {
        lastChunkCenterKey = centerKey;
        rebuildVisibleScene();
      }

      renderer.render(scene, camera);

      // Update projected marker labels every 4 frames
      labelTick++;
      if (labelTick % 4 === 0 && container) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const visMarkers = vectorTree.queryVisible(
          {
            minX: cam.targetX - cam.distance * 2,
            maxX: cam.targetX + cam.distance * 2,
            minZ: cam.targetZ - cam.distance * 2,
            maxZ: cam.targetZ + cam.distance * 2,
          },
          lod
        ).markers;

        const nextLabels: ProjectedLabel[] = [];
        for (const m of visMarkers.slice(0, 40)) {
          const my = chunkTree.getHeightAt(lod, m.x, m.z) * 0.05 + Math.max(8, cam.distance * 0.025);
          projVec.set(m.x, my, m.z).project(camera);
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
            screenX: sx,
            screenY: sy,
          });
        }
        setLabels(nextLabels);

        // Project 10 fine-grid cells horizontally at camera target for accurate scale bar
        const cellSpacing = chunkTree.getSampleSpacing(lod);
        const totalYards = cellSpacing * 10;
        projVec.set(cam.targetX, targetY, cam.targetZ).project(camera);
        const sx1 = (projVec.x * 0.5 + 0.5) * w;
        projVec
          .set(cam.targetX + rightX * totalYards, targetY, cam.targetZ + rightZ * totalYards)
          .project(camera);
        const sx2 = (projVec.x * 0.5 + 0.5) * w;
        const widthPx = Math.max(24, Math.min(360, Math.round(Math.abs(sx2 - sx1))));
        setScaleBar((prev) =>
          prev.widthPx === widthPx && prev.cellSpacing === cellSpacing
            ? prev
            : { widthPx, cellSpacing, totalYards }
        );
      }
    };

    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      clearGroup(terrainGroup);
      clearGroup(vectorGroup);
      clearGroup(propGroup);
      terrainMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      renderer.dispose();
      if (dom.parentNode === container) {
        container.removeChild(dom);
      }
    };
  }, [chunkTree, vectorTree]);

  // Trigger scene rebuild when edits, render mode, or draft points change
  useEffect(() => {
    rebuildSceneRef.current();
  }, [revision, renderMode, draftPoints, toolMode]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Projected Marker Labels */}
      {labels.map((lbl) => (
        <div
          key={lbl.id}
          style={{
            position: 'absolute',
            left: `${lbl.screenX}px`,
            top: `${lbl.screenY}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            background: 'rgba(15, 23, 42, 0.85)',
            border: `1px solid ${lbl.color}`,
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#f8fafc',
            whiteSpace: 'nowrap',
          }}
        >
          {lbl.icon} {lbl.name}
        </div>
      ))}

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
          <strong style={{ color: cursorWorld.h <= 0 ? '#38bdf8' : '#4ade80' }}>
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
          <span style={{ color: '#94a3b8' }}>1 cell = {scaleBar.cellSpacing} yd</span>
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
