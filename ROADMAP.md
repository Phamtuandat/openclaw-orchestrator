# ROADMAP.md — Orchestrator

Last updated: 2026-03-05 (Asia/Saigon)

---

## Phase 3 — Observability & Reliability
### Goal
Make system behavior measurable and failures recoverable with predictable policies.

### Scope
**In**
- Unified metrics for workflow/stage/agent
- Reliability policy matrix (timeouts, retries, fallback)
- Alert thresholds + basic ops dashboard

**Out**
- Full auto-remediation for all failure classes
- Multi-cluster deployment concerns

### Deliverables
- [ ] D3.1 Metrics schema (workflow, stage, agent, queue, failures)
- [ ] D3.2 Instrumentation in orchestrator + dispatcher
- [ ] D3.3 Reliability policy config (timeout/retry/circuit breaker)
- [ ] D3.4 Dashboard v1 + alert definitions
- [ ] D3.5 Runbook: top 5 incident scenarios

### Success Metrics
- Workflow success rate >= 95% (target baseline)
- P95 stage latency < defined target per workflow type
- MTTR < 15 minutes for known incidents
- Timeout false-positive rate < 2%

### Risks
- Metric overhead affects performance -> sample rates + async export
- Misconfigured retry storms -> capped retry budgets + circuit breaker

### Owner / ETA
- Owner: Orchestrator team
- ETA: TBD

---

## Phase 4 — Smarter Orchestration & Conflict Resolution
### Goal
Enable safe parallelism with accurate file/dependency conflict awareness.

### Scope
**In**
- Real file-intent extraction from tasks
- Dependency-graph-aware conflict resolver
- Better planning/splitting strategy for parallel stages

**Out**
- ML-based planner training pipeline

### Deliverables
- [ ] D4.1 File intent parser v1
- [ ] D4.2 Conflict graph builder
- [ ] D4.3 Scheduler upgrade with lock groups
- [ ] D4.4 Planner prompts + decomposition templates

### Success Metrics
- Parallel execution gain > 30% on suitable workflows
- Conflict-induced failure rate < 3%
- Duplicate/overlap edits reduced by > 50%

### Risks
- Over-conservative locking lowers throughput -> adaptive lock granularity
- Under-detected conflicts -> stricter fallback serialization mode

### Owner / ETA
- Owner: Orchestrator team
- ETA: TBD

---

## Phase 5 — Persistence, Governance, and Tooling
### Goal
Improve auditability, durability, and team operation ergonomics.

### Scope
**In**
- Persistent state/log index (SQLite or equivalent)
- Governance rules (policy packs, approval hooks)
- Dev tooling for workflow replay/debug

**Out**
- Enterprise org-wide RBAC platform

### Deliverables
- [ ] D5.1 Persistence schema + migration strategy
- [ ] D5.2 Workflow replay command + trace comparison
- [ ] D5.3 Policy hooks for sensitive actions
- [ ] D5.4 Changelog automation for major decisions

### Success Metrics
- Replayability for >= 90% failed workflows
- Audit trace completeness >= 99%
- Mean debug time reduced by > 40%

### Risks
- Storage growth -> retention + compaction policy
- Policy friction -> staged rollout + override flow

### Owner / ETA
- Owner: Orchestrator team
- ETA: TBD
