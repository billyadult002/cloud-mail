#!/usr/bin/env python3
"""CloudMail physical-device endurance harness foundation.

Default mode is dry-run framework validation. Use --execute to perform a real
timed run; this script never invents 30/60/120 minute observations.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "endurance"
XCODE_BETA = "/Applications/Xcode-beta.app/Contents/Developer"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(cmd: list[str], *, env: dict[str, str]) -> dict:
    result = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, check=False)
    return {
        "cmd": cmd,
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def write_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="perform a real timed endurance run")
    parser.add_argument("--duration-minutes", type=int, default=120)
    parser.add_argument("--sample-seconds", type=int, default=60)
    parser.add_argument("--bundle-id", default="com.fastonegroup.glassmail")
    args = parser.parse_args()

    env = dict(os.environ)
    env["DEVELOPER_DIR"] = XCODE_BETA
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = ARTIFACTS / stamp
    jsonl = out_dir / "cloudmail-endurance.jsonl"
    summary = out_dir / "cloudmail-endurance-summary.md"

    xcode = run(["xcodebuild", "-version"], env=env)
    selected = run(["xcode-select", "-p"], env=env)
    devices = run(["xcrun", "devicectl", "list", "devices"], env=env)

    write_jsonl(jsonl, {
        "timestamp": now_iso(),
        "type": "preflight",
        "execute": args.execute,
        "durationMinutes": args.duration_minutes,
        "sampleSeconds": args.sample_seconds,
        "xcode": xcode,
        "xcodeSelect": selected,
        "devices": devices,
    })

    if not args.execute:
        summary.write_text(
            "# CloudMail Endurance Harness Dry Run\n\n"
            "No 30m/60m/120m endurance measurements were executed.\n\n"
            f"- Timestamp: {now_iso()}\n"
            f"- Xcode select: {selected.get('stdout')}\n"
            f"- Output JSONL: {jsonl}\n",
            encoding="utf-8",
        )
        print(f"CLOUDMAIL_ENDURANCE_HARNESS: DRY_RUN {summary}")
        return 0

    deadline = time.time() + max(args.duration_minutes, 1) * 60
    checkpoints = {0, 30, 60, 120}
    started = time.time()
    sample = 0
    while time.time() < deadline:
        elapsed_minutes = int((time.time() - started) // 60)
        sample += 1
        process_snapshot = run(["xcrun", "devicectl", "device", "info", "processes"], env=env)
        write_jsonl(jsonl, {
            "timestamp": now_iso(),
            "type": "sample",
            "sample": sample,
            "elapsedMinutes": elapsed_minutes,
            "checkpoint": elapsed_minutes in checkpoints,
            "bundleId": args.bundle_id,
            "processSnapshot": process_snapshot,
            "thermal": "not_available_from_harness_yet",
            "battery": "not_available_from_harness_yet",
            "freshness": "requires_backend_diagnostic_endpoint",
        })
        time.sleep(max(args.sample_seconds, 5))

    summary.write_text(
        "# CloudMail Endurance Harness Run\n\n"
        "A timed run was executed. Interpret thermal, battery, and freshness fields only where the underlying device/API returned data.\n\n"
        f"- Duration requested: {args.duration_minutes} minutes\n"
        f"- Samples: {sample}\n"
        f"- JSONL: {jsonl}\n",
        encoding="utf-8",
    )
    print(f"CLOUDMAIL_ENDURANCE_HARNESS: COMPLETE {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
