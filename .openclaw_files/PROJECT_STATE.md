# PROJECT_STATE.md — Orchestrator Current Snapshot

Last updated: 2026-03-05 (Asia/Saigon)

## 1) System Goal
Build a reliable multi-agent orchestrator for coding workflows with strong observability, safe parallelism, and fast recovery.

## 2) Current Architecture
- Runtime: TypeScript/Node.js (`.openclaw/`)
- Core modules:
  - `logger`
  - `workflow_tracer`
  - `file_index_builder`
  - `dependency_graph_builder`
  - `orchestrator`
  - `agent_dispatcher`
  - `openclaw_client`
- Agent pool:
  - `orchestrator-main`
  - `logic-agent`
  - `ui-agent`
  - `test-agent`
  - `safety-review-agent`
- Workflow format: JSON stages + dependencies + safety gates

## 3) Completed Phases
### Phase 0 — Observability ✅
- Structured JSON logs with `traceId`
- Workflow tracing with execution history
- Log buckets: `.openclaw/logs/{orchestrator,agents,workflows,traces}/`

### Phase 1 — Basic Orchestrator ✅
- File index scanning (Swift codebase)
- Dependency graph from imports + cycle detection + fanout scoring
- Topological scheduling + bounded parallel execution
- Crash Hunter workflow validated end-to-end

### Phase 2 — Advanced Features ✅
- Real dispatch adapter (`MockAgentDispatcher` / `OpenClawAgentDispatcher`)
- Model routing with primary + fallback
- Conflict serialization primitive (`fileIntents`, `waitIfConflicted`)
- Self-healing v1 (retry/backoff + retryable/fatal classification)
- Health monitor for in-flight stages + timeout auto-fail

## 4) Known Open Risks
- Conflict detection is placeholder-level (intent mapping still coarse)
- Limited production-grade metrics (no full dashboard/SLI view yet)
- Persistence layer not finalized (SQLite/TSDB decision pending)
- Recovery policies may need stricter circuit-breaker semantics

## 5) Current Priorities (Top 3)
1. Production observability (SLI, metrics, dashboard, alerting)
2. Conflict resolution based on real dependency/file graph
3. Reliability hardening (timeout policy matrix, circuit breaker, recovery playbooks)

## 6) Definition of “Healthy System”
- Workflow success rate stable above target
- P95 stage latency within target
- Clear traceability: workflow -> stage -> agent -> file intent
- Fast failure diagnosis (MTTR within target)
