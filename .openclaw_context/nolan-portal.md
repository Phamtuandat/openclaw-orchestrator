# Context — Nolan Chat Portal

## Repo / Path
- Local: `/Users/datpham/tailscale-min-server`
- GitHub: `https://github.com/Phamtuandat/nolan-chat-portal`

## Current architecture snapshot
- Backend: Node/Express modularized (`backend/` + `backend.js` entrypoint)
- Frontend: React + Vite (`web/`)
- Ports:
  - Web: `3000`
  - API: `3001`

## Power audit decisions (locked)
- Read from existing minute logger service: `com.datpham.powerlog`
- Source log: `/Users/datpham/.openclaw/power-logs/power.log`
- Audit mode: read-only
- Summary endpoint used by UI: `GET /api/audit/power/summary`
- Persisted analytics for chart prep: `data/power-analytics.json`

## UI state snapshot
- Left menu reorganized and includes Nolan/profile + project state hints.
- Session output stores info/error logs in localStorage.
- Composer styled ChatGPT-like with auto-expand for long messages.
