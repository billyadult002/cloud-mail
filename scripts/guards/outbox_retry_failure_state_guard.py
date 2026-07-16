#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("OUTBOX_RETRY_FAILURE_STATE_GUARD")
    require("case retryScheduled" in models and "case failedPermanent" in models and "case failed" in models, "retry and failure states exist")
    require("case queued" in models and "case dead" in models and "case cancelled" in models, "terminal/local outbox states exist")
    require("case .draft, .queued" in models and ".dead, .cancelled" in models, "non-delivered states are not accepted send UX")
    require("deliveryState: .failedPermanent" in app, "failed sends stay in outbox with failed state")
    require("deliveryState = .retryScheduled" in app, "retry scheduled state is recorded")
    require("case .queued, .failed, .failedPermanent, .bounced, .dead, .cancelled" in app, "send result switch handles all local failure states")
    require("Message remains in Outbox and will retry." in app, "retry state has visible text")
    require("Provider did not accept this message. It remains in Outbox." in app, "failed provider state has visible text")
    require("debugSeedOutboxSmoke" in app and "Retry scheduled. Provider has not accepted delivery; this is not Delivered." in app, "debug retry state can be verified on device")
    require("Failed sends will stay here with the real error." in inbox, "Outbox explains failure retention")
    print("SUCCESS: Outbox retry/failure state guard passed.")


if __name__ == "__main__":
    main()
