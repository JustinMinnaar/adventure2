# TASK-20261114-1922: Fullscreen Icon-Buttons, Fixed Galaxy Cloud & Pure View Moon Rim Suppression

- **Date / Time Reference**: 2026-11-14 19:22:05
- **Status**: `Pending Commit`
- **Summary**: Fixed The Astral River galaxy cloud as permanently visible (removing Key `4`, its header button, and its Orbits drawer checkbox), unified all sky projection (`1`/`2`/`3`), overlay (`5`–`9`, `0`), and tool/action (`Y`, `O`, Orbits, Perf, Calendar, `?`, Browser Fullscreen) controls into compact icon-buttons with instructional hotkey tooltips across both the header and fullscreen views, and suppressed moon disc outline borders (`rimColor`) in Pure View (`O`).
- **Key Changes & Decisions**:
  1. **Always-Visible Galaxy Cloud (Remove Key `4` Toggle)** ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)):
     - Replaced `showGalaxyCloud` / `galaxyAlpha` toggleable state with permanent constants (`showGalaxyCloud = true`, `galaxyAlpha = 1`), simplified the overlay fade loop, removed Key `4` handling from `onKeyDown`, removed the `Show Galaxy Cloud` checkbox from the Orbits drawer, and updated Help Guide sections accordingly.
  2. **Shared Icon-Button Toolbars & Instructional Hotkey Tooltips** ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)):
     - Extracted shared toolbar helpers (`renderViewProjectionButtons`, `renderOverlayIconButtons`, `renderToolIconButtons`, `renderArcsSvgIcon`, `renderFullscreenSvgIcon`, `renderPerfHudPanel`) with data-driven descriptors and rich instructional `title` tooltips listing hotkeys (`1`, `2`, `3`, `5`, `6`, `7`, `8`, `9`, `0`, `Y`, `O`, `P`, `I`, `Esc`, `?`).
     - Replaced text-labeled header toggles and the partial fullscreen toolbar (`ground` | `surround`, `lines`, `art`) with complete icon-button controls, added instructional tooltips to `N`, `E`, `S`, `W`, zenith tilt `↑`, and exit focus `✕`, exposed overlay/tool controls in Zenith Dome and Orbital Plane focus modes, and rendered the Perf HUD banner floating in focus mode when enabled.
  3. **Hide Moon Circle Borders in Pure View (`O` Key)** ([`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)):
     - Updated all four `drawPhaseMoonDisc` call sites (`Morvath` and `Vaelis` across `renderGroundCharacterView` and `renderSurroundPanoramaView`) to pass `rimColor: undefined` when `showHudLabels` is `false`, preventing dark unlit portions of quarter/crescent moons from showing a circular outline border when hiding the UI.
- **Affected Files**:
  - [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)
  - [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
  - [`docs/tasks/2026-11-14-1922-fullscreen-icon-buttons-and-moon-rim.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1922-fullscreen-icon-buttons-and-moon-rim.md)
- **Validation & Verification**:
  - `pnpm run typecheck` (`tsc --noEmit`): exited with code `0`.
  - `pnpm test` (`vitest run`): `Test Files 13 passed (13)`, `Tests 79 passed (79)`.
- **Commit Message Line**:
  - `- [2026-11-14 19:22] Fullscreen Icon-Buttons, Fixed Galaxy Cloud & Pure View Moon Rim Suppression: Replaced sky view toggles with shared hotkey-tooltip icon-buttons across header and fullscreen views, locked galaxy mist on (removed Key 4), and hid lunar rim borders when UI is hidden via O`
