# CHANGELOG-orchestrator.md

Format:
- Date:
- Decision:
- Why:
- Impact:
- Rollback Plan:

---

## 2026-03-05
- **Decision:** Implement orchestrator core in TypeScript/Node.js under `.openclaw/` with JSON-defined workflows and stage dependency model.
- **Why:** Fast iteration speed, simple integration with existing OpenClaw runtime, low setup overhead.
- **Impact:** Established unified engine foundation for observability, scheduling, and agent dispatch.
- **Rollback Plan:** Freeze new workflow features and keep mock-only orchestration runner while evaluating alternate runtime.

## 2026-03-05
- **Decision:** Keep `MockAgentDispatcher` as default and gate real dispatch behind runtime adapter (`OpenClawAgentDispatcher`).
- **Why:** Enables safe local testing and progressive rollout without breaking developer flow.
- **Impact:** Stable testing path; real dispatch can be enabled selectively.
- **Rollback Plan:** Force mock dispatcher globally if external API instability appears.

## 2026-03-05
- **Decision:** Add self-healing v1 (retry + exponential backoff + retryable/fatal classification) and timeout-based stuck detection.
- **Why:** Reduce transient failure impact and prevent silent hangs.
- **Impact:** Better completion rate for retryable errors; explicit timeout failures for diagnosis.
- **Rollback Plan:** Disable retries for problematic workflows and fall back to single-attempt strict mode.

## 2026-03-05
- **Decision:** Introduce conflict serialization primitive (`fileIntents`, `waitIfConflicted`) with placeholder intent mapping.
- **Why:** Immediate guardrail against obvious parallel file collisions while full resolver is pending.
- **Impact:** Safer parallel runs now, with known accuracy limitations.
- **Rollback Plan:** Force serialized stage execution for high-risk workflows until full conflict resolver lands.
