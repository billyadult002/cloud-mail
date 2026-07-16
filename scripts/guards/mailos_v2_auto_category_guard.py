#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_auto_category_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["MailCategoryEngine", "MailOSV2Category", "primary", "transactions", "forums"],
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["MailOSV2CategoryBadge", "app.v2Category(for: email)"],
})
