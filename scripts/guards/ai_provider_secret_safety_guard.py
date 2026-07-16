#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
paths = [
    ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
    ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift",
    ROOT / "AI_PROVIDER_FOUNDATION_FINAL_REPORT.md",
]
paths.extend(ROOT.glob("AI_ALL_PROVIDERS_*.md"))
patterns = [
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"ya29\\.[A-Za-z0-9_-]+"),
    re.compile(r"access_token\\s*[:=]", re.I),
    re.compile(r"refresh_token\\s*[:=]", re.I),
    re.compile(r"client_secret\\s*[:=]", re.I),
    re.compile(r"authorization_code\\s*[:=]", re.I),
]

print("AI_PROVIDER_SECRET_SAFETY_GUARD")
for path in paths:
    if not path.exists():
        continue
    text = path.read_text(errors="ignore")
    for pattern in patterns:
        if pattern.search(text):
            print(f"FAIL: possible secret exposure in {path.relative_to(ROOT)}")
            sys.exit(1)
print("PASS: no token/secret value patterns found in checked AI files")
print("SUCCESS: Secret safety guard passed.")
