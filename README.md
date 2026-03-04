# OpenClaw Orchestrator v2

**Intelligent workflow engine for coordinated multi-agent Swift development**

---

## 🎯 Overview

OpenClaw Orchestrator v2 là hệ thống điều phối workflow cho phép:
- Chạy nhiều agent chuyên biệt song song
- Phân tích dependencies và tự động sắp xếp thứ tự
- Tự động retry, fallback, self-healing
- Tracing và logging cấu trúc
- Safety gates validation
- Dashboard theo dõi real-time

---

## 📁 Cấu trúc

```
.openclaw/
├── core/
│   ├── logger.ts                 # Structured JSON logging + traceId
│   ├── workflow_tracer.ts        # Workflow execution tracing
│   ├── file_index_builder.ts     # Build file index từ workspace
│   ├── dependency_graph_builder.ts  # Tạo dependency graph
│   ├── orchestrator.ts           # Main engine (with retry/fallback/artifacts)
│   ├── agent_dispatcher.ts       # Mock + real agent dispatch adapter
│   └── openclaw_client.ts        # HTTP client cho OpenClaw gateway
├── workflows/
│   ├── crash_hunter.json         # Crash detection workflow
│   ├── feature_dev.json          # (planned)
│   └── bug_fix.json              # (planned)
├── logs/
│   ├── orchestrator/             # Main orchestrator logs
│   ├── agents/                   # Agent-specific logs
│   ├── workflows/                # Workflow logs
│   └── traces/                   # Execution traces (JSONL)
├── artifacts/                    # Stage outputs (by traceId)
│   └── <traceId>/
│       └── <stageId>.json
├── index/
│   ├── file_index.json           # File → agent mapping
│   └── dependency_graph.json     # Dependency graph (edges, cycles)
├── schemas/
│   └── workflow.schema.json      # JSON schema cho workflow definitions
├── dashboard.ts                  # Dashboard v0 server
├── index.ts                      # CLI bootstrap
├── package.json
├── tsconfig.json
└── README.md                     # This file

```

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
cd .openclaw
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Run Crash Hunter workflow

```bash
# Trên dự án Decky (mock agents):
node dist/index.js crash_hunter project_path="/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky/Decky"

# Với real agents (cần OpenClaw gateway chạy):
USE_REAL_AGENT=true node dist/index.js crash_hunter project_path="/path/to/project"

# Với scope giới hạn:
node dist/index.js crash_hunter project_path="/path/to/project" scope="views"
```

---

## 📊 Output Files

**Logs (JSON):**
- `.openclaw/logs/orchestrator/YYYY-MM-DD.log`
- `.openclaw/logs/workflows/YYYY-MM-DD.log`
- `.openclaw/logs/traces/YYYY-MM-DD.jsonl` (full trace data)

**Artifacts:**
- `.openclaw/artifacts/<traceId>/<stageId>.json` (stage output)

**Index:**
- `.openclaw/index/file_index.json` (file metadata)
- `.openclaw/index/dependency_graph.json` (dependency analysis)

---

## 🔧 Workflow Definition Schema

```json
{
  "id": "crash_hunter",
  "name": "Crash Hunter",
  "version": "1.0.0",
  "tags": ["safety", "analysis", "swiftui"],
  "inputs": {
    "required": ["project_path"],
    "optional": ["scope", "max_files_per_agent"],
    "schema": {
      "type": "object",
      "properties": {
        "project_path": { "type": "string", "description": "Absolute path to SwiftUI project" },
        "scope": { "type": "string", "enum": ["all", "views", "viewmodels", "services"], "default": "all" }
      }
    }
  },
  "stages": [
    {
      "id": "codebase_scan",
      "agentId": "orchestrator-main",
      "task": "Scan repository structure and classify files",
      "dependsOn": [],
      "parallel": false,
      "outputs": ["file_classification"]
    },
    {
      "id": "logic_scan",
      "agentId": "logic-agent",
      "task": "Scan ViewModels and services for crash risks",
      "dependsOn": ["codebase_scan"],
      "parallel": true,
      "targets": { "file_patterns": ["**/*Store.swift", "**/*ViewModel.swift"] },
      "timeout_seconds": 600,
      "outputs": ["logic_findings"]
    }
  ],
  "max_parallel": 4,
  "timeout_minutes": 30,
  "retry_policy": {
    "max_retries": 2,
    "backoff": "exponential",
    "fallback_models": ["openrouter/deepseek/deepseek-coder-v2-lite-instruct:free"]
  },
  "safety_gates": [
    { "name": "no_file_modifications", "check": { "type": "function", "function": "verifyNoFileChanges" }, "blockOnFailure": true }
  ]
}
```

