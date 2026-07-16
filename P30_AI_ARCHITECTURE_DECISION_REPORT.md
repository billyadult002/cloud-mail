# P30 AI Architecture Decision Report

Date: 2026-07-06

## Decision

CloudMail AI is now product-scoped to Apple Intelligence only.

- Apple Intelligence: ACTIVE, LOCAL, sole user-facing AI route.
- Gemini: DISABLED BY PRODUCT DECISION.
- ChatGPT Local Broker: DISABLED BY PRODUCT DECISION.
- Google OAuth dependency for AI: REMOVED from user path.
- Broker dependency for AI: REMOVED from user path.

## Scope

The change focused on AI Center, Settings, Inbox AI entry points, Compose AI readiness, Email Detail AI surfaces, and command-palette navigation.

Production deployment, production migration, `verify.sh`, and Production Closure were not touched.

