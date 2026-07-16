#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    email = EMAIL_DETAIL.read_text()
    app = APP_STATE.read_text()
    print("AI_CLOUD_PROVIDER_NOT_DEFAULT_GUARD")
    forbidden = ["runSafeProviderAction(providerID:", "aiWorkspaceSyntheticAction", "await app.aiComplete(", "await app.draftReply(", "await app.triage("]
    for token in forbidden:
        require(token not in email, f"Email Detail does not call cloud/generic provider path: {token}")
    require("await app.triageLocalStrict" in email, "Email Detail summary uses Apple local strict path")
    require("await app.aiCompleteLocalStrict" in email, "Email Detail text actions use Apple local strict path")
    require("await app.draftReplyLocalStrict" in email, "Email Detail draft uses Apple local strict path")
    require("cloudAIEnabled" in app, "Cloud AI consent remains preserved for AI Center/provider actions")
    print("SUCCESS: AI cloud provider not default guard passed.")


if __name__ == "__main__":
    main()
