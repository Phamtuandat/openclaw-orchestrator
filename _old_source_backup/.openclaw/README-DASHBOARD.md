# OpenClaw Dashboard v0

Lightweight file-based web UI for inspecting workflow traces, logs, and artifacts.

---

## 🚀 Quick Start

```bash
# 1. Build (if not already)
cd /Users/datpham/.openclaw/workspace/.openclaw
npm run build

# 2. Start dashboard server
node dist/dashboard.js

# 3. Open in browser
http://localhost:3001
```

---

## 📁 Data Sources (file-based)

Dashboard reads directly from:

- **Traces:** `.openclaw/logs/traces/*.jsonl` (compiled trace logs)
- **Logs:** `.openclaw/logs/{orchestrator,agents,workflows}/{YYYY-MM-DD}.log`
- **Artifacts:** `.openclaw/artifacts/<traceId>/*.json` (stage outputs)

No database required.

---

## 📄 Pages

### `/workflows` (Home)
Lists recent workflow traces (last 50). Shows:
- Trace ID (link to detail)
- Date
- Stage count
- Duration
- Status badge (completed/failed)

### `/workflows/:traceId`
Detail page for a specific trace:
- Header: trace ID, status, duration, started At, artifacts availability
- Stages list: each stage shows:
  - Stage ID, agent ID, model used, attempt count
  - Duration, status badge
  - Error (if any) in red box
  - Link to artifact JSON (if available)
- Raw trace logs (last 10 entries from orchestrator log)

### `/api/traces` (JSON)
List of traces (same as home page data)

### `/api/trace/:traceId` (JSON)
Full trace data (all stages + summary)

### `/api/artifacts/:traceId/:stageId` (JSON)
Stage result artifact (includes output, error, durationMs, modelUsed, attempt)

### `/api/logs/:component/:date` (plain text)
Raw log file for component on given date (e.g., `orchestrator/2026-03-04`)

---

## 🎯 Testing with Crash Hunter

1. Ensure you have a trace with artifacts:
```bash
USE_REAL_AGENT=true node dist/index.js crash_hunter project_path="/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky/Decky"
```

2. Open dashboard → click the latest trace → inspect stage artifacts.

---

## 🔧 Configuration

Dashboard runs on port `3001` by default. Change in code if needed.

---

## 📝 Notes

- Dashboard is read-only, no writes.
- Logs are streamed from the file system; no parsing needed.
- For large trace logs, consider pagination (not implemented in v0).

---

Enjoy your OpenClaw observability! 🚀
