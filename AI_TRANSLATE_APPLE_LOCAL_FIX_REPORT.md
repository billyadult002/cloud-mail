# AI Translate Apple Local Fix Report

Date: 2026-07-05

Fix:
- Translate keeps the language picker.
- Supported internal codes: `auto`, `en`, `zh`, `ja`, `ko`, `es`, `fr`, `de`.
- Language selection now starts strict Apple local completion.
- Result card supports Show Original, Show Translation, Change Language, and Copy.
- Failure/timeout shows inline retry/change-language path and does not fall back to Gemini or ChatGPT.

Evidence:
- `apple_local_translate_result_guard.py`: PASS.
- iOS simulator build: PASS.
- iOS generic-device unsigned build: PASS.

Manual tap-through:
- Not performed; fresh real-device install was blocked by signing/provisioning.
