#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARDS = [
    "attachment_previous_pass_preservation_guard.py",
    "unified_all_mail_previous_pass_preservation_guard.py",
    "ai_real_use_previous_pass_preservation_guard.py",
    "provider_accepted_not_delivered_guard.py",
]


def main() -> None:
    print("LAST_THREE_PASS_REGRESSION_GUARD")
    for guard in GUARDS:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/guards" / guard)],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        print(result.stdout, end="")
        if result.returncode != 0:
            print(result.stderr, end="")
            raise SystemExit(f"FAIL: {guard}")
    print("SUCCESS: Last three PASS regression guard passed.")


if __name__ == "__main__":
    main()
