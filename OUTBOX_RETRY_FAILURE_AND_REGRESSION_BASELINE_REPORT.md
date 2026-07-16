# Outbox Retry Failure and Regression Baseline Report

Date: 2026-07-06

## Baseline

- Task: `CLOUDMAIL_REAL_USE_OUTBOX_RETRY_FAILURE_AND_REGRESSION_SWEEP_CLOSURE`
- Repository check: PASS.
- Bundle id: `app.wangbei8554.pingguo736`.
- Real iPhone UDID: `70CD0BB3-0832-5A94-BA91-82A634A54CF8`.
- Cloudflare auth: available, redacted.
- Latest observed production Worker version: `9be2d734-b45a-43b1-92b3-ded63afa0ce8`.
- Production Worker deploy in this loop: NOT RUN, not required because no backend code changed.
- Production migration: NOT RUN.
- `verify.sh`: NOT RUN.

## Previous PASS Groups To Preserve

- `CLOUDMAIL_REAL_USE_ATTACHMENT_SEND_RECEIVE_OPEN_REAL_IPHONE_PASS`.
- `CLOUDMAIL_UNIFIED_ALL_MAIL_SEND_RECEIVE_REAL_IPHONE_PASS`.
- `CLOUDMAIL_REAL_USE_TESTING_CHECKLIST_NEXT_GROUP_AI_DRAFT_ASK_REPLY_FORWARD_SAFE_ACTIONS_COMPLETED`.

## Boundary

ProviderAccepted remains separate from Delivered. No Delivered claim is made for provider-accepted or local outbox states.
