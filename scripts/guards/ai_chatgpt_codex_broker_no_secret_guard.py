#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
paths = list(ROOT.glob("AI_CHATGPT_CODEX*.md")) + [
    ROOT / "scripts/ai_chatgpt_codex_broker_research_guard.py",
    ROOT / "scripts/ai_chatgpt_codex_broker_no_secret_guard.py",
    ROOT / "scripts/ai_chatgpt_broker_smoke_guard.py",
]

secret_value_patterns = [
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"ya29\\.[A-Za-z0-9_-]+"),
    re.compile(r"eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}"),
    re.compile(r"codex-(?:access|session|refresh)-[A-Za-z0-9_-]{16,}", re.I),
    re.compile(r"Bearer\\s+[A-Za-z0-9._-]{16,}", re.I),
    re.compile(r"OPENAI_API_KEY\\s*=\\s*['\\\"]?[^\\s'\\\"]+", re.I),
    re.compile(r"CODEX_ACCESS_TOKEN\\s*=\\s*['\\\"]?[^\\s'\\\"]+", re.I),
]

print("AI_CHATGPT_CODEX_BROKER_NO_SECRET_GUARD")
for path in sorted(set(paths)):
    if not path.exists():
        continue
    text = path.read_text(errors="ignore")
    for pattern in secret_value_patterns:
        if pattern.search(text):
            print(f"FAIL: possible secret value in {path.relative_to(ROOT)}")
            sys.exit(1)

print("PASS: no token-shaped secret values found in ChatGPT Codex broker reports/guards")
print("SUCCESS: ChatGPT Codex broker no-secret guard passed.")
