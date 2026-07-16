#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = EMAIL_DETAIL.read_text()
    print("APPLE_LOCAL_TRANSLATE_RESULT_GUARD")
    require("TranslationTargetLanguage" in text, "language picker model exists")
    for code in ["case auto", 'case chinese = "zh"']:
        require(code in text, f"translation language supported: {code}")
    require("Chinese" in text, "Chinese translation target is visible")
    require("await app.aiCompleteLocalStrict" in text, "Translate uses strict Apple local completion")
    require("translationResultCard" in text, "translation result card exists")
    require("Show Translation" in text and "Show Original" in text, "translation/original toggle exists")
    require("Change Language" in text and "Copy" in text, "translation controls exist")
    print("SUCCESS: Apple local translate result guard passed.")


if __name__ == "__main__":
    main()
