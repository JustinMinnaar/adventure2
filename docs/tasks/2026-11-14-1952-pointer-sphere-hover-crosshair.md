# TASK-20261114-1952: Hover Aim Crosshair for Pointer Sphere Mode (`I` Key)

- **Date / Time Reference**: 2026-11-14 19:52:23
- **Status**: `Pending Commit`
- **Summary**: Added a compact aim crosshair on `pointerCanvasRef` when Pure View Pointer Sphere mode (`I` key, `pureMouseMode === 'sphere'`) is active and the mouse button is not held down, allowing users to aim accurately before holding down the mouse button to ignite the glowing sphere and starlight trail.
- **Key Changes & Decisions**:
  1. **Hover State & Idle-Safe Overlay Loop ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Extended `pointerStateRef` with `isHovering`, added `pureMouseModeRef` and `isPureViewRef`, and added `hoverPointer(x, y)` to schedule single-frame overlay repaints on hover without keeping a continuous idle `requestAnimationFrame` loop running once any trailing glow has faded.
     - Added an `else if (showHoverCrosshair)` branch inside `renderPointerLayer` drawing four crisp short crosshair ticks (`2.5px..7.5px`) and a `1×1` center pinpoint at `(x, y)` whenever Pure View + Pointer Sphere mode are active, the mouse button is up, and the cursor is inside the preview canvas.
     - Updated `onPointerMove` and added `onPointerLeave` on `previewCanvasRef` so the crosshair tracks pointer motion smoothly, appears immediately upon toggling `'I'` even while stationary, and clears on leave or mode exit.
  2. **Consistent `P` vs `I` Tooltip & Help Documentation ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Aligned the Pure View toolbar button tooltip, toast hint, and Sky Guide page 5 copy so `[P]` documents mouse pan and `[I]` documents the pointer sphere + aim crosshair.
- **Affected Files**:
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1952-pointer-sphere-hover-crosshair.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1952-pointer-sphere-hover-crosshair.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 13 passed (13)`, `Tests 80 passed (80)`.
- **Commit Message Line**:
  - `- [2026-11-14 19:52] Hover Aim Crosshair for Pointer Sphere Mode (Key I): Displayed a crisp hover crosshair on pointerCanvasRef before pressing mouse button and aligned Pure View P/I tooltip copy`
