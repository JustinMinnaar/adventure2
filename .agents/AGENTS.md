# Workspace Rules & Core Architecture Directives for Adventure2

This file defines the mandatory core invariants for human developers and AI assistants working on **Adventure2** (3D World Map Editor & Virtual Tabletop).

---

## 1. Pre-Flight Domain Specification Routing Table

BEFORE writing or modifying code, AI assistants MUST inspect the relevant domain specification:

| Task / Domain Area | Primary Specification & Files | Core Focus |
|---|---|---|
| Project Plan & Architecture | [`docs/project-plan.md`](file:///f:/Dev/adventure2/docs/project-plan.md) | 6-tier scale hierarchy (L0–L5), Sparse LOD QuadTree, Vector QuadTree, Ocean BFS flood-fill, v1–v4 roadmap. |
| Writing Safe Code (Always When Coding) | [`docs/writing-safe-code.md`](file:///f:/Dev/adventure2/docs/writing-safe-code.md) | Concise safe-coding rules (fail-fast, Three.js/WebGL lifecycle, Web Workers, spatial math, React/UI, IndexedDB) to follow whenever writing or modifying code. |
| Known Issues & Debugging Playbook | [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md) | Master registry of discovered bugs, root causes, workarounds, and debugging lessons for future reference. |
| Completed Tasks & Commit Protocol | [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md), [`docs/tasks/`](file:///f:/Dev/adventure2/docs/tasks/) | End-of-conversation task logging, timestamp reference, and the `'commit'` verification & commit protocol. |
| Core Spatial, Terrain & Route Engine | [`src/core/`](file:///f:/Dev/adventure2/src/core/) | `QWorldChunkTree`, `QWorldBrushEngine`, `QWorldWaterFlood`, `QWorldVectorTree`, `QWorldTerrainMesh`, `QWorldRouteNetwork`, `QWorldRoutePlanner`. |
| Celestial & Sky Simulation | [`src/core/QWorldCelestial.ts`](file:///f:/Dev/adventure2/src/core/QWorldCelestial.ts), [`src/core/QWorldConstellations.ts`](file:///f:/Dev/adventure2/src/core/QWorldConstellations.ts) | Star catalog, solar/lunar/eclipse projection, constellation geometry, and sky preview math. |
| Terrain Web Workers | [`src/workers/`](file:///f:/Dev/adventure2/src/workers/) | `QWorldTerrainWorker`, `QWorldTerrainWorkerClient`, `QWorldTerrainWorkerProtocol` off-thread meshing & chunk processing. |
| 3D Viewport & Quick Build UI | [`src/components/`](file:///f:/Dev/adventure2/src/components/) | `QWorld3DViewport`, `QWorldToolbar`, `QWorldToolOptionsBar`, `QWorldRightPanel`, `QWorldSkyPreview`. |
| Persistence & IndexedDB | [`src/core/QWorldStorage.ts`](file:///f:/Dev/adventure2/src/core/QWorldStorage.ts), [`src/core/QWorldIndexedDb.ts`](file:///f:/Dev/adventure2/src/core/QWorldIndexedDb.ts) | Local-first IndexedDB auto-save and JSON export/import serialization. |
| Unit & Performance Tests | [`src/tests/`](file:///f:/Dev/adventure2/src/tests/) | Vitest unit, functional, and performance benchmark suites (`pnpm test`). |

---

## 2. Inviolable Core Invariants

### 1. Strict Zero-Fallback, Single-Action Determinism & Fail-Fast
- **Single-Action Mandate**: The AI assistant and all codebase components MUST NEVER invent, implement, or execute a fallback, alternative failover, speculative reroute, or synthetic recovery without explicit, direct instruction from the lead developer.
- **Fail Fast & Explicit**: Every requested operation MUST attempt only the single specified action against the single designated target. If input cannot be satisfied or an operation fails, fail immediately with a visible, descriptive error (`throw new Error(...)`). Never silently succeed or inject synthetic placeholder data.
- **Zero Empty `catch` Blocks (ABSOLUTE)**: No AI may EVER write an empty `catch` block (`catch {}` or `catch (e) {}`) or swallow exceptions (e.g. `.catch(() => {})`, returning `[]`, or faking success). Always log and surface/rethrow errors.
- **Zero Chained Data Fallbacks**: Never cascade attributes (`val || sampleVal || defaultVal`) to mask missing state or broken contracts.

### 2. Golden Invariant: Strict Test-First Development (TDD) & Performance Assertions
- **Zero Untested Logic**: Business logic, spatial calculations, chunk LOD inheritance, ocean flood-fill, route planning, celestial math, and serialization MUST be backed by unit/functional tests in [`src/tests/`](file:///f:/Dev/adventure2/src/tests/).
- **Red-Green-Refactor Cycle**:
  1. Write a failing Vitest test asserting the expected behavior or contract.
  2. Run `pnpm test` (`vitest run`) to confirm the failure.
  3. Implement the minimum required logic.
  4. Run `pnpm test` and `pnpm run typecheck` to confirm all tests pass and types are clean.
  5. Refactor while keeping all tests green.
- **Architectural Efficiency & Mandatory Performance Unit Tests**:
  - Always evaluate and select the most efficient algorithmic approach ($O(1)$, $O(\log N)$, spatial partitioning, dirty-chunk updates, or bounded BFS) before writing code. Avoid full-world iterations or unthrottled heavy allocations inside `pointermove`, `wheel`, or `requestAnimationFrame`.
  - Keep geometry, brush radii, and spatial math scale-invariant and decoupled from world coordinate magnitudes or viewport zoom levels.
  - Whenever implementing or altering algorithms, spatial math, meshing, or simulation pipelines, write explicit performance assertion tests (e.g. `expect(durationMs).toBeLessThan(...)`) to guarantee 60 FPS real-time execution.

### 3. Component Naming & TypeScript Standards (The `'Q'` Rule)
- **Prefix Standard**: Adventure2 modules, classes, React components, and hooks MUST use the **`QWorld`** (or **`Q`**) prefix (e.g. `QWorldChunkTree`, `QWorld3DViewport`, `QWorldPerfMonitor`, `useQWorld...`).
- **Naming Conventions**:
  - `PascalCase` for classes, interfaces, types, and React components.
  - `camelCase` for variables, functions, hooks, and JSON/worker message fields.
  - Dedicated file per exported component (no inline sub-components).

### 4. 4-Layer Architecture, File Size Limits & Clean UI
- **File Lengths**: Page/top-level orchestrators (`src/App.tsx`) and React component files max 150–250 lines. Extract core algorithms, state machines, and worker clients into `src/core/` or `src/workers/` or custom hooks.
- **Function Lengths**: Max 25–40 lines per function/method. Decompose complex branching or multi-step math into well-named single-purpose helpers.
- **React Hook Order**: Never place an early `return` above `useState`, `useRef`, `useMemo`, `useCallback`, or `useEffect`.
- **Zero Tech Jargon in UI**: Never insert developer notes, internal class names, or implementation jargon into user-facing panels, buttons, or tooltips. Keep UI clean, thematic, and focused on cartography and world-building actions.

### 5. Three.js, WebGL & Web Worker Resource Governance
- **Explicit Disposal**: Always dispose Three.js `BufferGeometry`, `Material`, `DataTexture`, and `WebGLRenderer` resources when chunks unload or components unmount to prevent GPU memory leaks.
- **Zero Per-Frame GC Churn**: Reuse `Vector3`, `Matrix4`, `Raycaster`, and typed array buffers inside animation/render loops rather than allocating new objects per frame.
- **Typed Worker Contracts**: All Web Worker messages MUST conform to [`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts) and surface worker errors explicitly rather than hanging or failing silently.

### 6. Windows CLI & Codebase Search Rules
- **Windows CLI Rule**: Never pass multi-line inline code strings to Windows PowerShell. Use temporary scratch files if scripting is needed.
- **Codebase Search Rule**: Unscoped `rg -n` across the repository root can hang on Windows (e.g. traversing `node_modules` or `dist`). Use `git grep -n` for tracked source searches, or scope `rg` to `src/` with a command timeout.

### 7. Continuous Issue Logging (`docs/issues.md`)
- **Pre-Flight Check**: Review [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md) before investigating bugs, Three.js/WebGL quirks, worker races, or performance regressions.
- **Document Resolved & Known Issues**: Whenever a non-trivial bug, edge case, or architectural pitfall is discovered or resolved, record it in [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md) with symptoms, root cause, solution/workaround, and verification.

### 8. End-of-Conversation Task Logging & `'commit'` Command Protocol
- **End-of-Conversation Task Output**:
  - At the end of every conversation in which code, configuration, or documentation tasks were completed, the AI assistant MUST:
    1. Create a detailed task report markdown file in [`docs/tasks/`](file:///f:/Dev/adventure2/docs/tasks/) named with the local date/time reference: `YYYY-MM-DD-HHmm-<task-slug>.md` (e.g. `2026-11-14-1307-ai-instructions-task-and-issue-tracking.md`).
       - The task file MUST contain:
         - **Header**: `# TASK-<YYYYMMDD-HHmm>: <Task Title>`
         - **Date / Time Reference**: Full local date/time (e.g. `2026-11-14 13:07:18`).
         - **Status**: Initially `Pending Commit` (transitions to `Committed` upon git commit).
         - **Summary**: Concise overview of the problem, request, or feature.
         - **Key Changes & Decisions**: Rationale, technical design, bug fixes, or architecture adjustments.
         - **Affected Files**: Clickable markdown links to all created, modified, or deleted files.
         - **Validation & Verification**: Results of `pnpm run typecheck` and `pnpm test`.
         - **Commit Message Line**: A single concise line formatted for the commit message (e.g. `- [YYYY-MM-DD HH:mm] <Task Title>: <summary>`).
    2. Register the task in the master ledger [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md):
       - Append/prepend an entry to the `Task Registry` table:
         - `Date / Time Reference`: e.g. `2026-11-14 13:07:18`
         - `Task Slug / Identifier`: e.g. `ai-instructions-task-and-issue-tracking`
         - `Summary`: Brief summary of work completed
         - `Task Details`: Markdown link to [`docs/tasks/YYYY-MM-DD-HHmm-<task-slug>.md`](file:///f:/Dev/adventure2/docs/tasks/)
         - `Status`: `Pending Commit`
         - `Commit / Notes`: `Pending user 'commit' command`
- **Parallel & Batch Multi-Task Support**:
  - Multiple tasks completed across sequential or parallel threads each generate their own isolated task file in `docs/tasks/` and register under `Pending Commit` in [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md).
- **The `'commit'` Command Protocol**:
  - When the user explicitly issues the command `commit`:
    1. **Identify Pending Tasks**: Inspect [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md) and identify all completed tasks with status `Pending Commit` since the last git commit.
    2. **Execute Full Verification & Tests**:
       - Run workspace typechecking: `pnpm run typecheck`.
       - Run the full unit & performance test suite: `pnpm test`.
       - Optionally run `pnpm run build` to verify production bundling.
       - **Fail-Fast Barrier**: If any check or test fails, STOP immediately. Do NOT stage, commit, or push. Report the failure details to the user and resolve them before proceeding.
    3. **Prepare Commit Message**:
       - Formulate a single-line summary header describing the batch of completed tasks.
       - Leave a blank line.
       - Append a single bullet line for each pending task referencing its date/time and description:
         `- [YYYY-MM-DD HH:mm] <Task Name>: <Concise summary of changes>`
    4. **Stage & Commit (and Push if Remote Configured)**:
       - Stage modified and created files (`git add .` or appropriate paths).
       - Commit with the prepared multi-task message (`git commit -m "..."`).
       - If a git remote is configured, push commits (`git push`).
    5. **Update Task Ledger Status to Committed**:
       - Update [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md) and each affected task file in [`docs/tasks/`](file:///f:/Dev/adventure2/docs/tasks/) from `Pending Commit` to `Committed` (recording the commit hash and timestamp).
       - Commit the updated ledger: `git commit -am "docs(tasks): update task ledger and records with commit <hash>"` (and push if remote configured).
    6. **Commit Completion Summary**:
       - Provide a concise consolidated commit report showing verification results, commit hash, commit message, and a summary table linking to the committed task files.

### 9. Code Review & `'review'` Command Protocol
- **Trigger**: When the user explicitly issues `review` (or `review all`):
  1. **Inspect Scope**: Review `git status` / `git diff` (or all of `src/` for `review all`).
  2. **Audit Against Core Invariants**:
     - Fail-fast error handling (zero empty `catch` blocks or silent `.catch(() => {})`).
     - Zero rogue fallbacks or synthetic data injections.
     - `QWorld` naming & TypeScript strictness.
     - 4-layer architecture & file/function size limits (components <= 250 lines, functions <= 40 lines, no inline sub-components).
     - Three.js resource disposal & 60 FPS hot-path discipline.
  3. **Verify**: Run `pnpm run typecheck` and `pnpm test`.
  4. **Report**: Provide a concise review summary with clickable file links, findings, and any refactored files.
