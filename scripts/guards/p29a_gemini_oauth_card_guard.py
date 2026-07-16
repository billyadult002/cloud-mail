#!/usr/bin/env python3
"""P29A guard for Gemini OAuth lifecycle preservation after P30 UI removal."""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
GEMINI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/GeminiProvider.swift"


def fail(message: str) -> None:
    print(f"P29A_GEMINI_OAUTH_CARD_GUARD_FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


app_state = APP_STATE.read_text(encoding="utf-8")
backend = BACKEND.read_text(encoding="utf-8")
models = MODELS.read_text(encoding="utf-8")
provider = AI_PROVIDER.read_text(encoding="utf-8")
gemini_provider = GEMINI_PROVIDER.read_text(encoding="utf-8")
combined = "\n".join([app_state, backend, models, provider, gemini_provider])

print("P29A_GEMINI_OAUTH_CARD_GUARD")

for marker in [
    "struct GeminiOAuthStatus",
    "pending_google_test_user",
    "approved_waiting_google_sync",
    "oauthSuccess",
    "oauthFailures",
]:
    require(marker in combined, f"Gemini P27 lifecycle marker preserved: {marker}")

for marker in [
    "Gemini account authorization is not available in this build.",
    "backend-held runtime authorization",
]:
    require(marker in gemini_provider, f"P30 Gemini disabled guidance present: {marker}")

require("billyadult006@gmail.com" not in combined, "hard-coded Gmail test user is absent from production Gemini UI")
require(re.search(r"[A-Za-z0-9._%+-]+@gmail\\.com", combined) is None, "no hard-coded Gmail address appears in Gemini production UI")

print("SUCCESS: P29A Gemini OAuth lifecycle guard passed.")
