
# Guard Scripts Reorg Plan

Generated: 2026-07-05 22:11:24

## Recommendation For Later Loop

- Do not move guard scripts yet.
- Preserve direct path compatibility for recent loops.
- Add a future wrapper: `scripts/run_regression_suite.py`.
- Group suites logically inside wrapper instead of moving 100+ files.

## Required Keep Guards

- `scripts/repository_check.py`
- `scripts/guards/email_detail_translate_result_guard.py`
- `scripts/guards/ai_actions_local_fallback_guard.py`
- `scripts/guards/p28_reliability_closure_regression.py`
- `scripts/guards/p29a_information_density_regression.py`
- `scripts/guards/gemini_status_preservation_guard.py`
- `scripts/guards/chatgpt_local_broker_status_guard.py`
- `scripts/guards/restored_account_fix_preservation_guard.py`
- `scripts/guards/ai_secret_safety_guard.py`
