# Writing Safe Code in Adventure2

Refer to this concise guide **whenever writing or modifying code** in **Adventure2**. For historical bugs, root-cause analyses, and known pitfalls, see [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md).

---

## 1. Fail-Fast & Zero-Fallback
- **Never Fake Success**: If an input, chunk lookup, storage write, or worker call fails or is missing, throw a descriptive `Error` immediately. Never return synthetic placeholder data to mask a failure.
- **Zero Empty / Silent `catch` Blocks (ABSOLUTE)**: Never write `catch {}`, `catch (e) {}`, or `.catch(() => {})`. Always log and surface/rethrow errors.
- **No Rogue Fallbacks**: Never cascade attributes (`val || defaultVal`) to paper over broken contracts or missing required fields.

## 2. Spatial, Chunk & Geometry Safety
- **Explicit Coordinate Spaces**: Keep world coordinates, chunk/LOD coordinates, and screen/viewport coordinates clearly named and typed. Never mix units (`yards`, `miles`, `feet`, `pixels`) without explicit conversion helpers.
- **Typed Array Bounds**: When indexing `64 × 64` chunk buffers (`heights: Int16Array(4096)`, `biomes: Uint8Array(4096)`, `waterFlags: Uint8Array(4096)`), validate or clamp `(lx, ly)` bounds explicitly before indexing.
- **Scale-Invariant Brushes & Math**: Brush radii, stroke falloffs, and hit-testing MUST remain consistent across zoom tiers (L0–L5) and world coordinate magnitudes.

## 3. Three.js, WebGL & Web Worker Lifecycle
- **Dispose GPU Resources**: Dispose `BufferGeometry`, `Material`, `DataTexture`, and `WebGLRenderer` on chunk eviction or component unmount.
- **Zero Hot-Path Allocations**: Avoid allocating new `THREE.Vector3`, `THREE.Matrix4`, `THREE.Color`, or large temporary arrays inside `requestAnimationFrame` or `pointermove` handlers; reuse pre-allocated scratch objects.
- **Typed Worker Protocol**: Keep worker requests/responses strictly aligned with [`QWorldTerrainWorkerProtocol.ts`](file:///f:/Dev/adventure2/src/workers/QWorldTerrainWorkerProtocol.ts) and handle `onerror` / rejected promises explicitly.

## 4. Performance & 60 FPS Discipline
- **Dirty-Chunk Updates Only**: Brush strokes, ocean flood-fills (`QWorldWaterFlood`), and mesh rebuilds MUST only touch dirty chunks and visible frustum chunks—never iterate the entire world.
- **Bounded Graph / BFS Traversals**: Keep flood-fill and route-finding traversals bounded and benchmarked with explicit Vitest timing assertions (`expect(durationMs).toBeLessThan(...)`).
- **Measure Before & After**: Use `QWorldPerfMonitor` and Vitest benchmarks when optimizing rendering or spatial pipelines.

## 5. React State, Hooks & UI Layout
- **Hooks Unconditionally at Top**: Never place an early `return` above `useState`, `useRef`, `useMemo`, `useCallback`, or `useEffect`.
- **Keep Components Focused**: Max 150–250 lines per component file, max 25–40 lines per function, and no inline sub-components.
- **Safe CSS & Layout**:
  - Add `min-w-0` on flex/grid containers, `whitespace-nowrap` on captions/buttons, and `flex-wrap` on toolbars.
  - Never change dimensions (`width`, `margin`, `padding`) on `:hover`; animate `opacity` or `color` instead.
  - Keep HUD/error overlays outside transformed canvas layers.
- **Zero Tech Jargon in UI**: Never expose internal class names, WebGL/IndexedDB details, or developer notes in user-facing labels or tooltips.

## 6. Persistence & IndexedDB
- **Validate Imports**: Validate JSON world imports before mutating in-memory `QWorldChunkTree` or `QWorldVectorTree` state; fail fast with a clear message on malformed data.
- **Explicit Storage Errors**: Propagate IndexedDB transaction/open errors in `QWorldIndexedDb` and `QWorldStorage` rather than swallowing them.

## 7. Windows CLI & Verification
- **Verify Every Change**: Run `pnpm run typecheck` and `pnpm test` after edits.
- **Windows Shell Rule**: Never pass multi-line inline code strings to PowerShell. Use `git grep -n` or scope `rg` to `src/` with a timeout so searches never hang.
