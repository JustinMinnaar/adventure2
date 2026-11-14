# TASK-20261114-1307: AI Instructions, Safe-Coding Guide, Task Ledger & Issue Tracking Setup

- **Date / Time Reference**: 2026-11-14 13:07:18
- **Status**: `Pending Commit`

## Summary
Reviewed the AI instructions, coding-practice guides, task-logging/commit protocols, and issue-tracking catalogs in `F:\Dev\PaperOp\Document-Vault-Manager` and `F:\Dev\adventure1`, and created an equivalent, tailored governance setup for **Adventure2**.

## Key Changes & Decisions
1. **Workspace Rules & Protocols ([`.agents/AGENTS.md`](file:///f:/Dev/adventure2/.agents/AGENTS.md))**:
   - Added a Pre-Flight Domain Specification Routing Table mapped to Adventure2's `src/core/`, `src/workers/`, `src/components/`, `src/tests/`, and `docs/`.
   - Established core invariants: strict zero-fallback & fail-fast (zero empty `catch` blocks), strict TDD with Vitest + performance assertions, `QWorld` naming & TypeScript conventions, 4-layer file/function size limits, Three.js/WebGL & Web Worker resource governance, Windows CLI/search rules, continuous issue logging, end-of-conversation task logging, `'commit'` protocol, and `'review'` protocol.
2. **Concise Safe-Coding Guide ([`docs/writing-safe-code.md`](file:///f:/Dev/adventure2/docs/writing-safe-code.md))**:
   - Distilled practical coding-turn rules for fail-fast error handling, spatial/chunk coordinate safety, Three.js disposal & zero hot-path allocations, 60 FPS discipline, React hook/layout rules, IndexedDB validation, and Windows CLI verification.
3. **Task Ledger & Task Directory ([`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md), `docs/tasks/`)**:
   - Created the master `Task Registry` table to track `Pending Commit` tasks across conversations for the `'commit'` stage.
4. **Known Issues & Debugging Playbook ([`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md))**:
   - Created the central issue catalog and structured entry template for recording bugs, root causes, and fixes for future reference.

## Affected Files
- [`.agents/AGENTS.md`](file:///f:/Dev/adventure2/.agents/AGENTS.md)
- [`docs/writing-safe-code.md`](file:///f:/Dev/adventure2/docs/writing-safe-code.md)
- [`docs/tasks.md`](file:///f:/Dev/adventure2/docs/tasks.md)
- [`docs/tasks/2026-11-14-1307-ai-instructions-task-and-issue-tracking.md`](file:///f:/Dev/adventure2/docs/tasks/2026-11-14-1307-ai-instructions-task-and-issue-tracking.md)
- [`docs/issues.md`](file:///f:/Dev/adventure2/docs/issues.md)

## Validation & Verification
- Baseline `pnpm test`: 9 test files passed (41 tests).
- Baseline `pnpm run typecheck`: 4 pre-existing TypeScript errors in `src/core/QWorldCelestial.ts` (unrelated to this documentation setup).

## Commit Message Line
- `[2026-11-14 13:07] AI Instructions & Tracking Setup: Add .agents/AGENTS.md, safe-coding guide, task ledger for commit tracking, and issues playbook`
