#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_multiselect_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["MessageSelectionManager", "selectedIDs", "selectAll"],
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["isSelectionMode", "Select All", "Cancel", "selectedEmailIds"],
})
