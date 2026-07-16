#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_unsubscribe_block_spam_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["UnsubscribeDetector", "unsubscribeAvailable", "blockSender"],
    "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift": ["unsubscribeAction", "blockSenderAction", "Move to Junk"],
})
