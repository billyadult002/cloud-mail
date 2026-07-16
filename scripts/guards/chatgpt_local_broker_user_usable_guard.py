#!/usr/bin/env python3
"""Guard ChatGPT Local Broker user-usable AI Workspace mapping."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    app_state = APP_STATE.read_text(encoding="utf-8")
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    provider = PROVIDER.read_text(encoding="utf-8")
    combined = "\n".join([app_state, ai_view, provider])
    print("CHATGPT_LOCAL_BROKER_USER_USABLE_GUARD")
    for marker in [
        "ChatGPT Local Broker",
        "Pair Owner Mac",
        "ownerMacBrokerURL",
        "pairOwnerMacLocalBroker",
        "chatGPTLocalBrokerSafeAction",
        "owner_mac_local_broker_signed_transport_pass",
        "/pair/start",
        "/pair/confirm",
        "/ai/smoke",
        "x-cloudmail-signature",
        "x-cloudmail-timestamp",
        "x-cloudmail-nonce",
        "HMAC<SHA256>",
        "providerId: \"chatgpt\"",
        "methodId: smoke.adapterID",
        "mailboxDataSent: false",
        "customerDataSent: false",
        "sharedPlatformApiKey: false",
    ]:
        require(marker in combined, f"ChatGPT local broker usable marker exists: {marker}")
    require("Project Alpha meeting has been moved from 2 PM to 4 PM" not in combined, "static fake broker result removed")
    for forbidden in ["ChatGPT Cloud OAuth", "auth.openai.com", "openai_access_token", "openai_refresh_token"]:
        require(forbidden not in combined, f"forbidden ChatGPT cloud/session marker absent: {forbidden}")
    print("SUCCESS: ChatGPT Local Broker user-usable guard passed.")


if __name__ == "__main__":
    main()
