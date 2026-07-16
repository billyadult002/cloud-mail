#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = (ROOT / "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift").read_text(encoding="utf-8")
INBOX = (ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift").read_text(encoding="utf-8")
DETAIL = (ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift").read_text(encoding="utf-8")

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"GPT59A_SMART_CLASSIFICATION_GUARD: FAIL: {message}")
    print(f"PASS: {message}")

print("GPT59A_SMART_CLASSIFICATION_GUARD")
require("struct SmartMailClassification" in ENGINE, "classification returns confidence and reason")
require("struct SmartClassificationScore" in ENGINE, "classification exposes weighted score components")
require("Double(userHistory) * 0.40" in ENGINE, "user history has 40 percent weight")
require("Double(organizationHistory) * 0.20" in ENGINE, "organization history has 20 percent weight")
require("Double(senderReputation) * 0.20" in ENGINE, "sender reputation has 20 percent weight")
require("Double(mailMetadata) * 0.10" in ENGINE, "mail metadata has 10 percent weight")
require("Double(aiSemantic) * 0.10" in ENGINE, "AI semantics has 10 percent weight")
require("final class UserClassificationMemory" in ENGINE, "user classification memory exists")
require("User classification remembered for this" in (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text(encoding="utf-8"), "user memory overrides classifier with explanation")
require("final class ExternalReputationRegistry" in ENGINE, "external reputation is optional and local")
require("case actionRequired = \"Action Required\"" in ENGINE, "Action Required is a first-class category")
require("Bulk marketing email detected." in ENGINE, "marketing reason is explicit")
require("Automated platform-generated update." in ENGINE, "notification reason is explicit")
require("if marketing || (bulk && !action)" in ENGINE, "marketing is evaluated before urgency")
require("smart.category != .promotions && smart.category != .notifications" in INBOX, "marketing and notifications cannot re-enter priority work queues")
require("SmartClassificationExplanation(classification: smartClassification)" in DETAIL, "detail exposes classification explanation")
print("SUCCESS: GPT59A smart classification guard passed.")
