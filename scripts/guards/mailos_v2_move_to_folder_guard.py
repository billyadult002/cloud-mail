#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_move_to_folder_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["MoveToMailboxSheet", "move-to-mailbox-"],
    "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift": ["showMoveSheet", "MoveToMailboxSheet", "moveAction(folder"],
})
