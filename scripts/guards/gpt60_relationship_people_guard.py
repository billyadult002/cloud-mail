#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENGINE = (ROOT / "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift").read_text(encoding="utf-8")
STATE = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text(encoding="utf-8")

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"GPT60_RELATIONSHIP_PEOPLE_GUARD: FAIL: {message}")
    print(f"PASS: {message}")

print("GPT60_RELATIONSHIP_PEOPLE_GUARD")
require("relationshipEstablished: Bool = false" in ENGINE, "classifier accepts an explicit relationship gate")
require("if relationshipEstablished" in ENGINE, "People requires relationship evidence")
require("No established relationship evidence; kept outside People." in ENGINE, "unknown senders have an explicit non-People explanation")
require("profileEmailSet(mailClientProfile.favoriteContactEmails)" in STATE, "favorite contacts are relationship evidence")
require("profileEmailSet(mailClientProfile.vipContactEmails)" in STATE, "VIP contacts are relationship evidence")
require("profileEmailSet(mailClientProfile.starredContactEmails)" in STATE, "starred contacts are relationship evidence")
require("autocompleteLearning?[sender]" in STATE, "user interaction history is relationship evidence")
require("senderHistoryCount >= 2" in STATE, "conversation history is relationship evidence")
require("relationshipEstablished(for: email" in STATE, "relationship gate is wired into the unified classifier")
print("SUCCESS: GPT60 relationship-based People guard passed.")
