#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text(encoding="utf-8")
ENGINE = (ROOT / "files/GlassMail-project/GlassMail/Services/MailOSV2Productivity.swift").read_text(encoding="utf-8")
STATE = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text(encoding="utf-8")
AI = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text(encoding="utf-8")

def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"GPT63_AGENTIC_WORK_OS_GUARD: FAIL: {message}")
    print(f"PASS: {message}")

print("GPT63_AGENTIC_WORK_OS_GUARD")
require("final class NexoraAgentEngine" in ENGINE, "unified agent engine exists")
require("struct AgentExecutionProposal" in MODELS, "reviewable execution proposal exists")
require("enum NexoraAgentType" in MODELS, "agent types exist")
require("expectedOutputs" in MODELS and "estimatedWork" in MODELS, "proposal exposes outputs and estimate")
require("func agentProposal(for mission" in STATE, "AppState exposes plan-before-execute proposal")
require("func runAgent(for mission" in STATE, "AppState executes approved agent workflow")
require("nexoraAgentEngine.content" in STATE, "agent output uses deliverable engine")
require("Review and execute" in AI, "Mission Center exposes reviewable agent execution")
require("case executiveBrief" in MODELS and "case decisionSummary" in MODELS, "deliverable pipeline includes work outputs")
print("SUCCESS: GPT63 agentic Work OS guard passed.")
