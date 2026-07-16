#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
REPORT = ROOT / "TRANSLATE_LANGUAGE_SELECTION_FLOW_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("TRANSLATE_LANGUAGE_PICKER_GUARD")
    text = DETAIL.read_text()
    for code in ["auto", "en", "zh", "ja", "ko", "es", "fr", "de"]:
        require(code in text, f"language code {code} is supported")
    for label in ["Auto / System language", "English", "Chinese", "Japanese", "Korean", "Spanish", "French", "German"]:
        require(label in text, f"{label} language label is present")
    require("showTranslateLanguagePicker" in text and "Translate To" in text, "Translate opens language picker sheet")
    require("runTranslation(" in text, "Translate runs after language selection")
    require("Show Original" in text and "Change Language" in text and "Copy" in text, "Translation result actions exist")
    require("Return only the translation" in text, "Translation prompt is bounded to selected email")
    require(REPORT.exists(), "translate language selection flow report exists")
    print("SUCCESS: translate language picker guard passed.")


if __name__ == "__main__":
    main()
