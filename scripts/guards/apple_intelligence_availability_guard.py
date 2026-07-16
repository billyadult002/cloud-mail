#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
APPLE_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AppleFoundationProvider.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP_STATE.read_text()
    provider = APPLE_PROVIDER.read_text()
    print("APPLE_INTELLIGENCE_AVAILABILITY_GUARD")
    for token in ["deviceNotEligible", "appleIntelligenceNotEnabled", "modelNotReady", "@unknown default"]:
        require(token in provider, f"Apple provider maps availability state {token}")
    require("appleIntelligenceAvailabilityMessage" in app, "AppState exposes Apple Intelligence availability message")
    require("Apple Intelligence is unavailable on this device or disabled in Settings." in app, "Unavailable message is user-visible")
    print("SUCCESS: Apple Intelligence availability guard passed.")


if __name__ == "__main__":
    main()
