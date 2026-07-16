#!/usr/bin/env python3
"""Loop 6E-2D-RL deterministic credential handoff runner.

Credentials remain in process memory only. Reports contain non-secret run
metadata and auth outcomes, never passwords, tokens, cookies, or headers.
"""

from __future__ import annotations

import json
import os
import ssl
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = (os.environ.get("CLOUDMAIL_AUTH_BASE_URL") or os.environ.get("BASE_URL") or "https://cloud-mail.fastonegroup.workers.dev").rstrip("/")
ACK_TEXT = "YES, I confirm this target mailbox credential is current and I accept the risk of not rotating it."
LOOP_LABEL = os.environ.get("CLOUDMAIL_LOOP_LABEL", "CloudMail 6E-2D-RL")
ARTIFACT_PREFIX = os.environ.get("CLOUDMAIL_LOOP_ARTIFACT_PREFIX", "loop6e2d-rl")

PROMPT_SEQUENCE = [
    ("risk_ack", "Risk acknowledgement - target mailbox credential risk acknowledgement", False, ACK_TEXT),
    ("primary_email", "Primary CloudMail email - PRIMARY login identity", False, ""),
    ("primary_password", "Primary CloudMail password - PRIMARY login secret", True, ""),
    ("target_email", "Target same-domain mailbox email - ATTACH TARGET owner identity", False, ""),
    ("target_password", "Target same-domain mailbox password - ATTACH TARGET owner secret", True, ""),
    ("gmail_email", "Gmail email - STRICT VERIFY Gmail gate identity", False, ""),
    ("gmail_app_password", "Gmail App Password - STRICT VERIFY Gmail gate secret", True, ""),
]


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


