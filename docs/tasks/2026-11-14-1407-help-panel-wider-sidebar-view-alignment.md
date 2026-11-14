# TASK-20261114-1407: Help Mode Panel, 1.5x Wider Sidebar, View Alignment & Reset View

- **Date / Time Reference**: `2026-11-14 14:07:35`
- **Status**: `Committed (5d1580e — 2026-11-14 16:08)`

## Summary
Widened the right side-panel by 1.5x (480px default), added a dedicated `Help & Guide` (`❓`) mode as the last tool tab documenting sun position, day/night shadow, seasons, view alignment, and climate bands, and added `N/S Aligned`, `Sun-Aligned`, and `Reset View` buttons inside the `Select / Pan` mode panel.

## Key Changes & Decisions
- **1.5x Wider Side-Panel ([`App.tsx`](file:///f:/Dev/adventure2/src/App.tsx#L30-L43), [L589](file:///f:/Dev/adventure2/src/App.tsx#L589))**:
  - Updated default `rightPanelWidth` from `320px` to `480px` (and splitter range `300px–760px`) under `adventure2_right_panel_width_v2`.
- **Help Mode & Panel ([`QWorldEditorTypes.ts`](file:///f:/Dev/adventure2/src/core/QWorldEditorTypes.ts#L1), [`QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx#L67-L76), [L1665-L1735](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx#L1665-L1735))**:
  - Added `'help'` (`❓ Help & Guide`) as the 9th and final button in `TOOL_BUTTONS` (`repeat(9, 1fr)`).
  - Documented sun position & day/night terminator behavior across Equinoxes/Solstices, `N/S Aligned` vs `Sun-Aligned` framing, and latitude climate bands + `Base Temp`.
- **View Alignment & Reset View in Select Mode ([`QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx#L1748-L1810), [`QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L458-L469), [L2302-L2318](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx#L2302-L2318))**:
  - Added `🧭 N/S Aligned`, `☀️ Sun-Aligned`, and `🌍 Reset View (Full World)` buttons to the `select` mode panel.
  - Implemented smooth camera roll (`camera.up` rotation around look vector by `-declRad * sunRightSign`) for `Sun-Aligned` mode and full-world camera reset on `resetViewNonce`.

## Affected Files
- [`src/core/QWorldEditorTypes.ts`](file:///f:/Dev/adventure2/src/core/QWorldEditorTypes.ts)
- [`src/App.tsx`](file:///f:/Dev/adventure2/src/App.tsx)
- [`src/components/QWorldRightPanel.tsx`](file:///f:/Dev/adventure2/src/components/QWorldRightPanel.tsx)
- [`src/components/QWorld3DViewport.tsx`](file:///f:/Dev/adventure2/src/components/QWorld3DViewport.tsx)

## Validation & Verification
- `pnpm run typecheck`: Zero errors in modified files (2 unrelated errors in untracked `QWorldAtmosphere.ts` / `QWorldAtmosphere.test.ts` missing `./QWorldVolcanicFallout`).
- `pnpm test --exclude src/tests/QWorldAtmosphere.test.ts`: Passed (11 test files, 54 tests).

## Commit Message Line
- [2026-11-14 14:07] Help Panel, 1.5x Sidebar & View Alignment: Added Help & Guide mode, 480px default sidebar, and N/S Aligned, Sun-Aligned, and Reset View controls in Select mode
