#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_nlp_search_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["SmartSearchRouter", "from:", "unreadOnly", "starredOnly"],
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["app.smartSearchMatches(email, query: query)"],
})
