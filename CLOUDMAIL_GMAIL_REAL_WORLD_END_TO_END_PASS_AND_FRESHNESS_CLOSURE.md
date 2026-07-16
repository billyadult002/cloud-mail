# CLOUDMAIL_GMAIL_REAL_WORLD_END_TO_END_PASS_AND_FRESHNESS_CLOSURE

Status: `IN_PROGRESS`

User-visible source of truth:
- `REAL_IPHONE_VISIBLE_TRUTH`

Allowed final statuses:
- `CLOUDMAIL_GMAIL_REAL_WORLD_END_TO_END_PASS`
- `BLOCKED_PENDING_USER_PROVIDER_AUTHORIZATION`
- `BLOCKED_EXTERNAL_PROVIDER_RESTRICTION_WITH_TRUTH_PAGE`

Mandatory visible pass evidence:
- fresh Gmail added
- Google OAuth success
- callback success
- initial import success
- mailbox ready
- All Mail top visible row contains newest Gmail test email
- T1 - T0 <= 60 seconds
- screenshot evidence present

Current loop:
1. Determine exact Gmail freshness/import cause with API/token/scheduler/history/freshness evidence.
2. Fix and deploy any CloudMail causes.
3. Use real iPhone for Add Gmail/OAuth/import/All Mail validation.
4. If provider login/MFA/consent is needed, show `USER ACTION REQUIRED` and continue after user completes it.
