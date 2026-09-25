# Agent rules for GoodObsidian

- Read STATE.json and TASKS.md before doing anything; LOG.md if state is unclear.
- Stack: TypeScript + esbuild against the Obsidian plugin API; canvas 2D for ink.
  Keep code simple and clean; no new dependencies without a note in PLAN.md.
- **The iPad is the target.** Every UI decision is judged by whether it works
  with a pencil in a hand resting on the glass, not with a mouse.
- Verify before marking any task complete: run `npm run build` (must emit
  `main.js` with no TS errors) and `npm test` where tests exist.
- Every solved bug/error gets a ledger entry in CLAUDE.md before its task is closed.
- Commit after every verified task; never end a session with uncommitted work.
- Territories: `src/core/` `src/ui/` `tests/` `research/` each have one owner;
  cross-territory contact goes through `contracts/` only. Only the orchestrator
  edits `contracts/`.
- Confirm with Joost before dangerous commands (deletes outside repo, network
  writes, credentials).
- Core behavior stays deterministic; transcription is an optional,
  explicitly-triggered layer and must never run on its own.
