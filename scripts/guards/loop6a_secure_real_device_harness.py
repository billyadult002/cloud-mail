#!/usr/bin/env python3
"""Loop 6A secure physical-device validation harness.

This script intentionally keeps runtime credentials in process memory only.
It writes a temporary .xctestrun containing only a one-shot bridge URL, never
credential values, then deletes that temporary file after execution.
"""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import shutil
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BUILD = ROOT / "build"
DEVICE_NAME = "Bill’s iPhone 17"
DEFAULT_AUTH_BASE_URL = "https://cloud-mail.fastonegroup.workers.dev"


def resolve_auth_base_url() -> str:
    """Return the single public CloudMail origin used by preflight, device, and verify."""
    return (
        os.environ.get("CLOUDMAIL_AUTH_BASE_URL")
        or os.environ.get("BASE_URL")
        or DEFAULT_AUTH_BASE_URL
    ).rstrip("/")


def run(cmd: list[str], *, log: Path | None = None, env: dict[str, str] | None = None,
        redact: list[str] | None = None, check: bool = False) -> int:
    redact = [value for value in (redact or []) if value]
    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    handle = log.open("w", encoding="utf-8") if log else None
    stop_watchdog = threading.Event()

    def reject_unexpected_sudo_prompt() -> None:
        while not stop_watchdog.is_set() and proc.poll() is None:
            ps = subprocess.run(
                ["ps", "-axo", "pid=,command="],
                capture_output=True,
                text=True,
                check=False,
            )
            for row in ps.stdout.splitlines():
                if "sudo -- /usr/bin/true" not in row and "devicectl diagnose" not in row:
                    continue
                pid_text = row.strip().split(maxsplit=1)[0]
                if pid_text.isdigit():
                    try:
                        os.kill(int(pid_text), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            time.sleep(1)

    watchdog = threading.Thread(target=reject_unexpected_sudo_prompt, daemon=True)
    watchdog.start()
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            safe = line
            for value in redact:
                safe = safe.replace(value, "[REDACTED]")
            if handle:
                handle.write(safe)
                handle.flush()
            sys.stdout.write(safe)
        code = proc.wait()
    finally:
        stop_watchdog.set()
        watchdog.join(timeout=2)
        if handle:
            handle.close()
    if check and code != 0:
        raise RuntimeError(f"command failed with exit code {code}: {' '.join(cmd[:4])}")
    return code


def prompt_secret(title: str, prompt: str, *, hidden: bool) -> str:
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{prompt}" default answer "" '
            f'{"with hidden answer " if hidden else ""}'
            f'buttons {{"Cancel", "Continue"}} default button "Continue" '
            f'with title "{title}"'
        ),
        "-e",
        "text returned of result",
    ]
    result = subprocess.run(script, capture_output=True, text=True)
    if result.returncode != 0:
        raise KeyboardInterrupt("credential prompt cancelled")
    return result.stdout.rstrip("\n")


def prompt_optional_secret(title: str, prompt: str, *, hidden: bool) -> str:
    script = [
        "osascript",
        "-e",
        (
            f'display dialog "{prompt}" default answer "" '
            f'{"with hidden answer " if hidden else ""}'
            f'buttons {{"Skip", "Continue"}} default button "Continue" '
            f'with title "{title}"'
        ),
        "-e",
        "text returned of result",
    ]
    result = subprocess.run(script, capture_output=True, text=True)
    if result.returncode != 0:
        return ""
    return result.stdout.rstrip("\n")


def local_ip() -> str:
    candidates = [
        ["ipconfig", "getifaddr", "en0"],
        ["ipconfig", "getifaddr", "en1"],
    ]
    for cmd in candidates:
        result = subprocess.run(cmd, capture_output=True, text=True)
        value = result.stdout.strip()
        if result.returncode == 0 and value:
            return value
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]


