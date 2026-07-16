#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST_DIR = ROOT / "artifacts/real-use-attachment-test"
FORBIDDEN = [
    "ANDREA 2026 REPORT CARD.pdf",
    "customer document",
    "customer report",
    "private pdf",
    "personal report content:",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("ATTACHMENT_SAFE_TEST_FILE_GUARD")
    files = sorted(TEST_DIR.glob("cloudmail-safe-attachment-test-*.txt"))
    require(bool(files), "safe synthetic attachment file exists in repository artifacts")
    path = files[-1]
    content = path.read_text(encoding="utf-8")
    raw_size = path.stat().st_size
    encoded_size = ((raw_size + 2) // 3) * 4
    lowered = content.lower()
    require(path.suffix == ".txt", "safe attachment uses .txt extension")
    require(raw_size > 0, "safe attachment is not empty")
    require(raw_size < 1024, "safe attachment is tiny")
    require(encoded_size == 164, "base64 size estimate is recorded and stable for this fixture")
    require("No private data." in content, "safe fixture declares no private data")
    require("No customer data." in content, "safe fixture declares no customer data")
    require("No personal report content." in content, "safe fixture declares no personal report content")
    for forbidden in FORBIDDEN:
        require(forbidden.lower() not in lowered and forbidden not in path.name, f"forbidden attachment content absent: {forbidden}")
    print(f"safe_attachment={path.relative_to(ROOT)}")
    print(f"raw_size_bytes={raw_size}")
    print(f"estimated_base64_size_bytes={encoded_size}")
    print("SUCCESS: Safe attachment test file guard passed.")


if __name__ == "__main__":
    main()
