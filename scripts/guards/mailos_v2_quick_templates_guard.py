#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_quick_templates_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["QuickReplyTemplateStore", "Thanks, I received"],
    "files/GlassMail-project/GlassMail/Views/ComposeView.swift": ["quickReplyTemplateSection", "quick-reply-template-store"],
})
