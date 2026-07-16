#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
models = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
state = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
view = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"

def require(path: Path, needles: list[str], label: str) -> None:
    text = path.read_text()
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise SystemExit(f"FAIL: {label}: missing {', '.join(missing)}")
    print(f"PASS: {label}")

require(models, ["NexoraGoalRecord", "NexoraMemoryRecord", "NexoraOutcomeRecord", "NexoraCollaborationRun", "NexoraOrganizationGraph"], "persistent V3 foundation records")
require(state, ["nexoraGoals", "nexoraMemory", "nexoraOutcomes", "nexoraCollaborations", "refreshOrganizationGraph", "runCollaborativeWorkflow", "persistWorkOS"], "AppState persistence and bounded collaboration")
require(view, ["Outcomes", "Collaboration", "Organization foundation", "Run bounded collaboration"], "Mission Center outcome and collaboration surfaces")
print("SUCCESS: GPT64 autonomous Work OS and V3 foundation guard passed.")
