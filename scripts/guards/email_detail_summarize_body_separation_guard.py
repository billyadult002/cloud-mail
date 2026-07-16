#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = DETAIL.read_text(encoding="utf-8")
    start = text.index("private var briefingSummarySurface")
    end = text.index("@ViewBuilder\n    private func summaryBadges", start)
    summary = text[start:end]
    body_start = text.index("var body: some View")
    body_end = text.index(".background(AmbientBackground())", body_start)
    body = text[body_start:body_end]

    print("EMAIL_DETAIL_SUMMARIZE_BODY_SEPARATION_GUARD")
    require('Label("Summarize", systemImage: "text.bubble")' in summary, "Summarize label remains visible")
    require("Color.gray.opacity(0.14)" in summary, "Summarize panel uses visible light gray background")
    require(".strokeBorder(Color.gray.opacity(0.18), lineWidth: 1)" in summary, "Summarize panel has a subtle border")
    require("Divider()" in body and ".opacity(0.58)" in body, "Email body is separated from AI Briefing by a stronger divider")
    print("SUCCESS: Email detail summarize/body separation guard passed.")


if __name__ == "__main__":
    main()
