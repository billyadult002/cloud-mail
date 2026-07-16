#!/usr/bin/env python3
from mailos_v2_guard_lib import main

main("mailos_v2_category_learning_guard", {
    "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift": ["SenderRuleEngine", "learn(email:", "SenderCategoryRule"],
    "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift": ["learnCategoryAction", "Move to Category"],
})
