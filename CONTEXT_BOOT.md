# CONTEXT_BOOT.md — Minimal startup context

## Purpose
A tiny anchor so Nolan can quickly recover context after restart/new session.

## Default project focus
- Primary active product: **Decky** (repo in `/Volumes/Home_EX/Projects/Xcode/Projects/AnkiClone/Decky`)
- Before answering Decky questions, check:
  1) `PROJECT_STATE.md` in Decky repo
  2) latest git commits
  3) current local changes (`git status -sb`)

## User intent style
- Prefer concise status first, then action plan.
- Avoid duplicate implementation when an existing service/mechanism already exists.
- If uncertain, verify in code/repo before answering.

## Control rules
- Treat this file as startup hint only (minimal, high-signal).
- Update only when project focus changes.