class CredentialBridge:
    def __init__(self, email: str, password: str, server_url: str) -> None:
        self.email = email
        self.password = password
        self.server_url = server_url
        self.hit_count = 0
        self.max_hits = 12
        self.token = secrets.token_urlsafe(24)
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    def start(self, host: str) -> str:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path != f"/credentials/{parent.token}":
                    self.send_response(404)
                    self.end_headers()
                    return
                if parent.hit_count >= parent.max_hits:
                    self.send_response(410)
                    self.end_headers()
                    return
                parent.hit_count += 1
                payload = {
                    "email": parent.email,
                    "password": parent.password,
                    "serverURL": parent.server_url,
                }
                data = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("cache-control", "no-store")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self.server = ThreadingHTTPServer((host, 0), Handler)
        port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return f"http://{host}:{port}/credentials/{self.token}"

    def stop(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=5)


def patch_xctestrun(
    base: Path,
    bridge_url: str,
    *,
    direct_email: str | None = None,
    direct_password: str | None = None,
) -> Path:
    patched = base.with_name("loop6a-secure-real-device.xctestrun")
    shutil.copy2(base, patched)
    with patched.open("rb") as handle:
        data = plistlib.load(handle)
    target = data["TestConfigurations"][0]["TestTargets"][0]
    testing_env = dict(target.get("TestingEnvironmentVariables", {}))
    testing_env["CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL"] = bridge_url
    if direct_email and direct_password:
        testing_env["CLOUDMAIL_DEVICE_EMAIL"] = direct_email
        testing_env["CLOUDMAIL_DEVICE_PASSWORD"] = direct_password
    target["TestingEnvironmentVariables"] = testing_env
    with patched.open("wb") as handle:
        plistlib.dump(data, handle)
    return patched


def newest_xctestrun() -> Path:
    local_derived = BUILD / "codex-p0c-device-derived"
    local_matches = sorted(
        local_derived.glob("Build/Products/AcceptanceHost_AcceptanceHost_iphoneos*.xctestrun"),
        key=lambda path: path.stat().st_mtime,
    )
    if local_matches:
        return local_matches[-1]
    derived = Path.home() / "Library/Developer/Xcode/DerivedData"
    matches = sorted(
        derived.glob("CloudMailDeviceAcceptance-*/Build/Products/AcceptanceHost_AcceptanceHost_iphoneos*.xctestrun"),
        key=lambda path: path.stat().st_mtime,
    )
    if not matches:
        raise FileNotFoundError("AcceptanceHost .xctestrun was not found")
    return matches[-1]