def request_json(method: str, path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "CloudMailLoop6E2DRL/1.0",
        "x-cloudmail-loop": "6e-2d-rl",
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
    parsed_data = parsed.get("data") if isinstance(parsed, dict) else None
    return {
        "http_status": status,
        "body_code": parsed.get("code") if isinstance(parsed, dict) else None,
        "data": parsed_data,
    }


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


def write_report(path: Path, report: dict) -> None:
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    ARTIFACTS.mkdir(exist_ok=True)
    run_id = f"{ARTIFACT_PREFIX}-{uuid.uuid4()}"
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    diagnostic_path = ARTIFACTS / f"{ARTIFACT_PREFIX}-deterministic-handoff.json"
    verify_log = ARTIFACTS / f"{ARTIFACT_PREFIX}-verify.log"
    exact_path = ARTIFACTS / f"{ARTIFACT_PREFIX}-exact-secret-scan.txt"

    values: dict[str, str] = {}
    prompt_log = []
    try:
        for index, (field, label, hidden, default_answer) in enumerate(PROMPT_SEQUENCE, start=1):
            value = prompt(LOOP_LABEL, f"Step {index}/7: {label}", hidden=hidden, default_answer=default_answer)
            values[field] = value
            prompt_log.append({"index": index, "field": field, "label": label, "completed": True, "secret": hidden})
    except KeyboardInterrupt:
        report = {
            "run_id": run_id,
            "created_at": created_at,
            "auth_base_url": BASE_URL,
            "prompt_completed": False,
            "prompt_sequence": prompt_log,
            "credentials_written": False,
            "classification": "BLOCKED_SECURE_PROMPT_CANCELLED",
        }
        write_report(diagnostic_path, report)
        verify_log.write_text("verify_not_run_classification=BLOCKED_SECURE_PROMPT_CANCELLED\n", encoding="utf-8")
        print("classification=BLOCKED_SECURE_PROMPT_CANCELLED")
        return 42

    if values.get("risk_ack", "").strip() != ACK_TEXT:
        report = {
            "run_id": run_id,
            "created_at": created_at,
            "auth_base_url": BASE_URL,
            "prompt_completed": True,
            "risk_acknowledgement_provided": False,
            "acknowledgement_text_recorded": False,
            "prompt_sequence": prompt_log,
            "credentials_written": False,
            "classification": "BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED",
        }
        write_report(diagnostic_path, report)
        verify_log.write_text("verify_not_run_classification=BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED\n", encoding="utf-8")
        print("classification=BLOCKED_CREDENTIAL_ROTATION_OR_RISK_ACK_REQUIRED")
        return 43

    primary_email = normalize_email(values["primary_email"])
    target_email = normalize_email(values["target_email"])
    gmail_email = normalize_email(values["gmail_email"])
    primary_password = values["primary_password"]
    target_password = values["target_password"]
    gmail_app_password = values["gmail_app_password"]

    primary = request_json("POST", "/api/login", body={"email": primary_email, "password": primary_password})
    primary_data = primary.get("data") if isinstance(primary.get("data"), dict) else {}
    primary_token = primary_data.get("token")
    target = request_json("POST", "/api/login", body={"email": target_email, "password": target_password})
    target_data = target.get("data") if isinstance(target.get("data"), dict) else {}
    target_token = target_data.get("token")
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
        accounts_json = json.dumps(accounts_result.get("data"), separators=(",", ":"))
        accounts_after = {
            "http_status": accounts_result.get("http_status"),
            "body_code": accounts_result.get("body_code"),
            "delegated_present": '"delegated":true' in accounts_json,
        }
        owner_account_id = authorization.get("data", {}).get("ownerAccountId")
        if owner_account_id:
            read_result = request_json(
                "GET",
                f"/api/email/list?accountId={owner_account_id}&allReceive=0&size=5&type=0",
                token=primary_token,
            )
            read_json = json.dumps(read_result.get("data", {}), separators=(",", ":"))
            readability = {
                "http_status": read_result.get("http_status"),
                "body_code": read_result.get("body_code"),
                "account_email_present": '"accountEmail"' in read_json,
            }

    if not primary_token:
        classification = "FAIL_PRIMARY_AUTH"
    elif not target_token:
        classification = "BLOCKED_TARGET_OWNER_AUTH_501" if target.get("body_code") == 501 else "BLOCKED_TARGET_OWNER_AUTH_FAILED"
    elif target_session.get("body_code") != 200:
        classification = "FAIL_TARGET_SESSION_PROBE"
    elif authorization.get("body_code") != 200:
        classification = "FAIL_SAME_DOMAIN_AUTHORIZATION"
    elif not accounts_after.get("delegated_present"):
        classification = "FAIL_DELEGATED_VISIBILITY"
    elif not readability.get("account_email_present"):
        classification = "FAIL_DELEGATED_READABILITY"
    else:
        classification = "AUTHORIZATION_PREFLIGHT_PASS"

    report = {
        "run_id": run_id,
        "created_at": created_at,
        "auth_base_url": BASE_URL,
        "prompt_completed": True,
        "prompt_sequence": prompt_log,
        "risk_acknowledgement_provided": True,
        "acknowledgement_text_recorded": False,
        "credentials_written": False,
        "credential_fingerprints_written": False,
        "same_session_invariant": "preflight_authorization_and_verify_use_same_in_memory_prompt_values",
        "normalization": {
            "emails": "NFKC + trim + lowercase before all client-side auth stages",
            "passwords": "unchanged; no trim, case change, unicode normalization, hash, or fingerprint",
        },
        "primary_email_normalized": primary_email,
        "target_email_normalized": target_email,
        "gmail_email_normalized": gmail_email,
        "same_domain": primary_email.split("@")[-1] == target_email.split("@")[-1],
        "different_mailbox": primary_email != target_email,
        "primary_auth": {
            "http_status": primary.get("http_status"),
            "body_code": primary.get("body_code"),
            "accepted": bool(primary_token),
            "token_present": bool(primary_token),
        },
        "target_auth": {
            "http_status": target.get("http_status"),
            "body_code": target.get("body_code"),
            "accepted": bool(target_token),
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
    write_report(diagnostic_path, report)

    verify_status = 99
    if classification == "AUTHORIZATION_PREFLIGHT_PASS":
        env = os.environ.copy()
        env.update({
            "BASE_URL": BASE_URL,
            "CLOUDMAIL_AUTH_BASE_URL": BASE_URL,
            "DEVICE_XCRESULT": "artifacts/codex-p0c-device-real-product-certification.xcresult",
            "CLOUDMAIL_DEVICE_EMAIL": primary_email,
            "CLOUDMAIL_DEVICE_PASSWORD": primary_password,
            "CLOUDMAIL_ATTACH_EMAIL": target_email,
            "CLOUDMAIL_ATTACH_PASSWORD": target_password,
            "CLOUDMAIL_GMAIL_EMAIL": gmail_email,
            "CLOUDMAIL_GMAIL_APP_PASSWORD": gmail_app_password,
        })
        verify_status = run_verify(
            env,
            [primary_email, primary_password, target_email, target_password, gmail_email, gmail_app_password],
            verify_log,
        )
    else:
        verify_log.write_text(f"verify_not_run_classification={classification}\n", encoding="utf-8")

    exact_hits = exact_scan(
        [primary_password, target_password, gmail_app_password],
        [
            diagnostic_path,
            verify_log,
            ARTIFACTS / f"{ARTIFACT_PREFIX}-scoped-secret-scan-raw.txt",
            ARTIFACTS / f"{ARTIFACT_PREFIX}-scoped-secret-scan-summary.txt",
            ROOT / "LOOP_6E_4_FINAL_REPORT.md",
            ROOT / "NEXT_LOOP_INPUT.md",
        ],
        exact_path,
    )

    print(f"run_id={run_id}")
    print(f"prompt_completed=True")
    print(f"primary_auth_body_code={primary.get('body_code')}")
    print(f"target_auth_body_code={target.get('body_code')}")
    print(f"target_token_present={bool(target_token)}")
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
