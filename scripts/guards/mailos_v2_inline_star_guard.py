#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_inline_star_guard", {
    "files/GlassMail-project/GlassMail/Views/InboxView.swift": ["inline-star-toggle", "app.setStar(email, starred: !email.isStarred)"],
    "files/GlassMail-project/GlassMail/Services/AppState.swift": ["func setStar", "persistMailStateOverlay", "backend.star"],
})
