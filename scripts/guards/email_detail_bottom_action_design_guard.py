#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_BOTTOM_ACTION_DESIGN_GUARD")
    detail = DETAIL.read_text()
    start = detail.index("private var replyBar: some View")
    end = detail.index("    // MARK: Actions", start)
    reply_bar = detail[start:end]
    require(".buttonStyle(.glassProminent)" in reply_bar, "primary Reply uses prominent glass style")
    require(reply_bar.count(".buttonStyle(.glass)") >= 2, "secondary actions use glass style")
    require(".background(.ultraThinMaterial)" in reply_bar, "bottom row uses iOS glass material")
    require(".safeAreaInset(edge: .bottom) { replyBar }" in detail, "bottom row respects safe area")
    require("ProgressView()" in reply_bar, "AI Actions exposes working state")
    require(".help(aiBriefingUnavailableReason" in reply_bar, "AI Actions exposes unavailable reason")
    print("SUCCESS: email detail bottom action design guard passed.")


if __name__ == "__main__":
    main()
