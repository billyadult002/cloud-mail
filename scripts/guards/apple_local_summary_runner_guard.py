#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
ROUTER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP.read_text()
    router = ROUTER.read_text()
    print("APPLE_LOCAL_SUMMARY_RUNNER_GUARD")
    require("func triageLocalStrict" in app, "strict Apple local summary runner exists")
    require("withLocalAITimeout" in app, "strict runner has timeout wrapper")
    require("router.triageLocal(subject: subject, from: from, body: body)" in app, "strict runner calls Apple local router")
    require("Apple Intelligence summary timed out. Try again." in app, "timeout reason is user-visible")
    require("Apple Intelligence returned an empty summary" in app, "empty summary is failure, not success")
    require("func triageLocal(subject: String, from: String, body: String)" in router, "router exposes Apple local triage")
    require("requestedProvider: .apple" in router and "executedProvider: .apple" in router, "runner metadata labels Apple Intelligence")
    print("SUCCESS: Apple local summary runner guard passed.")


if __name__ == "__main__":
    main()
