# Authority Maximization Report

Status: **PASS (scope computation and safety); BLOCKED (uncompleted live consent)**

- Feature-specific scope maps prevent unrelated Gmail, Calendar, Directory, DNS, or routing access from being requested.
- Maximum safe relevant scopes are requested together; unrelated supplied scopes are ignored.
- Zero-scope providers require verified capability evidence and can never become authorized from capability declarations alone.
- Refresh, revocation, expiry, re-verification, and failed-monitor recovery are modeled.
- Silent escalation is always disabled.
- Cloudflare owner verification performs a live zone/API probe, records partial read authority, clears stale expiry/revocation, closes onboarding work, and audits the transition.
- No live V3 provider authorization has yet been completed; production rows remain `0`.
