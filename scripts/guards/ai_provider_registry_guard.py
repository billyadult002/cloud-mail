#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([sys.executable, str(ROOT / "scripts/ai_provider_registry_foundation_guard.py")], cwd=ROOT)
sys.exit(result.returncode)
