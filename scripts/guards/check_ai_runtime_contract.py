#!/usr/bin/env python3
"""Validate CloudMail AI runtime implementation contract without provider secrets."""

from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER = ROOT / "platform/cloud-mail/mail-worker/src"

REQUIRED_FILES = [
    WORKER / "api/ai-runtime-api.js",
    WORKER / "service/provider-runtime-config-loader.js",
    WORKER / "service/provider-runtime-adapters.js",
    WORKER / "service/provider-runtime-router.js",
    WORKER / "service/provider-runtime-redactor.js",
    WORKER / "service/provider-runtime-audit-logger.js",
    WORKER / "service/provider-runtime-error-mapper.js",
]

REQUIRED_SNIPPETS = {
    "api/ai-runtime-api.js": ["/v4/ai/runtime/preflight", "/v4/ai/workspace/action", "workspaceAction"],
    "api/test-api.js": [
        "/test/ai/workspace/verify",
        "/test/ai/workspace/verify/action",
        "publicWorkspaceVerification",
        "runtime_call_executed",
        "auth_required_for_runtime",
    ],
    "service/provider-runtime-config-loader.js": [
        "google_gemini",
        "openai",
        "azure_openai",
        "provider_label",
        "synthetic_tasks_allowed",
        "production_mailbox_data_allowed",
        "mailbox_content_allowed",
        "attachments_allowed",
        "contacts_allowed",
        "user_visible_status",
        "gemini_api_key_reference",
        "gemini_oauth_reference",
        "openai_project_api_key_reference",
        "openai_workload_identity_reference",
        "CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL",
        "CLOUDMAIL_AI_PROVIDER_GEMINI_ENABLED",
        "CLOUDMAIL_AI_PROVIDER_OPENAI_ENABLED",
        "CLOUDMAIL_AI_SYNTHETIC_PREFLIGHT_ENABLED",
        "CLOUDMAIL_AI_PRODUCTION_DATA_ALLOWED",
        "CLOUDMAIL_AI_MAILBOX_DATA_ALLOWED",
        "runtime_auth_source",
        "billing_owner",
        "provider_ownership",
        "shared_platform_api_key",
    ],
    "service/provider-runtime-adapters.js": [
        "GeminiRuntimeAdapter",
        "OpenAIRuntimeAdapter",
        "AzureOpenAIRuntimeAdapter",
        "ping",
        "summarize_synthetic",
        "draft_synthetic",
        "translate_synthetic",
        "workspace_summarize",
        "workspace_draft",
        "workspace_translate",
        "workspace_reply_suggestion",
        "workspace_thread_analysis",
        "loadUserGeminiToken",
        "tokenRefreshRequest",
        "authorization",
        "Bearer",
        "gemini_oauth_reference",
    ],
    "service/provider-runtime-router.js": [
        "unsupported_synthetic_prompt_class",
        "BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED",
        "credential_secret_unavailable",
        "unsafe_data_flags_enabled",
        "WORKSPACE_ACTION_PROMPTS",
        "workspace_payload_not_allowed",
        "publicWorkspaceVerification",
        "runtime_call_executed",
        "auth_required_for_runtime",
        "user_initiated",
        "mailbox_data_sent",
        "cross_account_access",
    ],
    "service/provider-runtime-redactor.js": ["redact"],
    "service/provider-runtime-audit-logger.js": ["metadata_json", "ai_runtime"],
    "service/provider-runtime-error-mapper.js": ["provider_runtime_error", "provider_error", "http_status"],
}

DISALLOWED = [
    "CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL, true",
    "CLOUDMAIL_AI_PROVIDER_GEMINI_ENABLED, true",
    "CLOUDMAIL_AI_PROVIDER_OPENAI_ENABLED, true",
    "CLOUDMAIL_AI_PRODUCTION_DATA_ALLOWED, true",
    "CLOUDMAIL_AI_MAILBOX_DATA_ALLOWED, true",
]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    for path in REQUIRED_FILES:
        if not path.exists() or not path.read_text(encoding="utf-8").strip():
            fail(f"missing or empty file: {path.relative_to(ROOT)}")

    for relative, snippets in REQUIRED_SNIPPETS.items():
        text = (WORKER / relative).read_text(encoding="utf-8")
        missing = [snippet for snippet in snippets if snippet not in text]
        if missing:
            fail(f"{relative} missing snippets: {missing}")
        for needle in DISALLOWED:
            if needle in text:
                fail(f"{relative} appears to default-enable unsafe flag: {needle}")

    webs = (WORKER / "hono/webs.js").read_text(encoding="utf-8")
    if "../api/ai-runtime-api" not in webs:
        fail("ai runtime API is not imported into route registry")

    print("PASS: AI runtime contract is implemented, routed, and closed by default.")


if __name__ == "__main__":
    main()
