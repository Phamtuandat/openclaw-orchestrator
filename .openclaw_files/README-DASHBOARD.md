# OpenClaw Dashboard v0

Dashboard lightweight (Node HTTP server, không DB) để xem traces/logs/artifacts của orchestrator.

## Chạy dashboard

```bash
cd /Users/datpham/.openclaw/workspace/.openclaw
npm run build
node dist/dashboard.js
```

Mặc định chạy tại: `http://localhost:3001`

## Data sources thực tế
Dashboard đọc trực tiếp từ filesystem:
- Traces: `.openclaw/logs/traces/*.jsonl`
- Logs: `.openclaw/logs/{orchestrator,agents,workflows}/YYYY-MM-DD.log`
- Artifacts: `.openclaw/artifacts/<traceId>/*.json`

## Routes hiện có
- `GET /` hoặc `/workflows` — danh sách traces gần đây
- `GET /workflows/:traceId` — trang chi tiết trace
- `GET /api/traces` — JSON list traces
- `GET /api/trace/:traceId` — đọc file `.openclaw/logs/traces/<traceId>.jsonl`
- `GET /api/artifacts/:traceId/:stageId` — artifact JSON của stage
- `GET /api/logs/:component/:date` — log raw text theo component/ngày

## Lưu ý quan trọng
- Trace logs hiện được ghi theo file ngày (`YYYY-MM-DD.jsonl`), không phải mặc định 1 file/trace.
- Vì vậy, route `/api/trace/:traceId` chỉ hoạt động nếu tồn tại file tên `<traceId>.jsonl`.
- UI `/workflows` vẫn hiển thị traceId từ record trong JSONL; detail page dùng traceId đó để render.

## Test nhanh
1. Chạy một workflow để có dữ liệu:
```bash
node dist/index.js crash_hunter project_path="/absolute/path/to/project"
```
2. Mở dashboard:
- `http://localhost:3001/workflows`
- click trace để xem stage/artifact

## Scope hiện tại
- Read-only dashboard
- Không auth
- Chưa có pagination/filter nâng cao
