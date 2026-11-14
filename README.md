# Adventure2 — 3D World Map Editor & Virtual Tabletop

**Adventure2** is a browser-based 3D world-building cartography editor and virtual tabletop (VTT) foundation designed to scale seamlessly from **entire-planet overview (`L0`)** down to **1-yard people-scale terrain (`L9`)**.

---

## What the Project Does Today

### 1. Planet-Scale Sparse LOD Terrain Engine (`L0`–`L9`)
- **10-Tier Power-of-3 QuadTree** ([`QWorldChunkTree`](file:///f:/Dev/adventure2/src/core/QWorldChunkTree.ts)): Partitions a full wrap-around planet (~12.75M × 6.38M yards) into sparse `81 × 81` raster chunks (`heights`, `biomes`, `waterFlags`, `rainfall`). Unedited regions consume zero memory; zooming in lazily allocates child chunks with smooth interpolation and parent LOD rollups.
- **Off-Thread Meshing** ([`src/workers/`](file:///f:/Dev/adventure2/src/workers/)): Web Workers generate chunk geometry, refine terrain detail, and compute LOD rollups off the main UI thread.
- **Procedural World Generation** ([`QWorldStarterGenerator`](file:///f:/Dev/adventure2/src/core/QWorldStarterGenerator.ts)): Generates seeded continents, fault lines, sea levels, and climate-driven biomes.

### 2. Interactive 3D Sculpting, Biomes & Ocean Flood-Fill
- **3D Viewport & Camera Modes** ([`QWorld3DViewport`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)): Three.js renderer with zoom-to-cursor, `3D`, `Top-Down`, and `People` camera presets, plus visualization modes (`Normal`, `Temperature`, `Rainfall`, `Biomes`, `Heatmap`) and foliage prop placement.
- **Terrain & Biome Brushes** ([`QWorldBrushEngine`](file:///f:/Dev/adventure2/src/core/QWorldBrushEngine.ts)): SimCity-style elevation brushes (`Raise`, `Lower`, `Flatten`, `Smooth`), 8 biome presets (`Grass`, `Forest`, `Rock`, `Sand`, `Swamp`, `Jungle`, `Snow`, `Farmland`), and polygon region actions.
- **Incremental Ocean Flood-Fill** ([`QWorldWaterFlood`](file:///f:/Dev/adventure2/src/core/QWorldWaterFlood.ts)): Bounded BFS flood-fill floods coastal depressions connected to ocean cells while keeping enclosed inland basins dry.

### 3. Cartography Markers, Route Planning & Road Networks
- **Vector Features** ([`QWorldVectorTree`](file:///f:/Dev/adventure2/src/core/QWorldVectorTree.ts)): Spatial indexing for rivers, roads, and 10 marker categories (`City`, `Town`, `Village`, `Cross-Roads`, `Inn`, `Fort`, `Mine`, `Farm`, `Dungeon`, `Building`) with LOD-aware visibility (`minLod..maxLod`).
- **Terrain-Aware Route Planner** ([`QWorldRoutePlanner`](file:///f:/Dev/adventure2/src/core/QWorldRoutePlanner.ts), [`QWorldRouteNetwork`](file:///f:/Dev/adventure2/src/core/QWorldRouteNetwork.ts)): Multi-stop route planning across biomes and elevation with travel-time estimation (`8 hours/day`), route construction states (`path`, `road`, `building`, `built_road`), and merged route network rendering.

### 4. Celestial, Sky & Omen Simulation
- **Astronomical Sky Engine** ([`QWorldCelestial`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts), [`QWorldConstellations`](file:///f:/Dev/adventure2/src/core/QWorldConstellations.ts), [`QWorldSkyPreview`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)): Projects a fixed star catalog, constellations, galaxy cloud, nebula, primary moon, trojan clusters, black moon, and comet for any `(lat, lon)` on the planet—computing daily sky arcs, tabletop light levels, upcoming solar eclipses, and celestial omens.

### 5. Local-First Persistence
- **IndexedDB & JSON I/O** ([`QWorldStorage`](file:///f:/Dev/adventure2/src/core/QWorldStorage.ts), [`QWorldIndexedDb`](file:///f:/Dev/adventure2/src/core/QWorldIndexedDb.ts)): Browser IndexedDB auto-save and single-file JSON world export/import.

---

## Tech Stack & Repository Layout

- **Frontend**: React 18, TypeScript, Vite, Three.js (`0.187`), Web Workers
- **Testing**: Vitest (`9` test files, `41` tests in [`src/tests/`](file:///f:/Dev/adventure2/src/tests/))
- **Architecture & Governance**:
  - [`docs/project-plan.md`](file:///f:/Dev/adventure2/docs/project-plan.md) — Architecture & v1–v4 roadmap
  - [`.agents/AGENTS.md`](file:///f:/Dev/adventure2/.agents/AGENTS.md) — AI & developer workspace invariants, TDD, and `commit`/`review` protocols
  - [`docs/writing-safe-code.md`](file:///f:/Dev/adventure2/docs/writing-safe-code.md) — Concise safe-coding checklist
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md) — Task ledger & commit history
  - [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md) — Known issues & debugging playbook

---

## Getting Started

```bash
pnpm install
pnpm run dev        # Start Vite dev server
pnpm test           # Run Vitest unit & performance suite
pnpm run typecheck  # TypeScript check (tsc --noEmit)
pnpm run build      # Production build
```
