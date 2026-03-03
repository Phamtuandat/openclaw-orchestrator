# CONTEXT_BOOT.md — Minimal startup context

## Purpose
Tiny router for fast context recovery after restart/new session.

## Active Context Router
When user intent matches keywords, load corresponding context file first:

1) Decky / AnkiClone
- Keywords: `decky`, `ankiclone`, `study app`, `ios app`
- Load: `context/decky.md`
- Then verify in repo: `PROJECT_STATE.md` + `git log` + `git status`

2) Nolan Chat Portal
- Keywords: `nolan portal`, `chat portal`, `port 3000`, `tailscale-min-server`
- Load: `context/nolan-portal.md`

3) Personal assistant / lifestyle ops
- Keywords: `routine`, `lifestyle`, `health`, `productivity`
- Load: `context/personal-assistant.md`

4) iPhone build/deploy
- Keywords: `cài lên iphone`, `build ios`, `deploy iphone`, `install app iphone`
- Load: `context/iphone-deploy.md`

5) Ops bot / hạ tầng vận hành
- Keywords: `ops`, `incident`, `log lỗi`, `healthcheck`, `deploy`, `server`
- Load: `context/ops-bot.md`

## Default behavior
- If unclear intent: ask 1 clarifying question, then load the nearest context file.
- Keep this file minimal; put details inside `context/*.md`.

## Control rules
- Reuse existing implementations; avoid duplicate mechanisms.
- Verify before claiming status.
