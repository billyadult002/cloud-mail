# AI Briefing Summary Root Cause Report

Date: 2026-07-05

## Scope

Investigate why AI Briefing, Email Detail AI Summary, and related AI buttons appeared not to work.

## Root Cause

Email Detail AI Summary started provider triage in the background but did not reliably expand the briefing surface or show a finished local result path. The Ask AI action mostly opened the AI panel/status UI and did not invoke summary generation. Several visible buttons still depended on the generic provider path, so provider/cloud gating could make user actions appear inactive.

## Fix

- Added local Apple Intelligence triage in the AI router.
- Added local Apple Intelligence draft reply in the AI router.
- Added AppState local triage and local draft reply entry points.
- Updated Email Detail AI Summary to call local triage and auto-expand the briefing panel.
- Updated Ask AI to trigger the briefing generation path.
- Routed Compose, AI Center, Inbox swipe AI, and legacy AI Workspace summary through local-first AppState methods.

## Data Boundary

No token files, browser cookies, OAuth codes, refresh tokens, secrets, or customer mailbox credentials were accessed. Existing provider state and production closure markers were preserved.

