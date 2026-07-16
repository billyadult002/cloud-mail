# Email Detail Auto Summary On Open Real iPhone Report

Date: 2026-07-06

## Result

PASS.

Opening an email now shows an AI summary in the Email Detail AI Briefing card without requiring the user to tap Generate, AI Actions, or any other control.

## What Changed

- Email Detail now renders an immediate local opening summary when the message opens.
- The AI Briefing card no longer shows a manual Generate button in the idle state.
- Automatic Apple-local briefing startup is scheduled before security analysis so summary UX is not blocked by other email analysis work.
- Automatic startup no longer waits on provider readiness UI state; it uses local AI consent as the start gate.

## Real iPhone Validation

- Installed bundle id: `app.wangbei8554.pingguo736`.
- Real iPhone build: PASS.
- Real iPhone install/launch: PASS.
- Manual action performed: opened Inbox, tapped an email.
- Observed result: AI Briefing displayed summary immediately on open.

## Evidence

- Screenshot: `artifacts/email-detail-auto-summary-on-open/real-device-email-detail-summary-visible.png`
- Mirroring screenshot: `artifacts/email-detail-auto-summary-on-open/real-device-email-detail-summary-visible-mirroring.png`
- Build log: `artifacts/email-detail-auto-summary-on-open/real-device-build-7.log`
- Install log: `artifacts/email-detail-auto-summary-on-open/real-device-install-7.log`

## Verification

- `email_detail_auto_summary_on_open_guard.py`: PASS.
- `p30_apple_intelligence_only_ai_guard.py`: PASS.
- `ai_secret_safety_guard.py`: PASS.

## Boundaries

- `verify.sh`: NOT RUN.
- Production deploy/migration: NOT RUN.
- OAuth/Gemini/ChatGPT cloud validation: NOT CLAIMED.

