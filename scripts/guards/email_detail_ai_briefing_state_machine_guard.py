#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = EMAIL.read_text()
    print("EMAIL_DETAIL_AI_BRIEFING_STATE_MACHINE_GUARD")
    for token in ["case idle", "case autoStarting", "case running", "case success", "case failure", "case timeout", "case cancelled", "case unavailable"]:
        require(token in text, f"briefing state includes {token}")
    for field in ["messageId", "bodyHash", "provider", "startedAt", "completedAt", "resultText", "errorMessage", "isExpanded", "lastActionSource"]:
        require(field in text, f"briefing state field exists: {field}")
    require("private struct EmailBriefingState" in text, "authoritative briefing state model exists")
    require("briefingState.phase = .success" in text, "success writes authoritative state")
    require("briefingState.phase = .failure" in text, "failure writes authoritative state")
    require("briefingState.phase = failure == .timeout ? .timeout" in text, "timeout writes authoritative state")
    print("SUCCESS: Email Detail AI Briefing state machine guard passed.")


if __name__ == "__main__":
    main()
