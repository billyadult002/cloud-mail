# REST-Only Migration Plan

## Status

`rest_only_migration_plan = READY`

## Primary Runtime

`gmail_rest_api`

## Legacy IMAP Runtime

`migration_only_reconnect_recovery_deprecated`

## Migration Targets

- Gmail connect: Google OAuth + REST profile probe.
- Gmail receive: REST `messages.list` metadata-first import.
- Gmail freshness: REST history/list checkpoints.
- Gmail send: REST `messages.send` with explicit send scope.
- Diagnostics: Gmail Platform V2 capability/health/truth engines.

## Boundaries

No new Gmail IMAP primary runtime is introduced. No production deployment was run.
