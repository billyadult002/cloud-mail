#!/usr/bin/env python3
"""Guard provider-scoped error surfaces."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    print("AI_PROVIDER_ERROR_SURFACE_FINAL_GUARD")
    require("localError = geminiOAuth403Message" not in ai_view, "Gemini 403 is not duplicated into global bottom error")
    require("localError = \"This provider is visible for status only" in ai_view, "non-runnable provider errors remain scoped to action attempt")
    require("AIActionResultView(result: safeActionResult, error: localError)" in ai_view, "result/error pane remains local to Safe Mail Actions card")
    print("SUCCESS: Provider error surface final guard passed.")


if __name__ == "__main__":
    main()
