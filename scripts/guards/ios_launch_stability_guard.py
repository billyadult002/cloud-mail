#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app_state = APP_STATE.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    load_more_start = inbox.index("private var loadMoreRow")
    load_more_end = inbox.index("private var emptyState", load_more_start)
    load_more = inbox[load_more_start:load_more_end]

    print("IOS_LAUNCH_STABILITY_GUARD")
    require("private var bootstrapTask: Task<Void, Never>?" in app_state, "launch bootstrap is tracked as a single task")
    require("scheduleBootstrapAfterLaunch()" in app_state, "startup schedules controlled bootstrap")
    require("450_000_000" in app_state, "startup bootstrap is delayed so cached UI can render first")
    require("allowDuringBootstrap" in app_state, "refreshIfStale avoids competing with bootstrap")
    require("Task { await refreshProviderReadiness() }" not in app_state[app_state.index("init()"):app_state.index("deinit")], "provider readiness no longer starts as a separate launch race")
    require(".onTapGesture { Task { await app.loadMore() } }" in load_more, "older mail remains user-triggered")
    require(".onAppear { Task { await app.loadMore() } }" not in load_more, "iOS older-mail pagination no longer auto-fires on startup")
    print("SUCCESS: iOS launch stability guard passed.")


if __name__ == "__main__":
    main()
