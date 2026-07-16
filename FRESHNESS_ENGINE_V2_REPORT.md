# Freshness Engine V2 Report

Date: 2026-07-07

## Changes
- Running sync cleanup now uses account timeout budget instead of waiting for the full stale interval.
- Stale running Gmail sync rows are marked failed before a new run proceeds.
- Legacy IMAP Gmail accounts are immediately moved to an actionable reconnect state instead of leaving `syncing` stale.

## Evidence
- Stale run `244` was completed and failed before run `245`.
- Run `245` completed without CPU limit failure.
- OAuth account `52` refreshed at `2026-07-07 19:39:17`.
