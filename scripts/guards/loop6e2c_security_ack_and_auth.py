#!/usr/bin/env python3
"""Loop 6E-2C security acknowledgement and same-domain auth diagnostic.

No credential values, tokens, cookies, or authorization headers are written.
The script stops before delegated authorization if target owner login fails.
"""

from __future__ import annotations

import hashlib
import json
import os
import ssl
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = (os.environ.get("CLOUDMAIL_AUTH_BASE_URL") or os.environ.get("BASE_URL") or "https://cloud-mail.fastonegroup.workers.dev").rstrip("/")
ACK_TEXT = "YES, I confirm this target mailbox credential is current and I accept the risk of not rotating it."


def prompt(title: str, message: str, *, hidden: bool = False, default_answer: str = "") -> str:
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{message}" default answer "{default_answer}" '
            f'{"with hidden answer " if hidden else ""}'
            f'buttons {{"Cancel", "Continue"}} default button "Continue" '
            f'with title "{title}"'
        ),
        "-e",
        "text returned of result",
    ]
    result = subprocess.run(script, capture_output=True, text=True)
    if result.returncode != 0:
        raise KeyboardInterrupt
    return result.stdout.rstrip("\n")


def normalize_email(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").strip().lower()


def digest(value: str) -> str:
    return hashlib.sha256(normalize_email(value).encode("utf-8")).hexdigest()[:16]


def masked(value: str) -> str:
    normalized = normalize_email(value)
    if "@" not in normalized:
        return "invalid"
    local, domain = normalized.split("@", 1)
    return f"{local[:1] or '*'}***@{domain}"


def request_json(method: str, path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "CloudMailLoop6E2C/1.0",
    }
    if token:
        headers["authorization"] = token
    request = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    try:
        with urllib.request.urlopen(request, timeout=25, context=context) as response:
            payload = response.read()
            status = response.getcode()
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    except Exception as exc:  # noqa: BLE001
        return {"http_status": 0, "body_code": None, "error_class": type(exc).__name__, "data": {}}
    try:
        parsed = json.loads(payload.decode("utf-8") or "{}")
    except Exception:
        parsed = {}
    return {
        "http_status": status,
        "body_code": parsed.get("code") if isinstance(parsed, dict) else None,
        "data": parsed.get("data") if isinstance(parsed, dict) and isinstance(parsed.get("data"), dict) else {},
    }


def exact_scan(values: list[str], paths: list[Path], output: Path) -> int:
    hits = 0
    with output.open("w", encoding="utf-8") as handle:
        for value in values:
            if not value:
                continue
            for path in paths:
                if not path.exists():
                    continue
                result = subprocess.run(["rg", "-I", "-F", value, str(path)], capture_output=True, text=True)
                if result.returncode == 0:
                    hits += 1
                    handle.write(f"exact_value_leak_hit path={path}\n")
                    break
        handle.write(f"exact_value_leak_hits={hits}\n")
    return hits


def run_verify(env: dict[str, str], redactions: list[str], output: Path) -> int:
    proc = subprocess.Popen(
        ["./verify.sh"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    with output.open("w", encoding="utf-8") as handle:
        for line in proc.stdout:
            safe = line
            for value in redactions:
                if value:
                    safe = safe.replace(value, "[REDACTED]")
            handle.write(safe)
            handle.flush()
            sys.stdout.write(safe)
    return proc.wait()


def main() -> int:
    ARTIFACTS.mkdir(exist_ok=True)
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        ack = prompt(
            "CloudMail 6E-2C",
            f"Confirm this exact acknowledgement text, then click Continue:\n{ACK_TEXT}",
            hidden=False,
            default_answer=ACK_TEXT,
        ).strip()
    except KeyboardInterrupt:
        report = {
            "created_at": created_at,
            "acknowledgement_provided": False,
            "classification": "BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED",
        }
        (ARTIFACTS / "loop6e2c-security-ack-auth.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("classification=BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED")
        return 42
    if ack != ACK_TEXT:
        report = {
            "created_at": created_at,
            "acknowledgement_provided": False,
            "classification": "BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED",
        }
        (ARTIFACTS / "loop6e2c-security-ack-auth.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("acknowledgement_provided=False")
        print("classification=BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED")
        return 43

    try:
        primary_email = prompt("CloudMail 6E-2C", "Primary CloudMail email", hidden=False).strip()
        primary_password = prompt("CloudMail 6E-2C", "Primary CloudMail password", hidden=True)
        target_email = prompt("CloudMail 6E-2C", "Target same-domain mailbox email", hidden=False).strip()
        target_password = prompt("CloudMail 6E-2C", "Target same-domain mailbox password", hidden=True)
        gmail_email = prompt("CloudMail 6E-2C", "Gmail email for strict verify gate", hidden=False).strip()
        gmail_password = prompt("CloudMail 6E-2C", "Gmail App Password for strict verify gate", hidden=True)
    except KeyboardInterrupt:
        print("classification=BLOCKED_SECURE_PROMPT_CANCELLED")
        return 42

    primary = request_json("POST", "/api/login", body={"email": primary_email, "password": primary_password})
    primary_token = primary.get("data", {}).get("token")
    target = request_json("POST", "/api/login", body={"email": target_email, "password": target_password})
    target_token = target.get("data", {}).get("token")
    target_session = {"http_status": None, "body_code": None}
    if target_token:
        target_session = request_json("GET", "/api/v2/ai/providers", token=target_token)

    authorization = {"http_status": None, "body_code": None, "data": {}}
    accounts_after = {"http_status": None, "body_code": None, "delegated_present": False}
    readability = {"http_status": None, "body_code": None, "account_email_present": False}
    if primary_token and target_token:
        authorization = request_json(
            "POST",
            "/api/v2/mailbox-authorizations",
            token=primary_token,
            body={"email": target_email, "password": target_password},
        )
        accounts_result = request_json("GET", "/api/v2/accounts", token=primary_token)
        accounts_after = {
            "http_status": accounts_result.get("http_status"),
            "body_code": accounts_result.get("body_code"),
            "delegated_present": '"delegated":true' in json.dumps(accounts_result.get("data", {}), separators=(",", ":")),
        }
        owner_account_id = authorization.get("data", {}).get("ownerAccountId")
        if owner_account_id:
            read_result = request_json(
                "GET",
                f"/api/email/list?accountId={owner_account_id}&allReceive=0&size=5&type=0",
                token=primary_token,
            )
            readability = {
                "http_status": read_result.get("http_status"),
                "body_code": read_result.get("body_code"),
                "account_email_present": '"accountEmail"' in json.dumps(read_result.get("data", {}), separators=(",", ":")),
            }

    if not target_token:
        classification = "BLOCKED_VALID_SAME_DOMAIN_ATTACH_CREDENTIAL_REQUIRED"
    elif authorization.get("body_code") != 200:
        classification = "FAIL_SAME_DOMAIN_AUTHORIZATION"
    elif not accounts_after.get("delegated_present"):
        classification = "FAIL_DELEGATED_VISIBILITY"
    elif not readability.get("account_email_present"):
        classification = "FAIL_DELEGATED_READABILITY"
    else:
        classification = "AUTHORIZATION_PREFLIGHT_PASS"

    report = {
        "created_at": created_at,
        "credentials_written": False,
        "acknowledgement_provided": True,
        "acknowledgement_text_recorded": False,
        "auth_base_url": BASE_URL,
        "primary_email": {"masked": masked(primary_email), "hash": digest(primary_email)},
        "target_email": {"masked": masked(target_email), "hash": digest(target_email)},
        "same_domain": normalize_email(primary_email).split("@")[-1] == normalize_email(target_email).split("@")[-1],
        "different_mailbox": normalize_email(primary_email) != normalize_email(target_email),
        "primary_login": {
            "http_status": primary.get("http_status"),
            "body_code": primary.get("body_code"),
            "token_present": bool(primary_token),
        },
        "target_owner_login": {
            "http_status": target.get("http_status"),
            "body_code": target.get("body_code"),
            "token_present": bool(target_token),
        },
        "target_session_probe": {
            "http_status": target_session.get("http_status"),
            "body_code": target_session.get("body_code"),
            "session_present": bool(target_token) and target_session.get("body_code") == 200,
        },
        "authorization": {
            "http_status": authorization.get("http_status"),
            "body_code": authorization.get("body_code"),
            "current_user_changed": authorization.get("data", {}).get("currentUserChanged"),
            "owner_account_id_present": bool(authorization.get("data", {}).get("ownerAccountId")),
        },
        "accounts_after_authorization": accounts_after,
        "readability": readability,
        "classification": classification,
    }
    diagnostic_path = ARTIFACTS / "loop6e2c-security-ack-auth.json"
    diagnostic_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    verify_status = 99
    if classification == "AUTHORIZATION_PREFLIGHT_PASS":
        env = os.environ.copy()
        env.update(
            {
                "BASE_URL": BASE_URL,
                "CLOUDMAIL_AUTH_BASE_URL": BASE_URL,
                "DEVICE_XCRESULT": "artifacts/codex-p0c-device-real-product-certification.xcresult",
                "CLOUDMAIL_DEVICE_EMAIL": primary_email,
                "CLOUDMAIL_DEVICE_PASSWORD": primary_password,
                "CLOUDMAIL_ATTACH_EMAIL": target_email,
                "CLOUDMAIL_ATTACH_PASSWORD": target_password,
                "CLOUDMAIL_GMAIL_EMAIL": gmail_email,
                "CLOUDMAIL_GMAIL_APP_PASSWORD": gmail_password,
            }
        )
        verify_status = run_verify(
            env,
            [primary_email, primary_password, target_email, target_password, gmail_email, gmail_password],
            ARTIFACTS / "loop6e2c-verify-rerun.log",
        )
    else:
        (ARTIFACTS / "loop6e2c-verify-rerun.log").write_text(
            f"verify_not_run_classification={classification}\n",
            encoding="utf-8",
        )

    exact_hits = exact_scan(
        [primary_password, target_password, gmail_password],
        [
            diagnostic_path,
            ARTIFACTS / "loop6e2c-verify-rerun.log",
            ARTIFACTS / "codex-p0c-device-real-product-certification.log",
            ARTIFACTS / "codex-p0c-device-real-product-certification-summary.json",
        ],
        ARTIFACTS / "loop6e2c-exact-secret-scan.txt",
    )
    print(f"acknowledgement_provided=True")
    print(f"target_owner_token_present={bool(target_token)}")
    print(f"target_owner_body_code={target.get('body_code')}")
    print(f"authorization_body_code={authorization.get('body_code')}")
    print(f"classification={classification}")
    print(f"verify_exit={verify_status}")
    print(f"exact_value_leak_hits={exact_hits}")
    if exact_hits:
        return 45
    if classification == "AUTHORIZATION_PREFLIGHT_PASS" and verify_status == 0:
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
