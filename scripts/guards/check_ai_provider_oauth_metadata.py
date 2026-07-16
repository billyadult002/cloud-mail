#!/usr/bin/env python3
"""Validate provider account-auth metadata without reading or printing secrets."""

from __future__ import annotations

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEMINI_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js"
GEMINI_API = ROOT / "platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js"
CLOUDMAIL_V2 = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"


def present(name: str) -> bool:
    value = os.environ.get(name)
    return value is not None and value != ""


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    service = GEMINI_SERVICE.read_text(encoding="utf-8")
    api = GEMINI_API.read_text(encoding="utf-8")
    v2 = CLOUDMAIL_V2.read_text(encoding="utf-8")

    required_gemini_snippets = [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "ai_provider_tokens",
        "encryptSecret",
        "/v2/ai/gemini/oauth/start",
        "/ai/oauth/gemini/start",
        "/ai/oauth/gemini/callback",
        "/oauth/gemini/callback",
    ]
    text = service + "\n" + api
    missing = [snippet for snippet in required_gemini_snippets if snippet not in text]
    if missing:
        fail(f"Gemini OAuth implementation missing snippets: {missing}")

    gemini_metadata_present = all(
        [
            present("GOOGLE_OAUTH_CLIENT_ID"),
            present("GOOGLE_OAUTH_CLIENT_SECRET"),
        ]
    )
    gemini_client_id_present = present("GOOGLE_OAUTH_CLIENT_ID")
    gemini_client_secret_reference_present = present("GOOGLE_OAUTH_CLIENT_SECRET")
    gemini_redirect_metadata_present = present("GOOGLE_OAUTH_REDIRECT_URI")
    gemini_oauth_scopes_present = present("GEMINI_OAUTH_SCOPES")
    gemini_oauth_default_scopes_supported = "DEFAULT_SCOPE" in service and "generative-language.retriever" in service
    gemini_oauth_consent_configured = present("GOOGLE_OAUTH_CONSENT_CONFIGURED") or present("GEMINI_OAUTH_CONSENT_CONFIGURED")
    gemini_web_oauth_routes_present = "/ai/oauth/gemini/start" in api and "/ai/oauth/gemini/callback" in api
    token_encryption_secret_present = any(
        [
            present("PROVIDER_TOKEN_SECRET"),
            present("GMAIL_CREDENTIAL_SECRET"),
            present("jwt_secret"),
            present("JWT_SECRET"),
        ]
    )

    openai_account_auth_present = (
        "/v2/ai/openai" in v2
        or "/v2/ai/chatgpt" in v2
        or "openai_chatgpt" in v2 and "account_authorization_unavailable" not in v2
    )

    print(f"gemini_oauth_backend_implemented=True")
    print(f"gemini_oauth_client_id_present={gemini_client_id_present}")
    print(f"gemini_oauth_client_secret_reference_present={gemini_client_secret_reference_present}")
    print(f"gemini_oauth_metadata_present={gemini_metadata_present}")
    print(f"gemini_oauth_redirect_metadata_present={gemini_redirect_metadata_present}")
    print(f"gemini_oauth_scopes_present={gemini_oauth_scopes_present}")
    print(f"gemini_oauth_default_scopes_supported={gemini_oauth_default_scopes_supported}")
    print(f"gemini_oauth_consent_configured={gemini_oauth_consent_configured}")
    print(f"gemini_oauth_callback_route_present=True")
    print(f"gemini_web_oauth_product_routes_present={gemini_web_oauth_routes_present}")
    print(f"gemini_backend_token_reference_storage_present=True")
    print(f"gemini_backend_token_encryption_secret_present={token_encryption_secret_present}")
    print(f"openai_chatgpt_account_auth_backend_present={openai_account_auth_present}")
    if not gemini_client_id_present:
        print("BLOCKED_GEMINI_OAUTH_CLIENT_ID_REQUIRED")
    if not gemini_client_secret_reference_present:
        print("BLOCKED_GEMINI_OAUTH_SECRET_REFERENCE_REQUIRED")
    if not gemini_metadata_present:
        print("BLOCKED_GEMINI_OAUTH_METADATA_REQUIRED")
    if not gemini_redirect_metadata_present:
        print("BLOCKED_GEMINI_REDIRECT_URI_REQUIRED")
    if not gemini_oauth_scopes_present:
        print("BLOCKED_GEMINI_OAUTH_SCOPES_REQUIRED")
    if not gemini_oauth_consent_configured:
        print("BLOCKED_GEMINI_OAUTH_CONSENT_CONFIGURATION_UNVERIFIED")
    if not token_encryption_secret_present:
        print("BLOCKED_GEMINI_TOKEN_ENCRYPTION_REFERENCE_REQUIRED")
    if not openai_account_auth_present:
        print("BLOCKED_OPENAI_ACCOUNT_AUTH_UNAVAILABLE")


if __name__ == "__main__":
    main()