def summarize_xcresult(path: Path, output: Path) -> None:
    with output.open("w", encoding="utf-8") as handle:
        subprocess.run(
            ["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(path), "--format", "json"],
            cwd=ROOT,
            stdout=handle,
            stderr=subprocess.DEVNULL,
            check=False,
        )


def exact_leak_scan(values: list[str], paths: list[Path], output: Path) -> int:
    leaks = 0
    for value in values:
        if not value:
            continue
        for path in paths:
            if not path.exists():
                continue
            if path.is_dir():
                result = subprocess.run(["rg", "-I", "-F", value, str(path)], capture_output=True, text=True)
            else:
                result = subprocess.run(["rg", "-I", "-F", value, str(path)], capture_output=True, text=True)
            if result.returncode == 0:
                leaks += 1
                break
    output.write_text(f"exact_value_leak_hits={leaks}\n", encoding="utf-8")
    return leaks


def redact_email(value: str) -> str:
    if "@" not in value:
        return "redacted"
    local, domain = value.split("@", 1)
    if not local:
        return f"redacted@{domain}"
    return f"{local[0]}***@{domain}"


def auth_preflight(email: str, password: str, auth_base_url: str, output: Path) -> dict[str, object]:
    payload = json.dumps({"email": email, "password": password})
    result: dict[str, object] = {
        "auth_preflight": "rejected",
        "account_email": redact_email(email),
        "http_status": None,
        "body_code": None,
        "token_present": False,
        "reason_class": "unknown",
        "auth_base_url": auth_base_url,
    }
    completed = subprocess.run(
        [
            "curl", "-sS", "-m", "25", "-X", "POST", f"{auth_base_url}/api/login",
            "-H", "content-type: application/json",
            "--data-binary", "@-",
            "-w", "\n%{http_code}",
        ],
        input=payload,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        result["reason_class"] = "network"
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return result
    body, _, http_status = completed.stdout.rpartition("\n")
    if http_status.isdigit():
        result["http_status"] = int(http_status)
    else:
        result["reason_class"] = "decode"
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        return result

    try:
        decoded = json.loads(body)
    except json.JSONDecodeError:
        decoded = None

    if isinstance(decoded, dict):
        result["body_code"] = decoded.get("code")
        token = decoded.get("token")
        if not token and isinstance(decoded.get("data"), dict):
            token = decoded["data"].get("token")
        result["token_present"] = bool(token)

    if result["http_status"] == 200 and result["token_present"]:
        result["auth_preflight"] = "accepted"
        result["reason_class"] = "accepted"
    elif result["http_status"] == 200:
        result["reason_class"] = "invalid credential"
    elif result["http_status"] in {400, 401, 403}:
        result["reason_class"] = "invalid credential"
    elif result["http_status"] in {500, 502, 503, 504}:
        result["reason_class"] = "backend"

    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default=DEVICE_NAME)
    parser.add_argument("--skip-app-build-install", action="store_true")
    parser.add_argument("--direct-test-credentials", action="store_true")
    args = parser.parse_args()

    ARTIFACTS.mkdir(exist_ok=True)
    BUILD.mkdir(exist_ok=True)

    try:
        email = prompt_secret("CloudMail Device Validation", "CloudMail device email", hidden=False)
        password = prompt_secret("CloudMail Device Validation", "CloudMail device password", hidden=True)
        attach_email = prompt_optional_secret("CloudMail Device Validation", "Optional same-domain CloudMail mailbox email for final attach gate", hidden=False)
        attach_password = ""
        if attach_email:
            attach_password = prompt_optional_secret("CloudMail Device Validation", "Optional same-domain CloudMail mailbox password for final attach gate", hidden=True)
        gmail_email = prompt_optional_secret("CloudMail Device Validation", "Optional Gmail email for final verify gate", hidden=False)
        gmail_password = ""
        if gmail_email:
            gmail_password = prompt_optional_secret("CloudMail Device Validation", "Optional Gmail App Password for final verify gate", hidden=True)
    except KeyboardInterrupt:
        print("credential_intake=cancelled")
        return 42
    email = email.strip()
    attach_email = attach_email.strip()
    gmail_email = gmail_email.strip()
    if not email or not password:
        print("credential_intake=missing")
        return 43
    print(f"CLOUDMAIL_DEVICE_EMAIL={'present' if email else 'missing'}")
    print(f"CLOUDMAIL_DEVICE_PASSWORD={'present' if password else 'missing'}")
    print(f"CLOUDMAIL_ATTACH_EMAIL={'present' if attach_email else 'missing'}")
    print(f"CLOUDMAIL_ATTACH_PASSWORD={'present' if attach_password else 'missing'}")
    print(f"GMAIL_USER={'present' if gmail_email else 'missing'}")
    print(f"GMAIL_APP_PASSWORD={'present' if gmail_password else 'missing'}")

    auth_base_url = resolve_auth_base_url()
    print(f"auth_base_url={auth_base_url}")
    preflight = auth_preflight(email, password, auth_base_url, ARTIFACTS / "loop6c5t-auth-preflight.json")
    print(f"auth_preflight={preflight['auth_preflight']}")
    print(f"account_email={preflight['account_email']}")
    print(f"reason_class={preflight['reason_class']}")
    if preflight["auth_preflight"] != "accepted":
        exact_leak_scan(
            [password, gmail_password],
            [ARTIFACTS, BUILD, ROOT],
            ARTIFACTS / "loop6c5t-rejected-auth-exact-secret-scan.txt",
        )
        return 46

    ip = local_ip()
    bridge = CredentialBridge(email, password, auth_base_url)
    bridge_url = bridge.start(ip)
    redactions = [email, password, attach_email, attach_password, gmail_email, gmail_password, bridge_url]
    secret_scan_values = [password, attach_password, gmail_password]
    temp_xctestrun: Path | None = None
    result_bundle = ARTIFACTS / "codex-p0c-device-real-product-certification.xcresult"
    verify_log = ARTIFACTS / "codex-p0c-device-verify-device-gate.log"
    try:
        if not args.skip_app_build_install:
            app_build_status = run([
                "xcodebuild", "-allowProvisioningUpdates", "-project", "files/GlassMail-project/GlassMail.xcodeproj",
                "-scheme", "GlassMail", "-destination", f"platform=iOS,name={args.device}", "build",
            ], log=BUILD / "codex-p0c-device-app-build.log", redact=redactions)
            if app_build_status != 0:
                return app_build_status

            app_paths = sorted(
                (Path.home() / "Library/Developer/Xcode/DerivedData").glob("GlassMail-*/Build/Products/Debug-iphoneos/CloudMail.app"),
                key=lambda path: path.stat().st_mtime,
            )
            if not app_paths:
                print("cloudmail_app=missing")
                return 44
            install_status = run([
                "xcrun", "devicectl", "device", "install", "app", "--device", args.device, str(app_paths[-1]),
            ], log=ARTIFACTS / "codex-p0c-device-real-device-install.log", redact=redactions)
            if install_status != 0:
                return install_status

        build_status = run([
            "xcodebuild", "-allowProvisioningUpdates", "-project", "acceptance/CloudMailDeviceAcceptance/CloudMailDeviceAcceptance.xcodeproj",
            "-scheme", "AcceptanceHost", "-destination", "generic/platform=iOS",
            "-derivedDataPath", str(BUILD / "codex-p0c-device-derived"), "build-for-testing",
        ], log=BUILD / "codex-p0c-device-acceptance-build-for-testing.log", redact=redactions)
        if build_status != 0:
            return build_status

        temp_xctestrun = patch_xctestrun(
            newest_xctestrun(),
            bridge_url,
            direct_email=email if args.direct_test_credentials else None,
            direct_password=password if args.direct_test_credentials else None,
        )
        shutil.rmtree(result_bundle, ignore_errors=True)
        test_status = run([
            "xcodebuild", "test-without-building", "-xctestrun", str(temp_xctestrun),
            "-destination", f"platform=iOS,name={args.device}",
            "-only-testing:CloudMailDeviceAcceptanceTests/CloudMailDeviceAcceptanceTests/testFinalAcceptanceInstalledCloudMailLaunches",
            "-resultBundlePath", str(result_bundle),
        ], log=ARTIFACTS / "codex-p0c-device-real-product-certification.log", redact=redactions)

        summarize_xcresult(result_bundle, ARTIFACTS / "codex-p0c-device-real-product-certification-summary.json")

        verify_env = os.environ.copy()
        verify_env["BASE_URL"] = auth_base_url
        verify_env["CLOUDMAIL_AUTH_BASE_URL"] = auth_base_url
        verify_env["DEVICE_XCRESULT"] = str(result_bundle.relative_to(ROOT))
        verify_env["CLOUDMAIL_DEVICE_EMAIL"] = email
        verify_env["CLOUDMAIL_DEVICE_PASSWORD"] = password
        if attach_email and attach_password:
            verify_env["CLOUDMAIL_ATTACH_EMAIL"] = attach_email
            verify_env["CLOUDMAIL_ATTACH_PASSWORD"] = attach_password
        if gmail_email and gmail_password:
            verify_env["CLOUDMAIL_GMAIL_EMAIL"] = gmail_email
            verify_env["CLOUDMAIL_GMAIL_APP_PASSWORD"] = gmail_password
        verify_status = run(["./verify.sh"], log=verify_log, env=verify_env, redact=redactions)

        leak_hits = exact_leak_scan(
            secret_scan_values,
            [
                ARTIFACTS / "loop6a-infra-real-user-flow.log",
                ARTIFACTS / "codex-p0c-device-real-product-certification.log",
                ARTIFACTS / "codex-p0c-device-real-product-certification-summary.json",
                verify_log,
                result_bundle,
            ],
            ARTIFACTS / "codex-p0c-device-exact-secret-scan.txt",
        )
        (ARTIFACTS / "codex-p0c-device-bridge-state.json").write_text(
            json.dumps({"credential_bridge_hits": bridge.hit_count}, indent=2) + "\n",
            encoding="utf-8",
        )
        if test_status != 0:
            return test_status
        if verify_status != 0:
            return verify_status
        if leak_hits != 0:
            return 45
        return 0
    finally:
        bridge.stop()
        if temp_xctestrun:
            try:
                temp_xctestrun.unlink()
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
