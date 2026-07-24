# ADR-019: Secure staging database bootstrap

## Status

Approved for the bounded NEXORA staging authority-bootstrap mission.

## Context

The staging D1 database has the canonical application and NEXORA tables but lacks the legacy `setting` baseline required by the existing UI. The historical initializer accepts `jwt_secret` in a URL path. URL credentials can enter browser history, request metadata, access logs, screenshots, and referrer surfaces, so that route is not an acceptable staging recovery mechanism.

## Decision

- Add a staging-only, explicitly enabled, one-shot `POST /api/init/secure`.
- Keep its schema in `staging-migrations/`; it is never part of the shared production migration chain.
- Use a dedicated masked `NEXORA_STAGING_BOOTSTRAP_SECRET`; never reuse `jwt_secret`.
- Accept the secret only in the request body and apply `no-store`, `no-referrer`, restrictive CSP, and no external resources.
- Deny the historical `/api/init/:secret` route in staging before reading or comparing the path value.
- Create the canonical final `setting` row and repair the three staging columns required by the existing registration entities. Registration requires the same one-time bootstrap secret as its registration code. The first normal user insert atomically creates its CloudMail account and `FIRST_USER_CREATED` checkpoint. A second credentialed ceremony creates the sole canonical workspace and OWNER membership before `COMPLETE`.
- Use a singleton D1 operation ledger and commit-time zero-authority trigger. This makes concurrent requests single-winner and replay-safe.
- Treat D1 as the durable commit. If the subsequent KV refresh fails, retain `DB_COMMITTED`; only an authenticated single-winner lease may refresh KV and transition to `READY_FOR_FIRST_AUTHORITY`. Normal registration then records `FIRST_USER_CREATED`; a credentialed relational check transitions to `COMPLETE` only after the same user owns an account and workspace membership.
- After the first normal registration completes the exact authority tuple, disable the feature and delete the dedicated staging secret.

## Consequences

Normal registration remains the only path that creates the human user. The credentialed completion ceremony creates and binds the otherwise-missing canonical workspace primitive; it cannot run without the exact first user/account checkpoint. OAuth acceptance remains blocked until that tuple is independently verified. Production behavior and bindings are unchanged.
