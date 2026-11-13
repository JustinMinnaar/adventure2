# Adventure2 — World Map Editor & 3D VTT Project Plan

**Created**: 2026-11-13  
**Workspace**: `f:\Dev\adventure2`  
**Status**: Initial Architecture & Design Plan (Pre-Implementation)

---

## 1. Vision & Core Goals

**Adventure2** is a clean, 3D-capable virtual tabletop (VTT) world map and editor built from the ground up for **continent-to-street scale** cartography and game mastering.

In **Version 1**, the focus is strictly on the **interactive 3D world map and quick-build editor**:
- Smoothly zoom and pan/orbit from **continent overview** down to **people/building scale** (supporting both top-down and low-angle/first-person views at close range).
- Sculpt terrain elevation effortlessly with a **SimCity-style brush** (raise, lower, flatten, smooth) with heat-map / hypsometric visualization.
- **Ocean flood-fill**: Place an ocean alongside the continent; lowered land connected to the ocean floods automatically, while **enclosed basins surrounded by higher terrain stay dry**.
- Paint **biomes** (forest, grass, rock, sand, swamp, jungle, etc.) onto the terrain, rendering as blended colors/textures at macro zoom and **instanced 3D trees, rocks, and buildings** at people-level zoom.
- Draw **river** and **road** polyline networks (with river confluence merging, flow direction, and volume scaling).
- Place **location markers** (cities, towns, forts, dungeons, buildings) with zoom-tier visibility.
- Persist worlds locally in the browser (**IndexedDB** auto-save + **JSON Export/Import**), with a clean storage boundary for future cloud sync (Azure Qiiqa or Convex).

---

## 2. Scale Hierarchy & Zoom-Adaptive Rendering

Adventure2 adopts the 6-tier spatial scale standard (with `1 elevation unit = 1 yard`, range `-1000` to `+1000`):

| Tier | Cell / Grid Scale | World Focus | Visual Representation |
|---|---|---|---|
| **L0** | 180 Miles | Empire / Continent | Blended biome colors, hypsometric/heat-map elevation, ocean, major capitals & rivers |
| **L1** | 30 Miles | Kingdom / Province | Regional coastlines, mountain ranges, kingdoms, major roads & trade arteries |
| **L2** | 6 Miles | Regional / Wilderness | Towns, forts, mines, dungeons, river tributaries, local terrain contours |
| **L3** | 1 Mile | Local / Valley | Detailed coastlines, clearings, village approaches, bridges |
| **L4** | 50 Feet | Village / Settlement | **3D instanced trees, rocks, and building footprints**; street-level navigation |
| **L5** | 5 Feet | People / Tactical | Close-up people-scale 3D view (top-down or low-angle/first-person); building exteriors |

*(Interior dungeon/building maps will be handled as separate linked maps in a later phase.)*

---

## 3. Data Architecture (Continent-Scale Performance)

A monolithic `255`-grayscale image cannot span both a 2,000-mile continent and 50-foot city blocks (which would require ~44 billion pixels), and 8-bit height causes visible stair-stepping (`~7.8 yd` per step). Pure polygons are too slow and complex for freehand brush sculpting.

Adventure2 uses a **hybrid Sparse LOD QuadTree + Vector QuadTree** architecture so frame rate and memory depend only on **visible & edited areas**, never total world size:

### 3.1 Sparse LOD Terrain Chunks (`QWorldChunkTree`)
- The world is partitioned into a **Sparse LOD QuadTree** where each allocated node holds a **`64 × 64` raster chunk**:
  - `heights: Int16Array(4096)` — `1-yard` precision (`-1000..+1000`), zero stair-stepping (`8 KB` per chunk).
  - `biomes: Uint8Array(4096)` — up to `255` biome IDs (`0 = unpainted`, `1 = grass`, `2 = forest`, `3 = rock`, `4 = sand`, `5 = swamp`, `6 = jungle`, `7 = snow`, `8 = farmland`, etc.) (`4 KB` per chunk).
  - `waterFlags: Uint8Array(4096)` — ocean flood state & water depth/mask (`4 KB` per chunk).
- **Lazy Allocation & Inheritance**: Unpainted chunks do not exist in memory or storage. When zooming into L3–L5, only the **4–9 visible child chunks** are allocated, inheriting smoothly bilinear-interpolated heights and biomes from their parent chunk.
- **Visible-Only Meshing**: Only chunks inside the camera frustum at the active LOD level are uploaded to Three.js as displaced `BufferGeometry` / `DataTexture` meshes.

### 3.2 Vector Spatial QuadTree (`QWorldVectorTree`)
- **Rivers, Roads, and Markers** are stored as sparse vector polylines and points indexed by bounding box in a 2D QuadTree.
- Only features intersecting the visible viewport and matching the current LOD visibility range (`minLod..maxLod`) are rendered or hit-tested.

