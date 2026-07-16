# Email Detail Compact Action Bar Real iPhone Report

Task source: `/Users/billtin/Downloads/IMG_2177.heic`

Image request read as:

邮件详情页需要更紧凑；底部 `Reply / Forward / Draft / Ask / Translate` 五个功能改成小图标显示。当前按钮太大，页面不协调。

## Changes

- Replaced the large text bottom action buttons in `EmailDetailView.swift`.
- Added five compact icon actions:
  - Reply
  - Forward
  - Draft
  - Ask
  - Translate
- Split Draft and Ask out of the previous combined AI Actions entry.
- Preserved direct navigation/action destinations:
  - Reply -> compose launcher
  - Forward -> compose launcher
  - Draft -> live draft reply view
  - Ask -> live Ask AI view
  - Translate -> live Chinese translation view
- Preserved accessibility labels and identifiers for icon-only controls.

## Guard Validation

- `email_detail_compact_action_bar_guard.py`: PASS
- `email_detail_reply_compose_context_guard.py`: PASS
- `forward_send_context_guard.py`: PASS
- `email_detail_translate_direct_start_guard.py`: PASS

## Real iPhone Validation

- Build: PASS
- Install to USB-connected iPhone: PASS
- Launch: PASS
- Real-device screenshot captured:
  - `evidence/compact-action-bar-devicectl-20260706-203929.png`

Observed result:

- Bottom bar shows five compact circular icon controls.
- Large `Reply`, `Forward`, `Translate`, `AI Actions` text buttons are gone.
- AI Briefing remains summarize-only.
- Attachment section remains visible.

## Boundaries

- No production Worker deploy.
- No migration.
- `verify.sh` not run.
- `IPA_READY`, `PASS_PRODUCTION_READY`, and `STATUS=CLOSED` not modified.
