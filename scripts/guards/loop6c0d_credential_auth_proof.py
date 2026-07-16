#!/usr/bin/env python3
"""Loop 6C-0D credential-only CloudMail auth proof.

This runner intentionally does not build, install, bridge to, or test a device.
It proves only whether the supplied CloudMail credential authenticates against
production auth, and records redacted status artifacts.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = "https://cloud-mail.fastonegroup.workers.dev"


def prompt_secret(title: str, prompt: str, *, hidden: bool) -> str:
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{prompt}" default answer "" '
            f'{"with hidden answer " if hidden else ""}'
            f'buttons {{"Cancel", "Continue"}} default button "Continue" '
            f'with title "{title}"'
        ),
        "-e",
        "text returned of result",
    ]
    result = subprocess.run(script, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise KeyboardInterrupt("credential prompt cancelled")
    return result.stdout.rstrip("\n")


def redact_email(value: str) -> str:
    if "@" not in value:
        return "redacted"
    local, domain = value.split("@", 1)
    if not local:
        return f"redacted@{domain}"
    return f"{local[0]}***@{domain}"


def parse_curl_json(stdout: str) -> tuple[int | None, object | None]:
    body, _, http_status = stdout.rpartition("\n")
    if not http_status.isdigit():
        return None, None
    try:
        decoded: object | None = json.loads(body)
    except json.JSONDecodeError:
        decoded = None
    return int(http_status), decoded


def curl_json_post_stdin(url: str, payload: str) -> tuple[int | None, object | None]:
    completed = subprocess.run(
        [
            "curl", "-sS", "-m", "25", "-X", "POST", url,
            "-H", "content-type: application/json",
            "--data-binary", "@-",
            "-w", "\n%{http_code}",
        ],
        input=payload,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None, None
    return parse_curl_json(completed.stdout)


def curl_json_with_stdin_config(config: str) -> tuple[int | None, object | None]:
    completed = subprocess.run(
        ["curl", "-sS", "-m", "25", "-K", "-"],
        input=config,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        return None, None
    return parse_curl_json(completed.stdout)


def auth_preflight(email: str, password: str) -> dict[str, object]:
    payload = json.dumps({"email": email, "password": password})
    http_status, decoded = curl_json_post_stdin(f"{BASE_URL}/api/login", payload)
    result: dict[str, object] = {
        "auth_preflight": "rejected",
        "account_email": redact_email(email),
        "http_status": http_status,
        "body_code": None,
        "token_present": False,
        "session_probe_present": False,
        "reason_class": "unknown",
    }
    token = None
    if isinstance(decoded, dict):
        result["body_code"] = decoded.get("code")
        token = decoded.get("token")
        data = decoded.get("data")
        if not token and isinstance(data, dict):
            token = data.get("token")
        result["token_present"] = bool(token)

    if http_status is None:
        result["reason_class"] = "network"
    elif http_status == 200 and token:
        result["auth_preflight"] = "accepted"
        result["reason_class"] = "accepted"
        result["session_probe_present"] = session_probe(str(token))
    elif http_status in {200, 400, 401, 403}:
        result["reason_class"] = "invalid credential"
    elif http_status in {500, 502, 503, 504}:
        result["reason_class"] = "backend"

    if result["auth_preflight"] == "accepted" and not result["session_probe_present"]:
        result["auth_preflight"] = "rejected"
        result["reason_class"] = "session_probe_failed"
    return result


def session_probe(token: str) -> bool:
    config = "\n".join([
        f'url = "{BASE_URL}/api/my/loginUserInfo"',
        'request = "GET"',
        f'header = "authorization: {token}"',
        'write-out = "\\n%{http_code}"',
    ])
    http_status, decoded = curl_json_with_stdin_config(config)
    if http_status != 200 or not isinstance(decoded, dict):
        return False
    return decoded.get("code") == 200 and isinstance(decoded.get("data"), dict)


def exact_leak_scan(values: list[str], paths: list[Path], output: Path) -> int:
    leaks = 0
    for value in values:
        if not value:
            continue
        for path in paths:
            if not path.exists():
                continue
            result = subprocess.run(
                ["rg", "-I", "-F", value, str(path)],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                leaks += 1
                break
    output.write_text(f"exact_value_leak_hits={leaks}\n", encoding="utf-8")
    return leaks


def main() -> int:
    ARTIFACTS.mkdir(exist_ok=True)
    try:
        email = prompt_secret("CloudMail Loop 6C-0D", "CloudMail email", hidden=False).strip()
        password = prompt_secret("CloudMail Loop 6C-0D", "CloudMail password", hidden=True)
    except KeyboardInterrupt:
        print("credential_intake=cancelled")
        return 42

    if not email or not password:
        print("credential_intake=missing")
        return 43

    print("CLOUDMAIL_DEVICE_EMAIL=present")
    print("CLOUDMAIL_DEVICE_PASSWORD=present")
    result = auth_preflight(email, password)
    (ARTIFACTS / "loop6c0d-auth-preflight.json").write_text(
        json.dumps(result, indent=2) + "\n",
        encoding="utf-8",
    )
    exact_leak_scan(
        [email, password],
        [
            ARTIFACTS / "loop6c0d-auth-preflight.json",
            ARTIFACTS / "loop6c0d-exact-secret-scan.txt",
        ],
        ARTIFACTS / "loop6c0d-exact-secret-scan.txt",
    )
    print(f"auth_preflight={result['auth_preflight']}")
    print(f"account_email={result['account_email']}")
    print(f"token_present={str(result['token_present']).lower()}")
    print(f"session_probe_present={str(result['session_probe_present']).lower()}")
    print(f"reason_class={result['reason_class']}")
    return 0 if result["auth_preflight"] == "accepted" else 46


if __name__ == "__main__":
    raise SystemExit(main())
