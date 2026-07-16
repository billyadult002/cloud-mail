#!/usr/bin/env python3
"""Run strict verify.sh for Loop 6E with secure prompts and redacted logs."""

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
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
DEFAULT_BASE_URL = "https://cloud-mail.fastonegroup.workers.dev"
DEFAULT_XCRESULT = "artifacts/codex-p0c-device-real-product-certification.xcresult"


def prompt(title: str, message: str, *, hidden: bool, optional: bool = False) -> str:
    buttons = '{"Skip", "Continue"}' if optional else '{"Cancel", "Continue"}'
    hidden_flag = "with hidden answer " if hidden else ""
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{message}" default answer "" '
            f'{hidden_flag}buttons {buttons} default button "Continue" '
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


def run_verify(env: dict[str, str], redactions: list[str], log_path: Path) -> int:
    proc = subprocess.Popen(
        ["./verify.sh"],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    with log_path.open("w", encoding="utf-8") as handle:
        assert proc.stdout is not None
        for line in proc.stdout:
            safe = line
            for value in redactions:
                if value:
                    safe = safe.replace(value, "[REDACTED]")
            handle.write(safe)
            handle.flush()
            sys.stdout.write(safe)
    return proc.wait()


def digest(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:16]


def request_json(base_url: str, method: str, path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "CloudMailLoop6EVerifyPreflight/1.0",
        "x-cloudmail-verifier": "loop6e-verify-preflight",
    }
    if token:
        headers["authorization"] = token
    data = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base_url.rstrip("/") + path, data=data, headers=headers, method=method)
    context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    try:
        with urllib.request.urlopen(req, timeout=25, context=context) as response:
            payload = response.read()
            status = response.getcode()
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    except Exception as exc:  # noqa: BLE001 - preflight needs closed classification.
        return {"http_status": 0, "body_code": None, "error_class": type(exc).__name__}
    try:
        parsed = json.loads(payload.decode("utf-8") or "{}")
    except Exception:
        parsed = {}
    data_obj = parsed.get("data") if isinstance(parsed, dict) and isinstance(parsed.get("data"), dict) else {}
    return {
        "http_status": status,
        "body_code": parsed.get("code") if isinstance(parsed, dict) else None,
        "data": data_obj,
    }


def same_process_preflight(base_url: str, primary_email: str, primary_password: str, attach_email: str, attach_password: str) -> dict:
    primary = request_json(base_url, "POST", "/api/login", body={"email": primary_email, "password": primary_password})
    token = primary.get("data", {}).get("token")
    attach = request_json(base_url, "POST", "/api/login", body={"email": attach_email, "password": attach_password})
    auth = {"http_status": None, "body_code": None, "data": {}}
    accounts = {"http_status": None, "body_code": None, "delegated_text_present": False}
    if token:
        auth = request_json(
            base_url,
            "POST",
            "/api/v2/mailbox-authorizations",
            token=token,
            body={"email": attach_email, "password": attach_password},
        )
        accounts_result = request_json(base_url, "GET", "/api/v2/accounts", token=token)
        accounts = {
            "http_status": accounts_result.get("http_status"),
            "body_code": accounts_result.get("body_code"),
            "delegated_text_present": '"delegated":true' in json.dumps(accounts_result.get("data", {}), separators=(",", ":")),
        }
    return {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "credentials_written": False,
        "primary_email_hash": digest(primary_email),
        "attach_email_hash": digest(attach_email),
        "primary_login": {
            "http_status": primary.get("http_status"),
            "body_code": primary.get("body_code"),
            "token_present": bool(token),
        },
        "attach_login": {
            "http_status": attach.get("http_status"),
            "body_code": attach.get("body_code"),
            "token_present": bool(attach.get("data", {}).get("token")),
        },
        "authorization": {
            "http_status": auth.get("http_status"),
            "body_code": auth.get("body_code"),
            "current_user_changed": auth.get("data", {}).get("currentUserChanged"),
            "owner_account_id_present": bool(auth.get("data", {}).get("ownerAccountId")),
        },
        "accounts_after_authorization": accounts,
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--xcresult", default=DEFAULT_XCRESULT)
    parser.add_argument("--log", default=str(ARTIFACTS / "loop6e-secure-verify-rerun.log"))
    args = parser.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    try:
        primary_email = prompt("CloudMail Verify", "Primary CloudMail email", hidden=False).strip()
        primary_password = prompt("CloudMail Verify", "Primary CloudMail password", hidden=True)
        attach_email = prompt("CloudMail Verify", "Different-owner same-domain mailbox email", hidden=False).strip()
        attach_password = prompt("CloudMail Verify", "Different-owner same-domain mailbox password", hidden=True)
        gmail_email = prompt("CloudMail Verify", "Gmail email for strict verify gate", hidden=False).strip()
        gmail_password = prompt("CloudMail Verify", "Gmail App Password for strict verify gate", hidden=True)
    except KeyboardInterrupt:
        print("classification=BLOCKED_SECURE_PROMPT_CANCELLED")
        return 42

    env = os.environ.copy()
    env.update(
        {
            "BASE_URL": args.base_url,
            "CLOUDMAIL_AUTH_BASE_URL": args.base_url,
            "DEVICE_XCRESULT": args.xcresult,
            "CLOUDMAIL_DEVICE_EMAIL": primary_email,
            "CLOUDMAIL_DEVICE_PASSWORD": primary_password,
            "CLOUDMAIL_ATTACH_EMAIL": attach_email,
            "CLOUDMAIL_ATTACH_PASSWORD": attach_password,
            "CLOUDMAIL_GMAIL_EMAIL": gmail_email,
            "CLOUDMAIL_GMAIL_APP_PASSWORD": gmail_password,
        }
    )
    redactions = [primary_email, primary_password, attach_email, attach_password, gmail_email, gmail_password]
    preflight = same_process_preflight(args.base_url, primary_email, primary_password, attach_email, attach_password)
    preflight_path = ARTIFACTS / "loop6e-secure-verify-preflight.json"
    preflight_path.write_text(json.dumps(preflight, indent=2) + "\n", encoding="utf-8")
    print(f"preflight_authorization_code={preflight['authorization']['body_code']}")
    print(f"preflight_attach_login={preflight['attach_login']['token_present']}")
    log_path = Path(args.log)
    status = run_verify(env, redactions, log_path)
    scan_paths = [
        log_path,
        ARTIFACTS / "loop6e-same-domain-auth-diagnostic.json",
        Path(args.xcresult),
    ]
    hits = exact_scan(
        [primary_password, attach_password, gmail_password],
        scan_paths,
        ARTIFACTS / "loop6e-secure-verify-exact-secret-scan.txt",
    )
    print(f"verify_exit={status}")
    print(f"exact_value_leak_hits={hits}")
    return status if hits == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
