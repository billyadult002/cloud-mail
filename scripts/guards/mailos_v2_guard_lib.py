#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SWIFT = ROOT / "files" / "GlassMail-project" / "GlassMail"


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise AssertionError(f"missing file: {rel}")
    return path.read_text(encoding="utf-8")


def require(rel: str, needles: list[str]) -> None:
    text = read(rel)
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise AssertionError(f"{rel} missing: {', '.join(missing)}")


def pass_guard(name: str) -> None:
    print(f"{name}: PASS")


def main(name: str, checks: dict[str, list[str]]) -> None:
    try:
        for rel, needles in checks.items():
            require(rel, needles)
        pass_guard(name)
    except AssertionError as exc:
        print(f"{name}: FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
