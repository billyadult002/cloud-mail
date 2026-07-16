# Outbox Retry Failure State Model Report

Date: 2026-07-06

## Changes

- Added explicit local delivery states: `queued`, `failed`, `dead`, `cancelled`.
- Preserved `provider_accepted` as separate from `delivered`.
- Added cancel transition for local Outbox rows.
- Added Debug-only real-device launch hooks for invalid recipient, retry, failed, cancelled, Outbox search, and All Mail search.

## Verification

- Outbox invalid recipient guard: PASS.
- Outbox retry/failure state guard: PASS.
- Outbox cancel state guard: PASS.
- Outbox All Mail/local ledger guard: PASS.
- ProviderAccepted != Delivered guard: PASS.
- Xcode beta simulator build: PASS.
- Xcode beta real iPhone build/install: PASS.
