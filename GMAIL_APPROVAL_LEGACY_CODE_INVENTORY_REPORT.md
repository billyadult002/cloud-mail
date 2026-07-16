# Gmail Approval Legacy Code Inventory Report

Generated: 2026-07-08

Inventory found the default Gmail path previously touched legacy approval code in:

- `platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js`
- `platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js`
- `platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js`
- `files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift`
- `files/GlassMail-project/GlassMail/Services/AppState.swift`
- `files/GlassMail-project/GlassMail/Services/Backend.swift`
- `files/GlassMail-project/GlassMail/Models/Models.swift`

Root causes found:

- Gmail OAuth start called `requestAccess`, which wrote `pending_google_test_user`.
- Google `access_denied` callback called `recordAccessDenied`, which also wrote pending by default.
- iOS callback special-cased `pending_google_test_user` into a Pending Approval message.
- Add Gmail issue screens exposed Request Access in the normal path.
- Approval Center mapped `oauth_success` and non-approved rows into misleading request buckets.

No production data was deleted or migrated.
