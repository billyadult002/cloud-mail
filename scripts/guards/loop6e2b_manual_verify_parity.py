#!/usr/bin/env python3
"""Loop 6E-2B manual-login vs verify-attach parity diagnostic.

Prompts keep credentials in memory only. Reports contain masked emails, hashes,
domains, booleans, and response codes, never passwords, tokens, cookies, or
authorization headers.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
BASE_URL = os.environ.get("CLOUDMAIL_AUTH_BASE_URL") or os.environ.get("BASE_URL") or "https://cloud-mail.fastonegroup.workers.dev"


def prompt(title: str, message: str, *, hidden: bool = False) -> str:
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{message}" default answer "" '
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


def domain(value: str) -> str:
    normalized = normalize_email(value)
    return normalized.rsplit("@", 1)[1] if "@" in normalized else ""


def masked(value: str) -> str:
    normalized = normalize_email(value)
    if "@" not in normalized:
        return "invalid"
    local, dom = normalized.split("@", 1)
    if not local:
        return f"***@{dom}"
    return f"{local[0]}***@{dom}"


def digest(value: str) -> str:
    return hashlib.sha256(normalize_email(value).encode("utf-8")).hexdigest()[:16]


def ascii_safe(value: str) -> bool:
    try:
        normalize_email(value).encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def request_json(method: str, path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    url = BASE_URL.rstrip("/") + path
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "CloudMailLoop6E2B/1.0",
    }
    if token:
        headers["authorization"] = token
    data = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
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
        "message_class": "present" if isinstance(parsed, dict) and parsed.get("message") else "absent",
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


def run_verify(env: dict, redactions: list[str], output: Path) -> int:
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
    try:
        manual_email = prompt("CloudMail 6E-2B", "Email address that manually logged in successfully", hidden=False)
        freshness = prompt(
            "CloudMail 6E-2B",
            "Type YES if the target password was reset/rotated or freshly confirmed after chat exposure",
            hidden=False,
        ).strip()
    except KeyboardInterrupt:
        print("classification=BLOCKED_MANUAL_SUCCESS_TARGET_CREDENTIAL_REQUIRED")
        return 42

    manual_norm = normalize_email(manual_email)
    if freshness != "YES":
        report = {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "manual_email_masked": masked(manual_email),
            "manual_email_hash": digest(manual_email),
            "manual_normalized_domain": domain(manual_email),
            "credential_freshness_confirmed": False,
            "classification": "BLOCKED_MANUAL_SUCCESS_TARGET_CREDENTIAL_REQUIRED",
        }
        (ARTIFACTS / "loop6e2b-parity-diagnostic.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print("credential_freshness_confirmed=False")
        print("classification=BLOCKED_MANUAL_SUCCESS_TARGET_CREDENTIAL_REQUIRED")
        return 43

    try:
        primary_email = prompt("CloudMail 6E-2B", "Primary CloudMail email", hidden=False)
        primary_password = prompt("CloudMail 6E-2B", "Primary CloudMail password", hidden=True)
        target_email = prompt("CloudMail 6E-2B", "Verify attach target same-domain email", hidden=False)
        target_password = prompt("CloudMail 6E-2B", "Verify attach target same-domain password", hidden=True)
        gmail_email = prompt("CloudMail 6E-2B", "Gmail email for strict verify gate", hidden=False)
        gmail_password = prompt("CloudMail 6E-2B", "Gmail App Password for strict verify gate", hidden=True)
    except KeyboardInterrupt:
        print("classification=BLOCKED_SECURE_PROMPT_CANCELLED")
        return 42

    primary = request_json("POST", "/api/login", body={"email": primary_email, "password": primary_password})
    primary_token = primary.get("data", {}).get("token")
    target = request_json("POST", "/api/login", body={"email": target_email, "password": target_password})
    target_token = target.get("data", {}).get("token")
    target_session_probe = {"http_status": None, "body_code": None}
    if target_token:
        target_session_probe = request_json("GET", "/api/v2/ai/providers", token=target_token)
    authorization = {"http_status": None, "body_code": None, "data": {}}
    accounts_after = {"http_status": None, "body_code": None, "delegated_present": False}
    readability = {"http_status": None, "body_code": None, "account_email_present": False}
    if primary_token:
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

    manual_target_parity = manual_norm == normalize_email(target_email)
    diagnostic = {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "credentials_written": False,
        "auth_base_url": BASE_URL.rstrip("/"),
        "credential_freshness_confirmed": True,
        "manual_email": {
            "masked": masked(manual_email),
            "hash": digest(manual_email),
            "normalized_hash": digest(manual_norm),
            "domain": domain(manual_email),
            "ascii_safe": ascii_safe(manual_email),
            "leading_or_trailing_space_changed": manual_email != manual_email.strip(),
        },
        "verify_target_email": {
            "masked": masked(target_email),
            "hash": digest(target_email),
            "normalized_hash": digest(normalize_email(target_email)),
            "domain": domain(target_email),
            "ascii_safe": ascii_safe(target_email),
            "leading_or_trailing_space_changed": target_email != target_email.strip(),
        },
        "manual_target_parity": manual_target_parity,
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
            "http_status": target_session_probe.get("http_status"),
            "body_code": target_session_probe.get("body_code"),
            "session_present": bool(target_token) and target_session_probe.get("body_code") == 200,
        },
        "same_domain": domain(primary_email) == domain(target_email) and bool(domain(primary_email)),
        "different_mailbox": normalize_email(primary_email) != normalize_email(target_email),
        "authorization": {
            "http_status": authorization.get("http_status"),
            "body_code": authorization.get("body_code"),
            "current_user_changed": authorization.get("data", {}).get("currentUserChanged"),
            "owner_account_id_present": bool(authorization.get("data", {}).get("ownerAccountId")),
        },
        "accounts_after_authorization": accounts_after,
        "readability": readability,
    }

    if not manual_target_parity:
        classification = "BLOCKED_MANUAL_VERIFY_IDENTITY_MISMATCH"
    elif not target_token:
        classification = "BLOCKED_TARGET_OWNER_AUTH_FAILED"
    elif authorization.get("body_code") != 200:
        classification = "FAIL_DELEGATED_OWNER_PASSWORD_AUTH_PATH"
    elif not accounts_after.get("delegated_present"):
        classification = "FAIL_DELEGATED_VISIBILITY"
    elif not readability.get("account_email_present"):
        classification = "FAIL_DELEGATED_READABILITY"
    else:
        classification = "PARITY_AND_AUTHORIZATION_PASS"
    diagnostic["classification"] = classification
    diagnostic_path = ARTIFACTS / "loop6e2b-parity-diagnostic.json"
    diagnostic_path.write_text(json.dumps(diagnostic, indent=2) + "\n", encoding="utf-8")

    verify_status = 99
    if classification == "PARITY_AND_AUTHORIZATION_PASS":
        env = os.environ.copy()
        env.update(
            {
                "BASE_URL": BASE_URL.rstrip("/"),
                "CLOUDMAIL_AUTH_BASE_URL": BASE_URL.rstrip("/"),
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
            ARTIFACTS / "loop6e2b-verify-rerun.log",
        )
    else:
        (ARTIFACTS / "loop6e2b-verify-rerun.log").write_text(
            f"verify_not_run_classification={classification}\n",
            encoding="utf-8",
        )

    exact_hits = exact_scan(
        [primary_password, target_password, gmail_password],
        [
            diagnostic_path,
            ARTIFACTS / "loop6e2b-verify-rerun.log",
            ARTIFACTS / "codex-p0c-device-real-product-certification.log",
            ARTIFACTS / "codex-p0c-device-real-product-certification-summary.json",
        ],
        ARTIFACTS / "loop6e2b-exact-secret-scan.txt",
    )
    print(f"manual_target_parity={manual_target_parity}")
    print(f"target_owner_token_present={bool(target_token)}")
    print(f"authorization_code={authorization.get('body_code')}")
    print(f"classification={classification}")
    print(f"verify_exit={verify_status}")
    print(f"exact_value_leak_hits={exact_hits}")
    if exact_hits:
        return 45
    return 0 if verify_status == 0 and classification == "PARITY_AND_AUTHORIZATION_PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
