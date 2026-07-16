#!/usr/bin/env python3
"""Lock CloudMail's unified Google mailbox + Gemini OAuth architecture.

This checker is intentionally conservative. It validates the source and built
Web entrypoint without printing secrets, tokens, OAuth codes, or Google subject
IDs. With --production it also runs non-secret D1 readiness assertions.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
from typing import Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER = ROOT / "platform/cloud-mail/mail-worker"
WORKER_SRC = WORKER / "src"
WEB_SRC = ROOT / "platform/cloud-mail/mail-vue/src"
DIST = WORKER / "dist"

UI_SCAN_DIRS = [
    WEB_SRC,
    ROOT / "files/GlassMail-project/GlassMail/Views",
]

FORBIDDEN_NORMAL_UI = [
    "Connect Gemini",
    "Sign in with Gemini",
    "Authorize Gemini",
    "App Password",
    "BYOK",
]

REQUIRED_WORKSPACE_ACTIONS = [
    "summarize",
    "draft",
    "translate",
    "reply_suggestion",
    "thread_analysis",
]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: pathlib.Path) -> str:
    if not path.exists():
        fail(f"missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def iter_text_files(paths: Iterable[pathlib.Path]) -> Iterable[pathlib.Path]:
    for base in paths:
        if not base.exists():
            continue
        if base.is_file():
            yield base
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".js", ".vue", ".swift", ".html"}:
                yield path


def assert_contains(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    if missing:
        fail(f"{label} missing required snippets: {missing}")


def assert_not_contains(text: str, needles: list[str], label: str) -> None:
    hits = [needle for needle in needles if needle in text]
    if hits:
        fail(f"{label} contains forbidden snippets: {hits}")


def source_lock() -> None:
    service = read(WORKER_SRC / "service/gemini-oauth-service.js")
    api = read(WORKER_SRC / "api/gemini-oauth-api.js")
    add_gmail = read(WEB_SRC / "views/add-gmail/index.vue")
    account_request = read(WEB_SRC / "request/account.js")
    router = read(WEB_SRC / "router/index.js")
    runtime_router = read(WORKER_SRC / "service/provider-runtime-router.js")
    wrangler = read(WORKER / "wrangler.toml")

    assert_contains(
        service,
        [
            "DEFAULT_GOOGLE_MAILBOX_SCOPES",
            "'openid'",
            "'email'",
            "'profile'",
            "'https://www.googleapis.com/auth/gmail.readonly'",
            "DEFAULT_SCOPE",
            "MAILBOX_CREDENTIAL_PREFIX = 'oauth-json:'",
            "googleMailboxProvider(email)",
            "? 'gmail' : 'google_workspace'",
            "flow: 'google_mailbox_unified'",
            "await upsertGeminiToken(c, stored.userId, token, info, activeScopeText)",
            "await upsertGoogleMailbox(c, stored.userId, token, info, activeScopeText)",
            "google_mailbox_identity_mismatch",
            "secondLoginRequired: !(isGoogleMailbox && status.authorized && emailMatches)",
        ],
        "gemini-oauth-service.js",
    )

    assert_contains(
        api,
        [
            "app.get('/v2/google/mail/oauth/start'",
            "app.get('/google/mail/oauth/start'",
            "acceptsJson(c)",
            "return c.json(result.ok(data));",
            "return c.redirect(data.authorizationUrl, 302);",
            "app.get('/ai/oauth/gemini/callback', geminiCallbackResponse)",
            "Google mailbox connected",
        ],
        "gemini-oauth-api.js",
    )

    assert_contains(
        router,
        ["path: '/add-gmail'", "name: 'add-gmail'"],
        "Web router",
    )
    assert_contains(
        account_request,
        ["googleMailboxOAuthStart", "return http.get('/google/mail/oauth/start')"],
        "Web account request",
    )
    assert_contains(
        add_gmail,
        ["$t('addGmail')", "$t('continueWithGoogle')", "continueWithGoogle", "googleMailboxOAuthStart", "window.location.assign(data.authorizationUrl)"],
        "Web Add Gmail page",
    )
    assert_not_contains(
        add_gmail,
        ["window.location.assign('/api/google/mail/oauth/start')", "App Password", "BYOK", "Connect Gemini"],
        "Web Add Gmail page",
    )

    for action in REQUIRED_WORKSPACE_ACTIONS:
        if action not in runtime_router:
            fail(f"provider-runtime-router.js missing workspace action: {action}")

    assert_contains(
        wrangler,
        ["run_worker_first = true", "directory = \"./dist\"", "name = \"cloud-mail\""],
        "wrangler.toml deployment settings",
    )


def ui_forbidden_lock() -> None:
    hits: list[str] = []
    for path in iter_text_files(UI_SCAN_DIRS):
        text = read(path)
        for forbidden in FORBIDDEN_NORMAL_UI:
            if forbidden in text:
                hits.append(f"{path.relative_to(ROOT)}: {forbidden}")
    if hits:
        fail("normal UI forbidden text found: " + "; ".join(hits))


def dist_lock() -> None:
    if not (DIST / "index.html").exists():
        fail("dist/index.html missing; run the Web build before deployment")
    dist_text = "\n".join(path.read_text(encoding="utf-8", errors="ignore") for path in iter_text_files([DIST]))
    assert_contains(
        dist_text,
        ["Add Gmail", "Continue with Google", "/google/mail/oauth/start"],
        "production Web dist",
    )
    assert_not_contains(
        dist_text,
        FORBIDDEN_NORMAL_UI,
        "production Web dist",
    )


def run_json_command(command: list[str], cwd: pathlib.Path) -> object:
    completed = subprocess.run(command, cwd=cwd, check=False, text=True, capture_output=True)
    if completed.returncode != 0:
        fail(f"command failed: {' '.join(command)}\n{completed.stderr.strip()}")
    match = re.search(r"(\[\s*\{.*\}\s*\])\s*$", completed.stdout, flags=re.S)
    if not match:
        fail("could not parse wrangler JSON output")
    return json.loads(match.group(1))


def production_lock() -> None:
    sql = """
