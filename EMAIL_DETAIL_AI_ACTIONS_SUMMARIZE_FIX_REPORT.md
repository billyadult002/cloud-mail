# Email Detail AI Actions Summarize Fix Report

Date: 2026-07-06

## Fix

Email Detail AI Actions -> Summarize now routes to `runBriefing(source: .generateButton, force: true)`.

## Result

Summarize, Generate, Refresh, and auto-start now share the same Apple-local runner and result surface. The action is disabled while a briefing is already running.

## Verification

- `email_detail_ai_actions_summarize_result_guard.py`: PASS
- Xcode beta simulator build: PASS

