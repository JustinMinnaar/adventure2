# TASK-20261114-1900: Hide Horizon Dividing Line When Toggling UI Off (`O` Key)

- **Date / Time Reference**: 2026-11-14 19:00:59
- **Status**: `Committed (10c851e — 2026-11-14 21:33)`
- **Summary**: Updated `QWorldSkyPreview` so that hiding the UI in Pure View via the `O` key also suppresses the grey horizon dividing line across both Ground View and Surround View, leaving only the dark filled ground silhouette against the night sky, and allowed pressing `O` from the standard multi-panel layout as well as fullscreen mode.
- **Key Changes & Decisions**:
  1. **Hide Horizon Line in Pure View ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx#L4345-L4353), [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx#L4762-L4768))**:
     - Gated the ridge outline stroke (`ctx.strokeStyle = isUnderground ? 'rgba(56, 189, 248, 0.45)' : 'rgba(100, 116, 139, 0.45)'`) in `renderGroundCharacterView` behind `if (showHudLabels)` while preserving the filled ground polygon (`groundColor`).
     - Moved the horizontal `horizonY` grey dividing stroke (`ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)'`) in `renderSurroundPanoramaView` inside `if (showHudLabels)`.
  2. **Pure View `O` Shortcut Availability ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx#L707-L713))**:
     - Enabled pressing `O` even when `focusedView === 'none'` outside browser fullscreen to immediately focus the sky preview canvas with `hideFocusHud = true` (Pure View), removing the unused `isBrowserFullscreen` dependency from the keyboard listener `useEffect`.
- **Affected Files**:
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1900-hide-horizon-line-in-pure-view.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1900-hide-horizon-line-in-pure-view.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 13 passed (13)`, `Tests 79 passed (79)`.
- **Commit Message Line**:
  - `- [2026-11-14 19:00] Hide Horizon Dividing Line in Pure View (Key O): Omitted horizon stroke in Ground/Surround Pure View while retaining dark ground fill and enabled Key O focus toggle outside browser fullscreen`
