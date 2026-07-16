#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "EmailDetailView.swift"
AIVIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"
APPSTATE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    ai = AIVIEW.read_text(encoding="utf-8")
    app = APPSTATE.read_text(encoding="utf-8")

    print("REAL_USE_NEXT_GROUP_NO_FREEZE_GUARD")
    for view_name in ["EmailDraftReplyLiveView", "EmailAskAILiveView"]:
        start = detail.find(f"private struct {view_name}")
        end = detail.find("private struct", start + 20)
        block = detail[start:end if end != -1 else len(detail)]
        require("isRunning = false" in block, f"{view_name} clears spinner")
        require("errorMessage" in block and "Retry" in block, f"{view_name} has visible failure and retry")
        require(".task(id: runID)" in block, f"{view_name} can rerun without stale spinner")
    live_start = ai.find("private struct SafeMailActionLiveView")
    live = ai[live_start:]
    require("isRunning = false" in live and "errorMessage" in live, "Safe Mail Action page clears spinner and surfaces error")
    require(".task(id: runID)" in live and "Retry" in live, "Safe Mail Action page can rerun")
    require("withLocalAITimeout" in app and "localAIActionTimeoutNanoseconds" in app and "LocalAIActionTimeout" in app, "Apple local actions retain timeout protection")
    print("SUCCESS: Real-use next group no-freeze guard passed.")


if __name__ == "__main__":
    main()
