#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_last_three_regression_guard", {
    "CURRENT_STATUS.md": [
        "CLOUDMAIL_REAL_USE_ATTACHMENT_SEND_RECEIVE_OPEN_REAL_IPHONE_PASS",
        "CLOUDMAIL_UNIFIED_ALL_MAIL_SEND_RECEIVE_REAL_IPHONE_PASS",
        "CLOUDMAIL_REAL_USE_TESTING_CHECKLIST_NEXT_GROUP_AI_DRAFT_ASK_REPLY_FORWARD_SAFE_ACTIONS_COMPLETED",
    ],
    "files/GlassMail-project/GlassMail/Views/ComposeView.swift": ["attachmentSection", "app.undoSendQueue.queue"],
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["UndoSendQueue", "await app.send("],
    "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift": ["EmailTranslationLiveView", "Draft Reply with AI"],
})
