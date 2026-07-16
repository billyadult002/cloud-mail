#!/usr/bin/env python3
"""Static regression guard for truthful, shared mail visibility."""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
models = (root / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text()
inbox = (root / "files/GlassMail-project/GlassMail/Views/InboxView.swift").read_text()
app_state = (root / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

required = [
    "enum MailVisibilityEngine",
    "struct MailVisibilityTrace",
    "MailVisibilityEngine.render(",
    "recordRenderedMailTrace",
    "First Count Drop",
]
haystack = models + inbox + app_state
missing = [value for value in required if value not in haystack]
if missing:
    raise SystemExit("GPT57 visibility guard failed: " + ", ".join(missing))

if "return indexedMessages" in inbox:
    raise SystemExit("GPT57 visibility guard failed: indexed count is still substituted for rendered count")

print("GPT57_VISIBILITY_ENGINE_GUARD_PASS")
