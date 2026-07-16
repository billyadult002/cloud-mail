#!/usr/bin/env python3
"""Redacted same-domain mailbox authorization diagnostic for Loop 6E.

The script prompts through macOS dialogs, keeps credentials in process memory,
and writes only non-secret classification data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
DEFAULT_BASE_URL = "https://cloud-mail.fastonegroup.workers.dev"


def prompt(title: str, message: str, *, hidden: bool, optional: bool = False) -> str:
    buttons = '{"Skip", "Continue"}' if optional else '{"Cancel", "Continue"}'
    default = "Continue"
    hidden_flag = "with hidden answer " if hidden else ""
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{message}" default answer "" '
            f"{hidden_flag}buttons {buttons} default button \"{default}\" "
            f'with title "{title}"'
        ),
        "-e",
        "text returned of result",
    ]
    result = subprocess.run(script, capture_output=True, text=True)
    if result.returncode != 0:
        if optional:
            return ""
        raise KeyboardInterrupt("secure prompt cancelled")
    return result.stdout.rstrip("\n")


def digest(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:16]


def domain_of(email: str) -> str:
    if "@" not in email:
        return ""
    return email.rsplit("@", 1)[1].strip().lower()


def request_json(base_url: str, method: str, path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    data = None
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "CloudMailLoop6EDiagnostic/1.0",
        "x-cloudmail-verifier": "loop6e-diagnostic",
    }
    if token:
        headers["authorization"] = token
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    url = base_url.rstrip("/") + path
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    try:
        with urllib.request.urlopen(req, timeout=25, context=context) as response:
            payload = response.read()
            status = response.getcode()
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    except Exception as exc:  # noqa: BLE001 - diagnostic needs a closed classification.
        return {"http_status": 0, "body_code": None, "error_class": type(exc).__name__}
    try:
        parsed = json.loads(payload.decode("utf-8") or "{}")
    except Exception:
        parsed = {}
    body_code = parsed.get("code") if isinstance(parsed, dict) else None
    data_obj = parsed.get("data") if isinstance(parsed, dict) and isinstance(parsed.get("data"), dict) else {}
    return {"http_status": status, "body_code": body_code, "data": data_obj}


def classify(primary_login: dict, attach_login: dict, auth_result: dict) -> str:
    if primary_login.get("http_status") != 200 or not primary_login.get("data", {}).get("token"):
        return "BLOCKED_PRIMARY_CREDENTIAL_INVALID"
    if attach_login.get("http_status") == 200 and attach_login.get("data", {}).get("token"):
        if auth_result.get("http_status") == 200 and auth_result.get("body_code") == 200:
            return "PASS_VALID_CREDENTIAL_AUTHORIZED"
        return "FAIL_BACKEND_REJECTED_VALID_ATTACH_CREDENTIAL"
    if auth_result.get("http_status") == 200 and auth_result.get("body_code") == 403:
        return "BLOCKED_VALID_SAME_DOMAIN_ATTACH_CREDENTIAL_REQUIRED"
    return "BLOCKED_ATTACH_CREDENTIAL_OR_ACCOUNT_UNVERIFIED"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--output", default=str(ARTIFACTS / "loop6e-same-domain-auth-diagnostic.json"))
    args = parser.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    try:
        primary_email = prompt("CloudMail Same-Domain Diagnostic", "Primary CloudMail email", hidden=False).strip()
        primary_password = prompt("CloudMail Same-Domain Diagnostic", "Primary CloudMail password", hidden=True)
        attach_email = prompt("CloudMail Same-Domain Diagnostic", "Different-owner same-domain mailbox email", hidden=False).strip()
        attach_password = prompt("CloudMail Same-Domain Diagnostic", "Different-owner same-domain mailbox password", hidden=True)
    except KeyboardInterrupt:
        result = {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "classification": "BLOCKED_SECURE_PROMPT_CANCELLED",
            "credentials_written": False,
        }
        Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print("classification=BLOCKED_SECURE_PROMPT_CANCELLED")
        return 42

    primary_login = request_json(args.base_url, "POST", "/api/login", body={"email": primary_email, "password": primary_password})
    primary_token = primary_login.get("data", {}).get("token")
    discovery_path = "/api/auth/email-discovery?email=" + urllib.parse.quote(attach_email)
    discovery = request_json(args.base_url, "GET", discovery_path)
    attach_login = request_json(args.base_url, "POST", "/api/login", body={"email": attach_email, "password": attach_password})
    auth_result = {"http_status": None, "body_code": None}
    accounts_after = {"http_status": None, "body_code": None, "delegated_visible": False}
    delegated_read = {"http_status": None, "body_code": None, "account_email_present": False}

    if primary_token:
        auth_result = request_json(
            args.base_url,
            "POST",
            "/api/v2/mailbox-authorizations",
            token=primary_token,
            body={"email": attach_email, "password": attach_password},
        )
        owner_account_id = auth_result.get("data", {}).get("ownerAccountId")
        accounts = request_json(args.base_url, "GET", "/api/v2/accounts", token=primary_token)
        accounts_data = accounts.get("data", {})
        accounts_blob = json.dumps(accounts_data, separators=(",", ":"))
        accounts_after = {
            "http_status": accounts.get("http_status"),
            "body_code": accounts.get("body_code"),
            "delegated_visible": '"delegated":true' in accounts_blob,
        }
        if owner_account_id:
            path = f"/api/email/list?accountId={owner_account_id}&allReceive=0&size=5&type=0"
            mail = request_json(args.base_url, "GET", path, token=primary_token)
            mail_blob = json.dumps(mail.get("data", {}), separators=(",", ":"))
            delegated_read = {
                "http_status": mail.get("http_status"),
                "body_code": mail.get("body_code"),
                "account_email_present": "accountEmail" in mail_blob,
            }

    result = {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_url": args.base_url,
        "credentials_written": False,
        "primary_email_hash": digest(primary_email),
        "attach_email_hash": digest(attach_email),
        "same_domain": domain_of(primary_email) == domain_of(attach_email) and bool(domain_of(primary_email)),
        "different_mailbox": primary_email.strip().lower() != attach_email.strip().lower(),
        "discovery": {
            "http_status": discovery.get("http_status"),
            "body_code": discovery.get("body_code"),
            "account_status": discovery.get("data", {}).get("accountStatus"),
            "domain_managed": discovery.get("data", {}).get("domainManaged"),
        },
        "primary_login": {
            "http_status": primary_login.get("http_status"),
            "body_code": primary_login.get("body_code"),
            "token_present": bool(primary_token),
        },
        "attach_login": {
            "http_status": attach_login.get("http_status"),
            "body_code": attach_login.get("body_code"),
            "token_present": bool(attach_login.get("data", {}).get("token")),
        },
        "authorization": {
            "http_status": auth_result.get("http_status"),
            "body_code": auth_result.get("body_code"),
            "current_user_changed": auth_result.get("data", {}).get("currentUserChanged"),
            "owner_account_id_present": bool(auth_result.get("data", {}).get("ownerAccountId")),
        },
        "accounts_after_authorization": accounts_after,
        "delegated_read": delegated_read,
    }
    result["classification"] = classify(primary_login, attach_login, auth_result)

    output = Path(args.output)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"classification={result['classification']}")
    print(f"artifact={output}")
    return 0 if result["classification"].startswith("PASS") else 1


if __name__ == "__main__":
    raise SystemExit(main())
