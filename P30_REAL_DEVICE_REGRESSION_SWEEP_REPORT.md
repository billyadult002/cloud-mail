# P30 Real Device Regression Sweep Report

Date: 2026-07-06

## Preserved Groups

- P25: PRESERVED.
- P27: PRESERVED.
- P28: PRESERVED.
- P29A: PRESERVED.
- REAL_USE_SEND: PRESERVED.
- REAL_USE_ATTACHMENT: PRESERVED.
- REAL_USE_ALL_MAIL: PRESERVED.
- REAL_USE_OUTBOX_RETRY_FAILURE: PRESERVED.

## Guard Results

- `outbox_invalid_recipient_guard.py`: PASS.
- `outbox_retry_failure_state_guard.py`: PASS.
- `outbox_cancel_state_guard.py`: PASS.
- `outbox_all_mail_ledger_guard.py`: PASS.
- `provider_accepted_not_delivered_guard.py`: PASS.
- `last_three_pass_regression_guard.py`: PASS.
- `email_detail_auto_summary_on_open_guard.py`: PASS.
- `email_detail_ai_draft_reply_guard.py`: PASS.
- `email_detail_ask_ai_guard.py`: PASS.
- `email_detail_reply_compose_context_guard.py`: PASS.
- `email_detail_forward_compose_context_guard.py`: PASS.
- `safe_mail_actions_action_first_real_use_guard.py`: PASS.
- `apple_local_translate_result_guard.py`: PASS.
- `email_detail_star_button_guard.py`: PASS.
- `p28_reliability_closure_regression.py`: PASS.
- `p29a_gemini_oauth_card_guard.py`: PASS.

## Real iPhone Regression Evidence

- REAL_USE_SEND / REAL_USE_ALL_MAIL:
  - `evidence/p30-all-mail-search-121605-20260706-165042.png`
- REAL_USE_ATTACHMENT:
  - `evidence/p30-attachment-preview-20260706-165042.png`
  - `evidence/p30-attachment-share-export-20260706-165042.png`
- REAL_USE_OUTBOX_RETRY_FAILURE:
  - `evidence/p30-compose-invalid-recipient-20260706-165042.png`
  - `evidence/p30-outbox-state-machine-20260706-165042.png`
  - `evidence/p30-outbox-state-summary-20260706-165042.json`
- AI/detail/P28/P29A surfaces:
  - `evidence/p30-email-detail-actions-121605-20260706-165042-v2.png`
  - `evidence/p30-ai-center-20260706-165042.png`
  - `evidence/p30-account-center-oauth-messaging-20260706-165042.png`

## Decision

`regression_detected = FALSE`

No regression was detected in the P30 real-device acceptance sweep.
