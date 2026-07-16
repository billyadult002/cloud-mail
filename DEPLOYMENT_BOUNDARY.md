# Deployment Boundary

Date: 2026-07-05

## Production Rules

- No production deploy unless explicitly authorized.
- No production migration unless separately authorized.
- Do not run `verify.sh` unless explicitly requested.
- Do not reopen Production Closure.
- Do not modify `IPA_READY`.
- Do not modify `PASS_PRODUCTION_READY`.
- Do not modify `STATUS=CLOSED`.

## Current Loop Boundary

This loop creates indexes, status docs, ignore boundaries, and readiness reports only. It does not deploy, migrate, or change production readiness state.