SELECT
  a.email AS mailbox_email,
  t.provider_account_email AS gemini_email,
  lower(a.email) = lower(t.provider_account_email) AS provider_email_match,
  m.credential_ciphertext LIKE 'oauth-json:%' AS mailbox_oauth_reference,
  a.sync_status = 'connected' AS mailbox_ready,
  t.status = 'connected'
    AND t.provider_account_id IS NOT NULL
    AND t.provider_account_email IS NOT NULL
    AND t.access_token_ciphertext IS NOT NULL
    AND t.refresh_token_ciphertext IS NOT NULL AS gemini_ready,
  a.sync_status = 'connected'
    AND t.status = 'connected'
    AND t.provider_account_id IS NOT NULL
    AND t.provider_account_email IS NOT NULL
    AND lower(a.email) = lower(t.provider_account_email)
    AND m.credential_ciphertext LIKE 'oauth-json:%' AS ai_ready
FROM user u
JOIN account a
  ON a.user_id = u.user_id
 AND a.email = 'saercpku@gmail.com'
 AND a.provider IN ('gmail','google_workspace')
 AND a.is_del = 0
JOIN mail_provider_credentials m
  ON m.user_id = u.user_id
 AND m.account_id = a.account_id
 AND m.email = a.email
JOIN ai_provider_tokens t
  ON t.user_id = u.user_id
 AND t.provider = 'google_gemini'
WHERE u.email = 'bill@fastonegroup.com'
LIMIT 1;
""".strip()
    payload = run_json_command(
        ["npx", "wrangler", "d1", "execute", "cloud-mail", "--remote", "--command", sql],
        WORKER,
    )
    results = payload[0].get("results", []) if isinstance(payload, list) and payload else []
    if len(results) != 1:
        fail(f"production readiness query returned {len(results)} rows")
    row = results[0]
    required_true = [
        "provider_email_match",
        "mailbox_oauth_reference",
        "mailbox_ready",
        "gemini_ready",
        "ai_ready",
    ]
    failures = [key for key in required_true if row.get(key) != 1]
    if failures:
        fail(f"production unified Google OAuth readiness failed: {failures}")
    print("PASS: production mailbox_ready=true gemini_ready=true ai_ready=true identity_email_match=true")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--production", action="store_true", help="run non-secret production D1 readiness assertions")
    args = parser.parse_args()

    source_lock()
    ui_forbidden_lock()
    dist_lock()
    if args.production:
        production_lock()
    print("PASS: unified Google OAuth architecture lock is stable.")


if __name__ == "__main__":
    main()
