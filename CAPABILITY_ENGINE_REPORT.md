# Capability Engine Report

Date: 2026-07-07

## Result
PASS.

## Capability Fields
The provider truth snapshot now exposes:
- `canLogin`
- `canSend`
- `canReceive`
- `canSync`
- `canRoute`
- `canAIProcess`

## Root-Cause Fix
Restored Gmail/Google Workspace accounts no longer infer send capability purely from provider type when no backend/unified contract exists.

## Send Identity Safety
Default sending identity selection now prefers accounts with confirmed `canSend` capability.
