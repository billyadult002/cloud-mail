#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

print("RESTORED_ACCOUNT_FIX_PRESERVATION_GUARD")
for script in [
    "restored_account_send_capability_guard.py",
    "account_health_accuracy_guard.py",
    "ui_send_gating_guard.py",
    "backend_send_eligibility_guard.py",
    "provider_accepted_not_delivered_guard.py",
]:
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "guards" / script)], text=True, capture_output=True, cwd=ROOT)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        print(f"FAIL: {script}")
        sys.exit(result.returncode)
    print(f"PASS: {script}")
print("SUCCESS: restored account fix preservation guard passed.")
