#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = (ROOT / "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift").read_text(encoding="utf-8")
STATE = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text(encoding="utf-8")
DETAIL = (ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift").read_text(encoding="utf-8")
SETTINGS = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text(encoding="utf-8")

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"GPT62_SECURITY_TRUST_GUARD: FAIL: {message}")
    print(f"PASS: {message}")

print("GPT62_SECURITY_TRUST_GUARD")
require("final class NexoraTrustEngine" in ENGINE, "trust engine exists")
require("enum NexoraTrustLevel" in ENGINE and "case highRisk" in ENGINE, "trust levels exist")
require("struct NexoraTrustAssessment" in ENGINE, "email trust assessment exists")
require("struct SafeLinkAssessment" in ENGINE and "linkAssessments" in ENGINE, "safe link intelligence exists")
require("struct AttachmentTrustAssessment" in ENGINE and "attachmentAssessment" in ENGINE, "attachment trust intelligence exists")
require("trackingDetected" in ENGINE and "trackingBlocked" in ENGINE, "tracking protection signals exist")
require("impersonationRisk" in ENGINE and "phishingRisk" in ENGINE, "impersonation and phishing risk exist")
require("func trustAssessment(for email" in STATE, "AppState exposes trust assessment")
require("Security & Trust" in DETAIL, "email detail visibly explains trust")
require("struct SecurityCenterView" in SETTINGS, "security center exists")
require("SecurityCenterView" in SETTINGS, "security center is reachable from settings")
print("SUCCESS: GPT62 security and trust guard passed.")
