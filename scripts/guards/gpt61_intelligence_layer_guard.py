#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = (ROOT / "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift").read_text(encoding="utf-8")
STATE = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text(encoding="utf-8")

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"GPT61_INTELLIGENCE_LAYER_GUARD: FAIL: {message}")
    print(f"PASS: {message}")

print("GPT61_INTELLIGENCE_LAYER_GUARD")
require("final class NexoraIntelligenceEngine" in ENGINE, "unified intelligence layer exists")
require("struct CategoryGovernance" in ENGINE, "category governance model exists")
require("struct RelationshipIntelligence" in ENGINE, "relationship intelligence exists")
require("struct SecurityIntelligence" in ENGINE, "security intelligence foundation exists")
require("OrganizationClassificationMemory" in ENGINE and "organizationClassificationMemory" in STATE, "organization learning is explicit and wired")
require("func governance(for category: SmartMailCategory)" in ENGINE, "governance is shared through the intelligence layer")
require("func relationship(for email: EmailMessage" in ENGINE, "relationship scoring is shared through the intelligence layer")
require("func security(for email: EmailMessage" in ENGINE, "security scoring is shared through the intelligence layer")
require("nexoraIntelligenceEngine.classify" in STATE, "classification uses the unified intelligence layer")
require("Organization classification remembered for this domain." in STATE, "organization decisions are explainable")
print("SUCCESS: GPT61 intelligence layer guard passed.")
