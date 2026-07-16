#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_undo_send_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["UndoSendQueue", "5_000_000_000", "func undo"],
    "files/GlassMail-project/GlassMail/Views/ComposeView.swift": ["undoSendBanner", "QueuedUndoSnapshot", "Sending in 5 seconds"],
})
