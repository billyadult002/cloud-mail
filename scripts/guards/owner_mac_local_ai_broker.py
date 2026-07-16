#!/usr/bin/env python3
"""CloudMail Owner Mac Local AI Broker.

Provider-agnostic local-only broker with the first concrete adapter:
chatgpt_codex_cli. It never reads Codex auth files, browser cookies, OAuth
codes, provider tokens, or browser session data. Authentication to ChatGPT is
owned by the official Codex CLI.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SAFE_SYNTHETIC_PROMPT = (
    "Summarize this synthetic email: Project Alpha meeting moved from 2 PM to 4 PM. "
    "Please reply with a one sentence summary."
)
ALLOWED_ACTIONS = {"summarize_synthetic_email": SAFE_SYNTHETIC_PROMPT}
PAIRING_TTL_SECONDS = 180
REQUEST_TTL_SECONDS = 120
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CODEX_BINARY = "/opt/homebrew/bin/codex"
BROKER_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CODEX_READY_PROMPT = "Reply exactly: CLOUDMAIL_CODEX_EXEC_READY"


@dataclass(frozen=True)
class Adapter:
    provider_id: str
    adapter_id: str
    command: str | None
    concrete: bool
    local_only: bool = True


ADAPTERS = {
    "chatgpt": Adapter("chatgpt", "chatgpt_codex_cli", "codex", True),
    "claude": Adapter("claude", "claude_code_cli_if_available", "claude", False),
    "gemini": Adapter("gemini", "gemini_cli_or_oauth_runtime_if_available", "gemini", False),
    "grok": Adapter("grok", "grok_official_runtime_if_available", None, False),
    "future": Adapter("future", "future_provider", None, False),
}


def broker_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = BROKER_PATH
    env["HOME"] = os.environ.get("CLOUDMAIL_OWNER_HOME") or str(Path.home())
    env.setdefault("USER", os.environ.get("USER", ""))
    env.setdefault("SHELL", "/bin/zsh")
    return env


def codex_binary_path() -> str | None:
    if Path(DEFAULT_CODEX_BINARY).exists():
        return DEFAULT_CODEX_BINARY
    return shutil.which("codex", path=BROKER_PATH)


def run(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        cwd=str(REPO_ROOT),
        env=broker_env(),
    )


def json_bytes(data: dict[str, Any]) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")


def redacted_text(text: str, limit: int = 240) -> str:
    return " ".join(text.split())[:limit]


def codex_failure_reason(text: str, returncode: int | None = None) -> str:
    lowered = text.lower()
    if "out of credits" in lowered or "add credits" in lowered:
        return "codex_credit_exhausted"
    if "not logged in" in lowered or "login" in lowered or "authentication" in lowered:
        return "codex_login_required"
    if "timed out" in lowered:
        return "codex_exec_timeout"
    if returncode not in (None, 0):
        return "codex_exec_failed"
    return "codex_exec_unavailable"


def codex_exec_probe() -> dict[str, Any]:
    codex = codex_binary_path()
    if not codex:
        return {
            "codex_binary_present": False,
            "codex_exec_ready": False,
            "status_reason": "codex_cli_missing",
            "last_codex_error_redacted": "Codex CLI binary was not found in the broker execution PATH.",
        }
    try:
        result = run([
            codex,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            CODEX_READY_PROMPT,
        ], timeout=60)
    except subprocess.TimeoutExpired:
        return {
            "codex_binary_present": True,
            "codex_binary_path": codex,
            "codex_exec_ready": False,
            "status_reason": "codex_exec_timeout",
            "last_codex_error_redacted": "Codex exec timed out in the broker execution context.",
        }
    combined_output = f"{result.stdout}\n{result.stderr}"
    ready = result.returncode == 0 and "CLOUDMAIL_CODEX_EXEC_READY" in combined_output
    return {
        "codex_binary_present": True,
        "codex_binary_path": codex,
        "codex_exec_ready": ready,
        "status_reason": "codex_exec_ready" if ready else codex_failure_reason(combined_output, result.returncode),
        "last_codex_error_redacted": "" if ready else redacted_text(combined_output, 320),
    }


class ReplayWindow:
    def __init__(self) -> None:
        self._seen: dict[str, float] = {}

    def accept(self, nonce: str, now: float | None = None) -> bool:
        now = now or time.time()
        self._seen = {key: ts for key, ts in self._seen.items() if now - ts < REQUEST_TTL_SECONDS * 3}
        if nonce in self._seen:
            return False
        self._seen[nonce] = now
        return True


class BrokerState:
    def __init__(self) -> None:
        self.started_at = time.time()
        self.pairing_codes: dict[str, dict[str, Any]] = {}
        self.paired_devices: dict[str, dict[str, Any]] = {}
        self.replay = ReplayWindow()
        self.lock = threading.Lock()

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "broker": "running",
            "local_only": True,
            "started_at": int(self.started_at),
            "adapters": [adapter_status(adapter) for adapter in ADAPTERS.values()],
            "token_values_exposed": False,
        }

    def auth_check(self) -> dict[str, Any]:
        return codex_health(deep=True)

    def pair_start(self) -> dict[str, Any]:
        code = f"{secrets.randbelow(1_000_000):06d}"
        expires_at = int(time.time() + PAIRING_TTL_SECONDS)
        with self.lock:
            self.pairing_codes[code] = {"expires_at": expires_at, "confirmed": False}
        return {
            "ok": True,
            "pairing_state": "pairing_code_ready",
            "pairing_code": code,
            "expires_at": expires_at,
            "local_only": True,
        }

    def pair_confirm(self, code: str, device_label: str) -> dict[str, Any]:
        now = time.time()
        with self.lock:
            item = self.pairing_codes.get(code)
            if not item or item["expires_at"] < now:
                return {"ok": False, "pairing_state": "pairing_expired", "reason": "pairing_code_expired"}
            pair_id = "pair_" + secrets.token_urlsafe(12)
            pair_secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
            self.paired_devices[pair_id] = {
                "device_label": redacted_text(device_label, 80),
                "secret": pair_secret,
                "created_at": int(now),
                "revoked": False,
            }
            del self.pairing_codes[code]
        return {
            "ok": True,
            "pairing_state": "paired",
            "pairing_id": pair_id,
            "pairing_secret": pair_secret,
            "local_only": True,
        }

    def revoke(self, pair_id: str) -> dict[str, Any]:
        with self.lock:
            if pair_id in self.paired_devices:
                self.paired_devices[pair_id]["revoked"] = True
                return {"ok": True, "pairing_state": "revoked"}
        return {"ok": False, "pairing_state": "not_paired"}

    def authenticate(self, pair_id: str, body: bytes, signature: str, timestamp: int, nonce: str) -> tuple[bool, str]:
        now = int(time.time())
        if abs(now - timestamp) > REQUEST_TTL_SECONDS:
            return False, "timestamp_expired"
        if not nonce or not self.replay.accept(nonce):
            return False, "replay_rejected"
        pair = self.paired_devices.get(pair_id)
        if not pair or pair.get("revoked"):
            return False, "not_paired"
        secret = pair["secret"].encode("utf-8")
        expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return False, "signature_invalid"
        return True, "authenticated"


def adapter_status(adapter: Adapter, deep: bool = False) -> dict[str, Any]:
    command_path = codex_binary_path() if adapter.adapter_id == "chatgpt_codex_cli" else (shutil.which(adapter.command, path=BROKER_PATH) if adapter.command else None)
    status: dict[str, Any] = {
        "provider_id": adapter.provider_id,
        "adapter_id": adapter.adapter_id,
        "local_only": adapter.local_only,
        "installed": bool(command_path),
        "runtime_smoke_passed": False,
        "usable": False,
        "reason": "official_runtime_not_available",
    }
    if adapter.adapter_id == "chatgpt_codex_cli":
        status["reason"] = "codex_cli_missing" if not command_path else "codex_login_status_unknown"
        status["codex_binary_present"] = bool(command_path)
        status["codex_binary_path"] = command_path or ""
        status["broker_home_configured"] = bool(broker_env().get("HOME"))
        status["broker_path_configured"] = BROKER_PATH
        status["broker_cwd"] = str(REPO_ROOT)
        if command_path:
            result = run([command_path, "login", "status"], timeout=10)
            combined_output = f"{result.stdout}\n{result.stderr}"
            authenticated = result.returncode == 0 and (
                "Logged in using ChatGPT" in combined_output
                or "Logged in using personal access token" in combined_output
            )
            status.update({
                "codex_authenticated": authenticated,
                "codex_auth_status": "pass" if authenticated else "fail",
                "reason": "codex_authenticated" if authenticated else "codex_not_authenticated",
            })
            if not authenticated:
                status["last_codex_error_redacted"] = redacted_text(combined_output, 320)
            if authenticated and deep:
                probe = codex_exec_probe()
                status.update(probe)
                status["runtime_smoke_passed"] = probe.get("codex_exec_ready") is True
                status["usable"] = probe.get("codex_exec_ready") is True
                status["reason"] = str(probe.get("status_reason", status["reason"]))
    return status


def codex_health(deep: bool = False) -> dict[str, Any]:
    status = adapter_status(ADAPTERS["chatgpt"], deep=deep)
    return {
        "ok": status.get("codex_authenticated") is True and (not deep or status.get("codex_exec_ready") is True),
        "provider_id": "chatgpt",
        "adapter_id": "chatgpt_codex_cli",
        "broker": "running",
        "local_only": True,
        "token_values_exposed": False,
        "codex_binary_present": status.get("codex_binary_present") is True,
        "codex_binary_path": status.get("codex_binary_path", ""),
        "codex_auth_status": status.get("codex_auth_status", "fail"),
        "codex_authenticated": status.get("codex_authenticated") is True,
        "codex_exec_ready": status.get("codex_exec_ready") is True,
        "status_reason": status.get("reason", "codex_health_unknown"),
        "last_codex_error_redacted": status.get("last_codex_error_redacted", ""),
        "runtime_mode": "owner_mac_local_broker",
        "secret_exposure": False,
    }


def smoke_chatgpt_codex_cli(prompt: str = SAFE_SYNTHETIC_PROMPT) -> dict[str, Any]:
    codex = codex_binary_path()
    if not codex:
        return {"ok": False, "reason": "codex_cli_missing"}
    status = adapter_status(ADAPTERS["chatgpt"])
    if not status.get("codex_authenticated"):
        return {
            "ok": False,
            "reason": "codex_not_authenticated",
            "last_codex_error_redacted": status.get("last_codex_error_redacted", ""),
        }
    try:
        result = run([
            codex,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            prompt,
        ], timeout=90)
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "reason": "codex_exec_timeout",
            "last_codex_error_redacted": "Codex exec timed out in the broker execution context.",
        }
    if result.returncode != 0:
        combined_output = f"{result.stdout}\n{result.stderr}"
        return {
            "ok": False,
            "reason": codex_failure_reason(combined_output, result.returncode),
            "exit_code": result.returncode,
            "last_codex_error_redacted": redacted_text(combined_output, 320),
        }
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    response = lines[-1] if lines else ""
    return {
        "ok": bool(response),
        "provider_id": "chatgpt",
        "adapter_id": "chatgpt_codex_cli",
        "runtime_mode": "owner_mac_local_broker",
        "redacted_result": redacted_text(response),
        "secret_exposure": False,
    }


def make_handler(state: BrokerState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "CloudMailOwnerMacLocalAIBroker/1.0"

        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def _json(self, status: int, data: dict[str, Any]) -> None:
            body = json_bytes(data)
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> tuple[dict[str, Any], bytes]:
            length = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            return json.loads(body.decode("utf-8") or "{}"), body

        def do_GET(self) -> None:
            if self.path == "/health":
                self._json(200, state.health())
                return
            self._json(404, {"ok": False, "reason": "not_found"})

        def do_POST(self) -> None:
            try:
                payload, raw_body = self._read_json()
            except Exception:
                self._json(400, {"ok": False, "reason": "invalid_json"})
                return

            if self.path == "/pair/start":
                self._json(200, state.pair_start())
                return

            if self.path == "/pair/confirm":
                self._json(200, state.pair_confirm(str(payload.get("pairing_code", "")), str(payload.get("device_label", "CloudMail iPhone"))))
                return

            if self.path == "/pair/revoke":
                self._json(200, state.revoke(str(payload.get("pairing_id", ""))))
                return

            if self.path == "/ai/smoke":
                pair_id = self.headers.get("x-cloudmail-pairing-id", "")
                signature = self.headers.get("x-cloudmail-signature", "")
                timestamp = int(self.headers.get("x-cloudmail-timestamp", "0") or 0)
                nonce = self.headers.get("x-cloudmail-nonce", "")
                ok, reason = state.authenticate(pair_id, raw_body, signature, timestamp, nonce)
                if not ok:
                    self._json(401, {"ok": False, "reason": reason})
                    return
                provider_id = str(payload.get("provider_id", ""))
                action = str(payload.get("action", ""))
                prompt = str(payload.get("synthetic_prompt", ""))
                if provider_id != "chatgpt" or action not in ALLOWED_ACTIONS or prompt != ALLOWED_ACTIONS[action]:
                    self._json(400, {"ok": False, "reason": "action_not_allowed"})
                    return
                self._json(200, smoke_chatgpt_codex_cli(prompt))
                return

            if self.path == "/auth/check":
                pair_id = self.headers.get("x-cloudmail-pairing-id", "")
                signature = self.headers.get("x-cloudmail-signature", "")
                timestamp = int(self.headers.get("x-cloudmail-timestamp", "0") or 0)
                nonce = self.headers.get("x-cloudmail-nonce", "")
                ok, reason = state.authenticate(pair_id, raw_body, signature, timestamp, nonce)
                if not ok:
                    self._json(401, {"ok": False, "reason": reason})
                    return
                provider_id = str(payload.get("provider_id", ""))
                action = str(payload.get("action", ""))
                if provider_id != "chatgpt" or action != "codex_health_check":
                    self._json(400, {"ok": False, "reason": "action_not_allowed"})
                    return
                self._json(200, state.auth_check())
                return

            self._json(404, {"ok": False, "reason": "not_found"})

    return Handler


def request_json(url: str, payload: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
    data = None if payload is None else json_bytes(payload)
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="GET" if payload is None else "POST")
    req.add_header("content-type", "application/json")
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def sign_body(pair_secret: str, body: bytes) -> str:
    return hmac.new(pair_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def app_compatible_smoke() -> dict[str, Any]:
    state = BrokerState()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    try:
        _, health = request_json(f"{base}/health")
        _, pair_start = request_json(f"{base}/pair/start", {})
        _, pair_confirm = request_json(f"{base}/pair/confirm", {
            "pairing_code": pair_start["pairing_code"],
            "device_label": "CloudMail real iPhone app-compatible smoke",
        })
        if not pair_confirm.get("ok"):
            return {"ok": False, "reason": "pairing_failed", "health_ok": health.get("ok") is True}
        pair_id = pair_confirm["pairing_id"]
        pair_secret = pair_confirm["pairing_secret"]
        body = json_bytes({
            "provider_id": "chatgpt",
            "action": "summarize_synthetic_email",
            "synthetic_prompt": SAFE_SYNTHETIC_PROMPT,
            "request_id": "app-compatible-smoke",
        })
        timestamp = str(int(time.time()))
        nonce = secrets.token_urlsafe(16)
        headers = {
            "x-cloudmail-pairing-id": pair_id,
            "x-cloudmail-timestamp": timestamp,
            "x-cloudmail-nonce": nonce,
            "x-cloudmail-signature": sign_body(pair_secret, body),
        }
        req = urllib.request.Request(f"{base}/ai/smoke", data=body, headers={**headers, "content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=90) as response:
            smoke = json.loads(response.read().decode("utf-8"))
        return {
            "ok": smoke.get("ok") is True,
            "transport": "http_local_signed_hmac",
            "pairing_state": "paired",
            "health_ok": health.get("ok") is True,
            "adapter_id": smoke.get("adapter_id"),
            "provider_id": smoke.get("provider_id"),
            "runtime_mode": smoke.get("runtime_mode"),
            "redacted_result": smoke.get("redacted_result", ""),
            "secret_exposure": False,
        }
    finally:
        server.shutdown()
        server.server_close()


def serve(host: str, port: int) -> int:
    server = ThreadingHTTPServer((host, port), make_handler(BrokerState()))
    print(json.dumps({"ok": True, "broker": "running", "host": host, "port": server.server_address[1], "local_only": host in {"127.0.0.1", "localhost"}}))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="CloudMail Owner Mac Local AI Broker")
    parser.add_argument("command", choices=["status", "smoke", "app-smoke", "serve", "lifecycle"])
    parser.add_argument("--provider", default="chatgpt", choices=sorted(ADAPTERS))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    ns = parser.parse_args()

    if ns.command == "serve":
        return serve(ns.host, ns.port)

    if ns.command == "lifecycle":
        print(json.dumps({
            "start": "python3 scripts/owner_mac_local_ai_broker.py serve --host 127.0.0.1 --port 8765",
            "stop": "Ctrl-C or service manager stop",
            "status": "GET /health or command status",
            "pairing_reset": "POST /pair/revoke",
            "fail_closed": True,
        }, sort_keys=True))
        return 0

    if ns.command == "app-smoke":
        print(json.dumps(app_compatible_smoke(), sort_keys=True))
        return 0

    adapter = ADAPTERS[ns.provider]
    if ns.command == "status":
        print(json.dumps(adapter_status(adapter, deep=adapter.adapter_id == "chatgpt_codex_cli"), sort_keys=True))
        return 0

    if adapter.adapter_id != "chatgpt_codex_cli":
        print(json.dumps({
            "ok": False,
            "provider_id": adapter.provider_id,
            "adapter_id": adapter.adapter_id,
            "reason": "adapter_ready_runtime_smoke_not_available",
        }, sort_keys=True))
        return 0

    print(json.dumps(smoke_chatgpt_codex_cli(), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
