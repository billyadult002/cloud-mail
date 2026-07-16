#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_TRANSLATE_RESULT_GUARD")
    detail = DETAIL.read_text()
    require("showTranslateLanguagePicker = true" in detail, "Translate opens target language picker")
    require("runTranslation(language)" in detail, "language selection invokes translation runner")
    require("await app.aiCompleteLocal(" in detail, "translation uses local Apple Intelligence completion route")
    require("translationResult = EmailTranslationResult(" in detail, "successful translation creates result model")
    require("translationResultCard" in detail, "Email Detail has translation result card")
    require("Show Translation" in detail and "Show Original" in detail, "result card supports original/translation toggle")
    require("Change Language" in detail, "result card supports language change")
    require('Label("Copy", systemImage: "doc.on.doc")' in detail, "result card supports copy")
    require("Provider used:" in detail, "result card shows provider metadata")
    require("actionErrorMessage = app.errorMessage" in detail, "translation failure surfaces provider error")
    print("SUCCESS: email detail translate result guard passed.")


if __name__ == "__main__":
    main()
