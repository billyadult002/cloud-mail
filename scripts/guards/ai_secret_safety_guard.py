#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
paths = []
paths.extend(ROOT.glob("AI*.md"))
paths.extend(ROOT.glob("GEMINI*.md"))
paths.extend(ROOT.glob("CHATGPT*.md"))
paths.extend(ROOT.glob("GROK*.md"))
paths.extend(ROOT.glob("CLAUDE*.md"))
paths.extend(ROOT.glob("COPILOT*.md"))
paths.extend([
    ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
    ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift",
    ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift",
])

patterns = [
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"ya29\\.[A-Za-z0-9_-]+"),
    re.compile(r"access_token\\s*[:=]", re.I),
    re.compile(r"refresh_token\\s*[:=]", re.I),
    re.compile(r"client_secret\\s*[:=]", re.I),
    re.compile(r"authorization_code\\s*[:=]", re.I),
    re.compile(r"session_token\\s*[:=]", re.I),
    re.compile(r"cookie\\s*[:=]", re.I),
]

print("AI_SECRET_SAFETY_GUARD")
for path in sorted(set(paths)):
    if not path.exists():
        continue
    text = path.read_text(errors="ignore")
    for pattern in patterns:
        if pattern.search(text):
            print(f"FAIL: possible secret exposure in {path.relative_to(ROOT)}")
            sys.exit(1)
print("PASS: no token/secret value patterns found in checked AI files")
print("SUCCESS: AI secret safety guard passed.")
