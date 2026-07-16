# P31 Generic Regression Preservation Report

## Status

`regression_detected = FALSE_FOR_TOUCHED_CODE`

## Passed

- `npm run test:unit`
- `npm run test:rc`
- `scripts/guards/p31_domain_security_foundation_guard.py`
- `scripts/guards/p28_reliability_closure_regression.py`
- `scripts/guards/provider_accepted_not_delivered_guard.py`
- `scripts/guards/p27_outbound_send_state_regression.py`
- `scripts/guards/p27_account_timestamp_display_regression.py`
- `scripts/guards/p29a_gemini_oauth_card_guard.py`
- `scripts/guards/p30_apple_intelligence_only_ai_guard.py`
- Unified All Mail guards.
- Attachment ledger/download/preservation guards.
- Outbox retry/failure and All Mail ledger guards.

## Verification Boundary

- `p27_oauth_eligibility_visibility_regression.py` still expects older Settings UI text such as `Tester:` and was not used as the current P29A/P30 authority.
- `gemini_auth_regression_guard.py` expects a visible Gemini OAuth CTA, while current P30 policy preserves Apple Intelligence only and removes Gemini user path. Current P29A/P30 guards passed.

## iOS

No iOS code was touched in this P31 generic engine task, so no real iPhone retest was required.
