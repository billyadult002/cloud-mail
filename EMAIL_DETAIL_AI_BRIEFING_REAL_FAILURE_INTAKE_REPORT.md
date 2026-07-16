# Email Detail AI Briefing Real Failure Intake Report

Date: 2026-07-06

## Reported Failure

On a real iPhone, Email Detail showed Apple Intelligence as ready, but the AI Briefing card could remain at "No briefing has been generated..." and the bottom AI action spinner could stay active.

## Root Cause Classification

- `BRIEFING_UI_READS_WRONG_STATE`
- `RESULT_WRITTEN_TO_NON_AUTHORITATIVE_SURFACE`
- `SPINNER_NOT_CLEARED_ON_COMPLETION`
- `AUTO_RUN_KEY_BLOCKS_RERUN_AFTER_NON_SUCCESS`

## Boundary

This task only addressed Email Detail AI Briefing / Summarize Apple-local result state and spinner cleanup. It did not deploy production, run migrations, run `verify.sh`, change secrets, or remove Gemini / ChatGPT Local Broker preservation paths.

