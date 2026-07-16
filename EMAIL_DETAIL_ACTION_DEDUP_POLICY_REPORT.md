# Email Detail Action Dedup Policy Report

Date: 2026-07-05

## Policy

Email Detail now uses one action location per action family:

- Top toolbar: status-level actions only, including Star, Archive, and More.
- More menu: secondary utility and destructive actions.
- Bottom row: primary reading flow actions: Reply, Forward, AI Actions.
- AI Actions menu: Summarize, Translate, Draft Reply with AI, Ask AI.
- Inline result cards: action outcome, translation result, and errors.

## Removed Duplicates

- Removed legacy inline AI Workspace surface from Email Detail.
- Removed legacy inline AI Copilot surface from Email Detail.
- Removed duplicate top Reply, Translate, and AI Draft routes.

## Verification

`scripts/guards/email_detail_no_duplicate_actions_guard.py`: PASS

