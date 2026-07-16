#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = AI_VIEW.read_text()
    print("AI_CENTER_NO_FREEZE_GUARD")
    for state in ["runningChat", "runningSafeAction", "runningChatGPTCardAction", "runningGeminiSafeTest"]:
        require(state in text, f"AI Center button running state exists: {state}")
    require(".disabled(runningSafeAction" in text, "Safe action button disables while running")
    require(".disabled(runningChat" in text, "Chat send disables while running")
    require("Default provider: Apple Intelligence" in text, "AI Center default provider copy exists")
    print("SUCCESS: AI Center no-freeze guard passed.")


if __name__ == "__main__":
    main()
