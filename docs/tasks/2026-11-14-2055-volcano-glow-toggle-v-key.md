# TASK-20261114-2055: Add Volcano Eruption Glow Toggle (`V` Key & Toolbar Button, Default Off)

- **Date / Time Reference**: `2026-11-14 20:55:40`
- **Status**: `Committed (10c851e — 2026-11-14 21:33)`

## Summary
Added a toggle (`showVolcanoGlow`, defaulting to `false`) controlled by the **`V`** key and a `🌋` toolbar icon-button so distant volcanic eruption horizon glow, ash veil haze, and the HUD `🌋 Horizon Glow` badge stay hidden unless explicitly enabled when simulating an active eruption.

## Key Changes & Decisions
1. **Default-Off Toggle State & Keyboard Shortcut (`V`)**:
   - Added `const [showVolcanoGlow, setShowVolcanoGlow] = useState<boolean>(false);` in [`QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx).
   - Added `v` / `V` (`KeyV`) handling in `onKeyDown` with an on-screen status toast (`🌋 Volcanic Eruption Glow: ON` / `OFF`).
2. **Gated Sky Canvas Rendering & HUD Badge**:
   - Gated `volcanicSample` evaluation on `showVolcanoGlow` inside both the main Sky Preview (`renderGroundCharacterView` / `renderSurroundPanoramaView`) and Zenith Dome (`renderZenithDome`) effects, including `showVolcanoGlow` in their dependency arrays.
   - Gated the top-left `🌋 Horizon Glow` / `🌋 Ash Veil` HUD status pill on `showVolcanoGlow`.
3. **Toolbar Icon-Button & Help Guide Update**:
   - Added `showVolcanoGlow` / `toggleVolcanoGlow` to `SkyToolbarState` and `SkyToolbarActions` and added the `🌋` icon-button (`Key: V`) to `renderOverlayIconButtons` (visible in both the main header and fullscreen overlay bar).
   - Documented `[V] Volcanic Eruption Glow` in the Sky Guide & Shortcuts Help modal.

## Affected Files
- [`src/components/QWorldSkyPreview.tsx`](file:///f:/Dev/adventure2/src/components/QWorldSkyPreview.tsx)

## Validation & Verification
- `pnpm run typecheck` (`tsc --noEmit`): passed with 0 errors.
- `pnpm test` (`vitest run`): 14/14 test files passed, 83/83 tests passed (`QWorldGlobeMath.test.ts` performance test passed on clean rerun at 26ms).

## Commit Message Line
- [2026-11-14 20:55] Volcano Eruption Glow Toggle (Key V): Added default-off volcanic horizon glow & ash veil toggle (`V` key and `🌋` toolbar icon-button) gating sky glow rendering and HUD badge
