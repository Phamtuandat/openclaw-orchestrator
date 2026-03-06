# Context — Decky (AnkiClone)

## Repo / Path
- Local: `/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky`
- GitHub: `https://github.com/Phamtuandat/AnkiClone`

## Source of truth
- `PROJECT_STATE.md` (inside Decky repo) must be checked first.

## Current status snapshot
- iPhone build/install flow verified (device deploy works).
- Implemented: logging + feature flags + offline queue scaffold + study telemetry baseline.
- Recent commits include:
  - `095dcc8` (logging/flags/telemetry/offline scaffold)
  - `3e5cef3` (PROJECT_STATE for continuity)

## Working rules
- Reuse existing mechanisms, avoid duplicate services.
- For status questions: check `PROJECT_STATE.md`, then `git log -n`, then `git status -sb`.
