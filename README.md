# OpenClaw Orchestrator

Source code for OpenClaw Orchestrator.

## Structure
- `src/` – TypeScript source
- `.openclaw/` – runtime data (logs, artifacts, workflows, dist, config, metrics) – **NOT in repo**

## Build
```bash
npm install
npx tsc
```

## Run
```bash
node .openclaw/dist/index.js <workflow-id> [inputs...]
node .openclaw/dist/dashboard.js   # dashboard on http://localhost:3001
```

## Safe deploy (separate runtime)
```bash
npm run build
npm run deploy:safe
```

Defaults:
- Source: `.openclaw/dist`
- Target: `~/.openclaw-orchestrator-runtime/dist`

Custom target:
```bash
node scripts/deploy-safe.mjs --target /absolute/path/to/orchestrator-runtime/dist
```

Hard safety rule:
- The deploy script refuses any target path containing `/node_modules/openclaw/dist`.

## Environment
- `OPENCLAW_DATA_DIR` – path to runtime data directory (default: `./.openclaw`)
- Other OpenClaw env vars as needed.

## Notes
Runtime data is excluded from git. Keep `.openclaw/` in your workspace root or set `OPENCLAW_DATA_DIR` to an absolute path.
