# Default Gmail Approval Gate Removal Report

Default Gmail onboarding no longer creates a CloudMail pending approval request.

Implemented:

- Replaced default `requestAccess()` preflight with `recordAutoApproved()`.
- Removed `pending_google_test_user` from normal OAuth callback return.
- Changed Google blocked callback to `google_oauth_blocked`.
- Removed Request Access from the default Add Gmail issue path.
- Kept enterprise approval code isolated in governance/admin screens.

Default target flow:

Add Gmail -> CloudMail Auto Approved -> Direct Google OAuth -> Callback -> Importing -> Mailbox Ready.
