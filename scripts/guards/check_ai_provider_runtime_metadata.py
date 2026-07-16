#!/usr/bin/env python3
"""Validate CloudMail AI provider runtime metadata without reading secret values."""

from __future__ import annotations

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-config-loader.js"
ROUTER = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-router.js"

PROVIDERS = {
    "google_gemini": {
        "label": "Gemini",
        "runtime": "CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL",
        "enabled": "CLOUDMAIL_AI_PROVIDER_GEMINI_ENABLED",
        "reference": "CLOUDMAIL_AI_GEMINI_CREDENTIAL_REFERENCE",
        "model": "CLOUDMAIL_AI_GEMINI_MODEL_ALIAS",
        "secret": "CLOUDMAIL_AI_GEMINI_API_KEY",
        "oauth_secret": "PROVIDER_TOKEN_SECRET",
        "user_owned_oauth": True,
    },
    "openai": {
        "label": "OpenAI / ChatGPT",
        "runtime": "CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL",
        "enabled": "CLOUDMAIL_AI_PROVIDER_OPENAI_ENABLED",
        "reference": "CLOUDMAIL_AI_OPENAI_CREDENTIAL_REFERENCE",
        "model": "CLOUDMAIL_AI_OPENAI_MODEL_ALIAS",
        "secret": "CLOUDMAIL_AI_OPENAI_API_KEY",
        "user_owned_oauth": False,
    },
}

REQUIRED_SNIPPETS = [
    "provider_label",
    "synthetic_tasks_allowed",
    "production_mailbox_data_allowed: false",
    "mailbox_content_allowed: false",
    "attachments_allowed: false",
    "contacts_allowed: false",
    "user_visible_status",
    "BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED",
    "runtime_auth_source",
    "billing_owner",
    "provider_ownership",
    "shared_platform_api_key",
]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def present(name: str) -> bool:
    value = os.environ.get(name)
    return value is not None and value != ""


def main() -> None:
    text = CONFIG.read_text(encoding="utf-8") + "\n" + ROUTER.read_text(encoding="utf-8")
    missing = [snippet for snippet in REQUIRED_SNIPPETS if snippet not in text]
    if missing:
        fail(f"provider runtime metadata contract missing snippets: {missing}")

    ready = []
    for provider_id, meta in PROVIDERS.items():
        runtime_enabled = os.environ.get(meta["runtime"], "").lower() == "true"
        provider_enabled = os.environ.get(meta["enabled"], "").lower() == "true"
        credential_reference_present = present(meta["reference"])
        model_alias_present = present(meta["model"])
        executable_secret_present = present(meta["secret"])
        oauth_secret_present = present(meta.get("oauth_secret", ""))
        executable_credential_present = oauth_secret_present if meta.get("user_owned_oauth") else executable_secret_present
        provider_ready = all(
            [
                runtime_enabled,
                provider_enabled,
                credential_reference_present,
                model_alias_present,
                executable_credential_present,
            ]
        )
        if provider_ready:
            ready.append(provider_id)
        print(
            "provider={provider} label={label!r} runtime_enabled={runtime} "
            "provider_enabled={enabled} credential_reference_present={reference} "
            "model_alias_present={model} executable_secret_present={secret} "
            "oauth_secret_present={oauth_secret} user_owned_oauth={user_owned_oauth} ready={ready}".format(
                provider=provider_id,
                label=meta["label"],
                runtime=runtime_enabled,
                enabled=provider_enabled,
                reference=credential_reference_present,
                model=model_alias_present,
                secret=executable_secret_present,
                oauth_secret=oauth_secret_present,
                user_owned_oauth=bool(meta.get("user_owned_oauth")),
                ready=provider_ready,
            )
        )

    if ready:
        print("READY_PROVIDERS=" + ",".join(ready))
    else:
        print("READY_PROVIDERS=none")
        print("BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED")


if __name__ == "__main__":
    main()
