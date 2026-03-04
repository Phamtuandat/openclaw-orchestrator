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

---

## 📁 Cấu trúc

```
.openclaw/
├── core/
│   ├── logger.ts                 # Structured JSON logging + traceId
│   ├── workflow_tracer.ts        # Workflow execution tracing
│   ├── file_index_builder.ts     # Build file index từ workspace
│   ├── dependency_graph_builder.ts  # Tạo dependency graph
│   ├── orchestrator.ts           # Main engine
│   └── self_healing.ts           # Retry & fallback (Phase 2)
├── workflows/
│   ├── crash_hunter.json         # Workflow definitions
│   ├── feature_dev.json
│   └── bug_fix.json
├── logs/
│   ├── orchestrator/
│   ├── agents/
│   ├── workflows/
│   └── traces/                   # Trace logs
├── index/
│   ├── file_index.json           # File → agent mapping
│   └── dependency_graph.json     # Dependency graph
├── schemas/
│   └── workflow.schema.json      # JSON schema cho workflow definitions
├── agents/                       # Agent definitions (Phase 2)
│   ├── logic-agent/
│   ├── ui-agent/
│   └── ...
└── index.ts                      # Bootstrap entry point

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
# Trên dự án Decky:
node dist/index.js crash_hunter project_path="/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky/Decky"

# Với scope giới hạn:
node dist/index.js crash_hunter project_path="/path/to/project" scope="views"
```

---

## 📊 Output

**Logs:**
- Structured JSON logs in `.openclaw/logs/`
- `orchestrator/` - main orchestrator logs
- `workflows/` - per-workflow logs
- `traces/` - execution traces (JSONL)

**Index:**
- `.openclaw/index/file_index.json` - file metadata
- `.openclaw/index/dependency_graph.json` - dependency graph

**Trace:**
- Mỗi workflow execution tạo trace với `traceId`
- Có thể theo dõi toàn bộ execution flow qua traces

---

## 🔧 Workflow Definition Schema

```json
{
  "id": "crash_hunter",
  "name": "Crash Hunter",
  "version": "1.0.0",
  "inputs": {
    "required": ["project_path"],
    "optional": ["scope", "max_files_per_agent"]
  },
  "stages": [
    {
      "id": "stage_name",
      "agentId": "logic-agent",
      "task": "Description của task",
      "dependsOn": ["previous_stage"],
      "parallel": true,
      "targets": {
        "file_patterns": ["**/*Store.swift"]
      },
      "timeout_seconds": 600,
      "outputs": ["logic_findings"]
    }
  ],
  "max_parallel": 4,
  "timeout_minutes": 30,
  "safety_gates": [
    {
      "name": "no_file_modifications",
      "check": { "type": "function", "function": "verifyNoFileChanges" },
      "blockOnFailure": true
    }
  ]
}
```

---

## 🤖 Agent Integration

Agents được spawn qua OpenClaw `sessions_spawn`:

```typescript
// Trong orchestrator.ts:
private async dispatchToAgent(agentId: string, prompt: string, options: any) {
  // Gọi OpenClaw API
  const result = await sessions_spawn({
    agentId,
    task: prompt,
    // ... other options
  });
  return result;
}
```

---

## 🔄 Self-Healing (Phase 2)

- **Retry:** Exponential backoff on timeout/rate limit
- **Fallback Models:** Switch to alternative models (e.g., deepseek-coder-v2-lite-instruct:free)
- **Granularity Decrease:** Break large tasks into smaller chunks
- **Circuit Breaker:** Stop sending tasks to repeatedly failing agents
- **Rollback:** Revert changes if safety gates fail

---

## 📈 Metrics & Dashboard (Phase 3)

- Workflow success rate
- Agent performance (latency, token usage)
- Dependency graph analytics
- Real-time execution monitor

---

## 🧪 Testing

```bash
# Unit tests
npm test

# Run linter
npm run lint
```

---

## 🛠️ Development

### Thêm workflow mới

1. Tạo file `workflows/your_workflow.json`
2. Validate với schema: `npm run validate-schema`
3. Reload orchestrator (restart)

### Thêm agent mới

1. Thêm definition trong OpenClaw config (`openclaw.json` agents.list)
2. Tạo prompt template nếu cần
3. Workflow có thể dispatch tới agent mới

---

## 📝 License

MIT © OpenClaw

---

## 🙏 Credits

Built for the OpenClaw ecosystem.  
Kiến trúc: TypeScript/Node.js  
Integration: OpenClaw sub-agents
