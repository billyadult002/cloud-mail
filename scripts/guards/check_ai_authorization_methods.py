#!/usr/bin/env python3
"""Validate the inert CloudMail AI authorization method scaffold."""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "ai_authorization" / "AI_AUTHORIZATION_METHODS.json"
UI_MAPPING_PATH = ROOT / "ai_authorization" / "UI_STATUS_MAPPING.json"

REQUIRED_METHOD_IDS = {
    "disabled_no_ai",
    "gemini_api_key",
    "gemini_oauth",
    "openai_project_api_key",
    "openai_workload_identity",
    "azure_openai_managed_identity",
    "byok_user_key",
    "enterprise_managed_provider_key",
}

REQUIRED_FIELDS = {
    "id",
    "provider",
    "credential_type",
    "secret_reference_only",
    "user_owned_or_system_owned",
    "runtime_enabled",
    "production_enabled",
    "model_selector_enabled",
    "live_dispatch_enabled",
    "data_sharing_allowed",
    "audit_required",
    "rollback_available",
}

FALSE_BY_DEFAULT_FLAGS = {
    "AI_AUTH_METHODS_REGISTRY_ENABLED",
    "AI_AUTH_METHODS_STATUS_ENDPOINT_ENABLED",
    "AI_AUTH_METHODS_UI_STATUS_MAPPING_ENABLED",
    "AI_AUTH_RUNTIME_ROUTING_ENABLED",
    "AI_AUTH_PRODUCTION_PROVIDERS_ENABLED",
    "AI_AUTH_MODEL_SELECTOR_ENABLED",
    "AI_AUTH_LIVE_DISPATCH_ENABLED",
    "AI_AUTH_BYOK_INTAKE_ENABLED",
    "AI_AUTH_ENTERPRISE_KEYS_ENABLED",
}

CLOSED_GATE_FIELDS = {
    "runtime_enabled",
    "production_enabled",
    "model_selector_enabled",
    "live_dispatch_enabled",
    "data_sharing_allowed",
}

DISALLOWED_SECRET_FIELD_NAMES = {
    "api_key",
    "api_key_value",
    "access_token",
    "refresh_token",
    "token",
    "client_secret",
    "key_prefix",
    "secret_value",
    "credential_value",
    "password",
}

ALLOWED_METADATA_FIELDS = {
    "credential_type",
    "secret_reference_only",
    "secret_reference_present",
}


def load_json(path: pathlib.Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def walk_keys(value: Any, path: str = "") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = key.lower()
            if lowered in DISALLOWED_SECRET_FIELD_NAMES and lowered not in ALLOWED_METADATA_FIELDS:
                fail(f"disallowed secret-bearing field name at {path or '<root>'}.{key}")
            walk_keys(child, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk_keys(child, f"{path}[{index}]")


def main() -> None:
    registry = load_json(REGISTRY_PATH)
    ui_mapping = load_json(UI_MAPPING_PATH)
    walk_keys(registry)
    walk_keys(ui_mapping)

    flags = registry.get("feature_flags")
    if not isinstance(flags, dict):
        fail("feature_flags must be an object")
    missing_flags = FALSE_BY_DEFAULT_FLAGS - set(flags)
    if missing_flags:
        fail(f"missing feature flags: {sorted(missing_flags)}")
    enabled_flags = [flag for flag in FALSE_BY_DEFAULT_FLAGS if flags.get(flag) is not False]
    if enabled_flags:
        fail(f"flags must default false: {enabled_flags}")

    methods = registry.get("methods")
    if not isinstance(methods, list):
        fail("methods must be a list")
    ids = [method.get("id") for method in methods if isinstance(method, dict)]
    missing_methods = REQUIRED_METHOD_IDS - set(ids)
    extra_methods = set(ids) - REQUIRED_METHOD_IDS
    if missing_methods:
        fail(f"missing method ids: {sorted(missing_methods)}")
    if extra_methods:
        fail(f"unexpected method ids: {sorted(extra_methods)}")

    ui_statuses = ui_mapping.get("statuses", {})
    if not isinstance(ui_statuses, dict):
        fail("statuses must be an object")

    for method in methods:
        if not isinstance(method, dict):
            fail("method entries must be objects")
        method_id = method.get("id", "<unknown>")
        missing_fields = REQUIRED_FIELDS - set(method)
        if missing_fields:
            fail(f"{method_id} missing required fields: {sorted(missing_fields)}")
        if method.get("secret_reference_only") is not True:
            fail(f"{method_id} must be secret_reference_only=true")
        if method.get("secret_reference_present") is not False:
            fail(f"{method_id} must not claim a secret reference in scaffold")
        for field in CLOSED_GATE_FIELDS:
            if method.get(field) is not False:
                fail(f"{method_id}.{field} must default false")
        ui_status_key = method.get("ui_status_key")
        if ui_status_key not in ui_statuses:
            fail(f"{method_id} references missing UI status {ui_status_key!r}")

    print("PASS: AI authorization methods scaffold is complete, closed by default, and metadata-only.")
    print("Checked method ids: " + ", ".join(sorted(REQUIRED_METHOD_IDS)))


if __name__ == "__main__":
    main()
