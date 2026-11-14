# TASK-20261114-1945: Remove Artificial Moon Glow & Lock Coloured Nebula On

- **Date / Time Reference**: 2026-11-14 19:45:57
- **Status**: `Pending Commit`
- **Summary**: Removed the artificial radial halo glow rendered around `Vaelis` and `Morvath` in `drawPhaseMoonDisc`, and removed Key `'5'` along with all UI toggles for hiding The Chrysalis Nebula so it remains permanently visible like the host galaxy cloud.
- **Key Changes & Decisions**:
  1. **Remove Artificial Moon Radial Glow ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Removed `glowColor`, `glowAlpha`, and the `radialGradient` halo rendering block from `drawPhaseMoonDisc`.
     - Removed `glowColor` and `glowAlpha` from all four `drawPhaseMoonDisc` calls (`Morvath` and `Vaelis` across both `renderGroundCharacterView` and `renderSurroundPanoramaView`).
  2. **Permanently Enable The Chrysalis Nebula (Remove Key `'5'`) ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx))**:
     - Replaced toggleable `showNebula` and `nebulaAlpha` state with permanent constants (`showNebula = true`, `nebulaAlpha = 1`), simplified the overlay fade `useEffect`, and removed Key `'5'` from `onKeyDown`.
     - Removed the nebula icon-button from `renderOverlayIconButtons`, removed the `Show Coloured Nebula` checkbox from the Orbits drawer, and updated Help Guide entries for the fixed nebula and `6`–`9` / `0` overlay hotkeys.
- **Affected Files**:
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1945-remove-moon-glow-and-nebula-toggle.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1945-remove-moon-glow-and-nebula-toggle.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 13 passed (13)`, `Tests 80 passed (80)`.
- **Commit Message Line**:
  - `- [2026-11-14 19:45] Remove Artificial Moon Glow & Lock Coloured Nebula On: Stripped radial moon halo from drawPhaseMoonDisc and made The Chrysalis Nebula permanently visible by removing Key 5 and UI toggles`
