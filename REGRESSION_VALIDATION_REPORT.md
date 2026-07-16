# Regression Validation Report

- Worker syntax/unit contract tests: PASS.
- Worker reliability suite: PASS, 11 files / 99 tests.
- Dependency audit: PASS, production high/critical vulnerabilities zero.
- Signed IPA: PASS, bundle `app.wangbei8554.pingguo736`, version `2.5`.
- Real device install: PASS.
- Real device foreground/UI visibility: PASS after USB retry; visible Inbox screenshot captured and launch UI test passed.
- Real device workflow regression: FAIL; mailbox-first-screen test reached Inbox but failed opening the compact mailbox drawer.
- Live deployment parity: FAIL; production CORS header remains wildcard, unlike local code.

GPT58–GPT65 regression certification: **BLOCKED** until live deployment parity and visible device execution are restored.
