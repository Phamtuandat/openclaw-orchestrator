# OpenClaw Orchestrator v2

TypeScript workflow engine để điều phối multi-agent scan/analysis theo stage + dependency.

## Hiện trạng kiến trúc (theo source hiện tại)

### Core modules
- `core/orchestrator.ts` — load workflow JSON, topo-sort theo `dependsOn`, chạy stage, retry/fallback, lưu artifact
- `core/agent_dispatcher.ts` — dispatcher adapter:
  - `MockAgentDispatcher` (mặc định)
  - `OpenClawAgentDispatcher` (khi `USE_REAL_AGENT=true`)
- `core/openclaw_client.ts` — WebSocket client gọi OpenClaw gateway qua `tools.invoke`
- `core/file_index_builder.ts` — index file từ project path
- `core/dependency_graph_builder.ts` — build dependency graph
- `core/workflow_tracer.ts` — trace vòng đời workflow/stage
- `core/logger.ts` — structured logging

### Workflow engine behavior
- Workflow được load từ `.openclaw/workflows/*.json`
- Validation:
  - workflow tồn tại
  - `dependsOn` không tham chiếu stage thiếu
  - cycle detection bằng topological sort
- Execution:
  - build file index + dependency graph khi có `inputs.project_path`
  - stage chạy theo execution plan
  - conflict wait theo `targets.file_patterns` (file intent locking)
  - retry tối đa 2 lần cho lỗi retryable
  - fallback model cho non-`orchestrator-main`
- Output:
  - artifacts: `.openclaw/artifacts/<traceId>/<stageId>.json`
  - logs: `.openclaw/logs/...`

### Agent dispatch modes
- **Mock mode (default):**
  - chạy local giả lập, không cần gateway
- **Real mode (`USE_REAL_AGENT=true`):**
  - spawn qua `sessions_spawn`
  - poll session completion qua `sessions_list`

## Cấu trúc thư mục

```text
.openclaw/
├── core/
├── workflows/
│   ├── crash_hunter.json
│   └── conflict_test.json
├── schemas/
├── artifacts/
├── logs/
├── dist/
├── index.ts
├── dashboard.ts
└── README*.md
```

## Quick start

```bash
cd .openclaw
npm install
npm run build
```

### Chạy workflow (mock)
```bash
node dist/index.js crash_hunter project_path="/absolute/path/to/project"
```

### Chạy workflow (real agents)
```bash
USE_REAL_AGENT=true node dist/index.js crash_hunter project_path="/absolute/path/to/project"
```

### Test conflict serialization (mock)
```bash
SIMULATE_WORK_MS=1500 node dist/index.js conflict_test project_path="/absolute/path/to/project"
```

## Models (current defaults in source)
- `orchestrator-main` → `openrouter/stepfun/step-3.5-flash:free`
- agents khác → `openai-codex/gpt-5.3-codex`
- fallback (agents khác) → `openrouter/deepseek/deepseek-coder-v2-lite-instruct:free`

## Logging & artifacts
- Orchestrator logs: `.openclaw/logs/orchestrator/YYYY-MM-DD.log`
- Workflow logs: `.openclaw/logs/workflows/YYYY-MM-DD.log`
- Trace logs: `.openclaw/logs/traces/YYYY-MM-DD.jsonl`
- Stage artifacts: `.openclaw/artifacts/<traceId>/<stageId>.json`

## Lưu ý kỹ thuật
- `max_parallel` hiện có trong workflow schema/data, nhưng execution hiện tại chạy tuần tự theo plan và conflict control.
- Dashboard hiện đọc trace từ file JSONL theo ngày; route detail phụ thuộc `traceId` được render từ trace record.
- `openclaw_client.ts` ưu tiên WS gateway; HTTP fallback chỉ hoạt động khi module HTTP client tồn tại.

## Repo
- GitHub: https://github.com/Phamtuandat/openclaw-orchestrator
