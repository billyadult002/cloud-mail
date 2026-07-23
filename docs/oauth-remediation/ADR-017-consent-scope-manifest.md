# ADR-017 — Consent Scope Manifest and Independent Approval Gate

Status: Accepted for pre-production remediation review

## Decision

CloudMail owns a versioned Google scope manifest independent of Codex connectors and
provider UI text. Version `google-oauth-scopes-v1` approves exactly:

- `openid` — identity subject binding
- `email` — canonical account identity binding
- `https://www.googleapis.com/auth/gmail.readonly` — `mail_read`

Metadata, compose, send, modify, and full-mail scopes are classified but are not approved.
The full-mail scope is explicitly prohibited because it includes deletion authority.

Before an authorization URL is produced, a separate verifier compares canonicalized
requested capabilities and exact scopes against the manifest. Unknown, missing,
unexpected, overbroad, unapproved, or prohibited scopes fail closed. The manifest
version and digest are bound to an authorization-session sidecar together with the OAuth
client fingerprint and redirect hash. After exchange, the exact granted scope set is
checked again; substitution or scope drift becomes `REAUTHORIZATION_REQUIRED` before
credential promotion.

The future human retry gate requires an independent checker to inspect the redacted
scope summary and compare its digest/version with the reviewed manifest before consent.
Plugin permissions and installed connector state are never inputs to this decision.
