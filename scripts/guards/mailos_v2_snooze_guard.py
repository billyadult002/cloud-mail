#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_snooze_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["SnoozeScheduler", "SnoozeEntry", "isSnoozed"],
    "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift": ["snoozeAction", "Later Today", "Next Week"],
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["snoozeScheduler.isSnoozed", "case .snoozed"],
})
