#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_bulk_actions_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["BulkActionToolbar", "MessageActionRegistry", "batchActions"],
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["selection-toggle-read", "selection-trash", "selection-move", "selection-junk", "selection-star"],
})
