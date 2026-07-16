#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_RESULT_SURFACE_GUARD")
    detail = DETAIL.read_text()
    require("actionResultCard" in detail, "shared action result card exists")
    require("actionStatusMessage" in detail and "actionErrorMessage" in detail, "actions have success and error state")
    require("translationResultCard" in detail, "translation has inline result surface")
    require("isTranslating = true" in detail and "isTranslating = false" in detail, "translation has loading lifecycle")
    require("isDrafting || isTranslating || isTriaging" in detail, "bottom AI Actions reflects async work")
    require("Dismiss action result" in detail, "result surface can be dismissed")
    print("SUCCESS: email detail result surface guard passed.")


if __name__ == "__main__":
    main()