---

## 🤖 Agent System

### Predefined Agents

| Agent ID | Role | Models | Capabilities |
|----------|------|--------|--------------|
| `orchestrator-main` | Planner/Coordinator | step-3.5-flash:free | Planning, task decomposition, safety validation, integration |
| `logic-agent` | Logic & Services | gpt-5.3-codex → deepseek fallback | ViewModel, services, state management, bug fixes |
| `ui-agent` | SwiftUI Views | gpt-5.3-codex → deepseek fallback | Views, layout, bindings, accessibility identifiers |
| `test-agent` | Testing | gpt-5.3-codex → deepseek fallback | Unit tests, snapshot tests, UI smoke tests |
| `safety-review-agent` | Safety Audit | gpt-5.3-codex → deepseek fallback | Concurrency, MainActor, memory leaks, error handling |

### Agent Dispatch

**Default (mock):** For testing workflow without real agents
```bash
node dist/index.js crash_hunter ...
```

**Real agents:** Set `USE_REAL_AGENT=true` → uses OpenClaw `sessions_spawn` API
```bash
USE_REAL_AGENT=true node dist/index.js crash_hunter ...
```

---

## 🔄 Self-Healing

### Retry Logic
- Max retries: 2 per stage
- Exponential backoff: 1s → 2s → 4s (max 10s)
- Retryable errors: timeout, rate limit, unavailable, network

### Fallback Models
- Primary: `openai-codex/gpt-5.3-codex`
- Fallback: `openrouter/deepseek/deepseek-coder-v2-lite-instruct:free`
- Orchestrator uses `step-3.5-flash:free` (no fallback)

---

## ⚠️ Safety Features

### Conflict Serialization
- File intent tracking prevents concurrent modification of same files
- Stages wait if conflicting files are in use
- Placeholder implementation (uses patterns); ready for real file resolution

### Health Monitor
- In-flight session tracking
- Stuck detection: if stage runs > timeout → auto-fail with `TIMEOUT`
- Heartbeat placeholder for future liveness probes

### Safety Gates
- `no_file_modifications`: Ensures analysis-only workflows don't modify files
- `all_agents_completed`: Warns if any agent stage failed
- Custom gates can be added per workflow

---

## 📈 Dashboard v0

Lightweight file-based web UI for inspecting traces, logs, and artifacts.

### Start Dashboard

```bash
# Build first
npm run build

# Start server (default port 3001)
node dist/dashboard.js
```

### Pages

- **`/workflows`** - List recent traces (from `logs/traces/*.jsonl`)
- **`/workflows/:traceId`** - Detail view: stages, artifacts, logs
- **`/api/traces`** - JSON list of traces
- **`/api/trace/:traceId`** - Full trace data
- **`/api/artifacts/:traceId/:stageId`** - Stage artifact JSON
- **`/api/logs/:component/:date`** - Raw log file (e.g., `orchestrator/2026-03-04`)

**Access:** http://localhost:3001/workflows

---

## 🧪 Testing & Validation

### Test Crash Hunter (Mock)

```bash
node dist/index.js crash_hunter project_path="/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky/Decky"
```

Expected output:
- File index built (65 Swift files)
- Dependency graph generated
- 6 stages complete (orchestrator-main, logic-agent, ui-agent, safety-review-agent, test-agent, orchestrator-main)
- Artifacts saved to `.openclaw/artifacts/<traceId>/`
- Trace saved to `.openclaw/logs/traces/YYYY-MM-DD.jsonl`

### Test Real Agents (Requires OpenClaw Gateway)

1. Ensure OpenClaw gateway is running with agents configured
2. Set `USE_REAL_AGENT=true`
3. Run same command; watch logs for dispatch attempts, retries, fallbacks

---

## 🛠️ Development

### Adding New Workflows

1. Create `workflows/your_workflow.json`
2. Validate against `schemas/workflow.schema.json`
3. Restart orchestrator (hot-reload may be added later)

### Adding New Agents

1. Add agent definition to OpenClaw config (`openclaw.json` → agents.list)
2. Ensure agent has appropriate skills
3. Reference `agentId` in workflow stages

---

## 📝 License

MIT © OpenClaw

---

## 🙏 Credits

Built for the OpenClaw ecosystem.  
Architecture: TypeScript/Node.js  
Integration: OpenClaw sub-agents via `sessions_spawn`

---

## 🔗 Links

- **GitHub:** https://github.com/Phamtuandat/openclaw-orchestrator
- **OpenClaw Docs:** https://docs.openclaw.ai
- **Discord:** https://discord.com/invite/clawd
