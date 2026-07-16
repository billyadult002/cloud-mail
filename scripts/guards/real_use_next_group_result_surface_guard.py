#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "EmailDetailView.swift"
AIVIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    ai = AIVIEW.read_text(encoding="utf-8")

    print("REAL_USE_NEXT_GROUP_RESULT_SURFACE_GUARD")
    require("Text(ProductSafeText.sanitize(draftText, context: .ai))" in detail, "Draft Reply displays generated text")
    require("Text(ProductSafeText.sanitize(answer, context: .ai))" in detail, "Ask AI displays generated answer")
    require('Label("Insert into Compose", systemImage: "square.and.pencil")' in detail, "Draft Reply has compose insertion result action")
    require("Text(ProductSafeText.sanitize(workflowResult.text, context: .ai))" in ai, "Safe Mail Action displays workflow text")
    require('LabeledContent("Action", value: workflowResult.workflow.title)' in ai, "Safe Mail Action displays action name")
    require('LabeledContent("Messages", value: "\\(workflowResult.messageCount)")' in ai, "Safe Mail Action displays message count")
    require("Text(workflowResult.runtimeBoundary)" in ai, "Safe Mail Action displays runtime boundary")
    print("SUCCESS: Real-use next group result surface guard passed.")


if __name__ == "__main__":
    main()
