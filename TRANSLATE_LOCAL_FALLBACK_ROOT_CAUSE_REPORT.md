# Translate Local Fallback Root Cause Report

Date: 2026-07-05

## Root Cause

Two Translate surfaces had different failure modes:

- Email Detail Translate selected the target language inside a sheet and immediately started translation while dismissing the sheet. On real iPhone this could look like no action because the visible page did not reliably show the transition.
- AI Center Safe Mail Actions routed provider actions through the selected provider smoke path first. When Gemini returned `failed`, the UI showed failure instead of continuing through local Apple Intelligence.

## Fix

- Email Detail Translate now queues the selected language, dismisses the sheet, and starts translation from the main page after the sheet closes.
- Email Detail Translate now uses `aiCompleteLocal`, forcing the Apple Intelligence local path.
- AI Center Safe Mail Actions now tries the selected provider path, then falls back to Apple Intelligence local synthetic action if provider/model reachability fails.
- Local safe fallback uses synthetic prompts only and marks mailbox/customer data as not sent.

## Boundary

No production deployment, migration, token, cookie, OAuth code, or secret access was performed.

