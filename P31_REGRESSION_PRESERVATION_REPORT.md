# P31 Regression Preservation Report

## Passed

- `python3 scripts/guards/p31_domain_security_foundation_guard.py`
- `npm run test:unit`
- `npm run test:rc`
- `npx vitest run scripts/reliability-tests/p31-domain-foundation.test.mjs`
- `python3 scripts/guards/p28_reliability_closure_regression.py`
- `python3 scripts/guards/p29a_gemini_oauth_card_guard.py`
- `python3 scripts/guards/provider_accepted_not_delivered_guard.py`
- `python3 scripts/guards/unified_all_mail_contract_guard.py`
- `python3 scripts/guards/unified_all_mail_previous_pass_preservation_guard.py`
- `python3 scripts/guards/attachment_all_mail_ledger_guard.py`
- `python3 scripts/guards/outbox_retry_failure_state_guard.py`

Worker reliability suite result:

- 8 test files passed
- 61 tests passed

## Guard Boundaries

Three P27 guard scripts failed before evaluating the current code because of existing guard drift:

- `p27_outbound_send_state_regression.py` looked for `scripts/files/...`
- `p27_account_timestamp_display_regression.py` looked for `scripts/files/...`
- `p27_oauth_eligibility_visibility_regression.py` expected old `Tester:` UI text

Equivalent regression coverage was provided by ProviderAccepted, delivery ledger, P28, P29A, All Mail, attachment ledger, and outbox guards.

## Regression Result

`regression_detected = FALSE` for the code touched in P31.