### 3.3 Ocean Flood-Fill & Enclosed Basins
To determine whether lowered land (`elevation <= seaLevel`) fills with ocean water without filling enclosed inland basins:
- **Why not straight-line A→B checks alone?** A straight line between an ocean cell `A` and a lowered cell `B` can miss a winding channel/fjord around a headland.
- **Solution — Incremental Ocean Flood-Fill (BFS)**:
  1. The ocean border / designated **Ocean Seed** cells start marked as `OCEAN_WATER`.
  2. Whenever an elevation brush stroke lowers or raises cells across `seaLevel`:
     - **Lowering below `seaLevel`**: Check 4/8-connected neighbors. If any neighbor is `OCEAN_WATER`, run a fast bounded BFS through adjacent `elevation <= seaLevel` cells to flood the newly connected basin. If all surrounding neighbors are above `seaLevel`, the depression **stays dry** (an inland crater/valley).
     - **Raising above `seaLevel`**: Mark raised cells dry; run a local connectivity check on adjacent `OCEAN_WATER` cells that may now be cut off from the ocean (optional drain/inland-sea toggle).
  3. Runs in `< 1 ms` on dirty chunks and handles arbitrary coastlines, bays, and barriers accurately.

---

## 4. Quick Build Toolbar & v1 Features

A single, uncluttered **Quick Build Toolbar** switches the active tool:

1. **Select / Pan (`Select`)**
   - Orbit, pan, zoom (mouse wheel / drag / keyboard).
   - Toggle between **3D Angled View**, **Top-Down 2D View**, and **People-Level View** (when zoomed to L4/L5).
   - Click markers, rivers, or roads to inspect/edit properties.
2. **Elevation Mode (`Elevate`)**
   - **SimCity-style brush**: `Raise`, `Lower`, `Flatten`, `Smooth`, plus `Ocean Seed` / `Sea Level` control.
   - Adjustable **Brush Radius** (screen-scale invariant) and **Strength**.
   - **Heat-Map View**: Clear hypsometric color ramp (deep ocean → shallows → coastal green → lowlands → highlands → alpine peaks) with optional elevation contour lines.
3. **Biome Mode (`Biome`)**
   - Paint biome IDs (`Forest`, `Grass`, `Rock`, `Sand`, `Swamp`, `Jungle`, `Snow`, `Farmland`, etc.) with adjustable brush radius.
   - Renders as blended ground colors/textures when zoomed out; spawns **instanced 3D trees, rocks, and props** when zoomed in to L4/L5.
4. **River Mode (`River`)**
   - Click to draw river polyline segments; auto-snap to existing rivers to form confluences.
   - Enforces downhill flow, displays flow direction, and scales river width by accumulated `sourceVolume`.
5. **Road Mode (`Road`)**
   - Click to draw road polylines; snap endpoints to markers and road intersections.
6. **Marker Mode (`Marker`)**
   - Click to place Cities, Towns, Forts, Mines, Farms, Dungeons, and Buildings.
   - Each marker has `minLod` / `maxLod` visibility so macro labels don't clutter street view and individual buildings don't clutter world view.

---

## 5. Persistence & Future Roadmap

### Version 1 Persistence (Local-First)
- **Browser IndexedDB (`QWorldStorage`)**: Auto-saves sparse chunks (compressed) + vector layers, avoiding `localStorage`'s 5–10 MB limit.
- **JSON Export / Import**: Single-file world backup and sharing.

### Reusable Modules from `adventure1`
Rather than importing factory simulation code, we will selectively port/adapt proven math and patterns from `f:\Dev\adventure1\src\Adventure1.Client\src\core`:
- `QBoardGridMath.ts` (scale hierarchy & coordinate projection)
- `QBoardRiverNetwork.ts` & `QBoardPathMath.ts` (river confluence & polyline math)
- `QBoardMarkerManager.ts` (marker presets & bit flags)

### Future Versions (Post-v1)
- **v2 — GM World & Time**: In-game calendar/clock, party token movement with travel-time estimates, GM Chronicle / story-nudge log, and Fog of War.
- **v3 — Macro Trade & NPC Activity**: Settlement supply/demand, caravan & riverboat simulation along drawn networks, and daily world-event summaries.
- **v4 — Live Multi-User VTT Sync**: Plug `QWorldStorage` into **Azure Qiiqa (`document-vault-manager`)** or **Convex** for live GM + Player sessions, plus separate linked interior maps for buildings/dungeons.

---

## 6. Next Steps (Implementation Phases)

1. **Scaffold `f:\Dev\adventure2`**: Vite + React + TypeScript + Three.js + Vitest (TDD from day 1).
2. **Core Chunk Engine (`QWorldChunkTree` + Unit & Performance Tests)**: Sparse `64×64` chunks, LOD inheritance, and `< 2 ms` brush + ocean BFS flood-fill benchmarks.
3. **3D Terrain Renderer (`QWorldTerrainView`)**: Frustum-culled chunk meshes, heat-map + biome shader, camera zoom/orbit/top-down controls, and people-level instanced trees/rocks/buildings.
4. **Quick Build Toolbar & Vector Modes**: Elevation brush, Biome brush, River polylines, Road polylines, Marker placement.
5. **Local DB & JSON I/O**: IndexedDB auto-save + Export/Import JSON.
