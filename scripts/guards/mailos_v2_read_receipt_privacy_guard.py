#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_read_receipt_privacy_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["OptionalReadReceiptManager", "mailos_v2_read_receipts_enabled"],
    "files/GlassMail-project/GlassMail/Views/ComposeView.swift": ["readReceiptSection", "Optional and off by default", "does not prove delivery"],
})
