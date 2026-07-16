#!/usr/bin/env python3
"""Serve one live CloudMail credential payload for physical-device validation.

The script reads credentials from environment variables and never writes them
to disk. Stop the process as soon as the device has consumed the payload.
"""

from __future__ import annotations

import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


class CredentialBridgeHandler(BaseHTTPRequestHandler):
    token: str = ""
    payload: dict[str, str | None] = {}

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")

    def do_GET(self) -> None:
        if self.path.strip("/") != self.token:
            self.send_response(404)
            self.end_headers()
            return

        body = json.dumps(self.payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    email = required_env("CLOUDMAIL_LIVE_EMAIL")
    password = required_env("CLOUDMAIL_LIVE_PASSWORD")
    server_url = os.environ.get("CLOUDMAIL_LIVE_SERVER_URL", "").strip() or None

    host = os.environ.get("CLOUDMAIL_BRIDGE_HOST", "0.0.0.0")
    port = int(os.environ.get("CLOUDMAIL_BRIDGE_PORT", "8765"))
    token = os.environ.get("CLOUDMAIL_CREDENTIAL_BRIDGE_TOKEN", "").strip() or secrets.token_urlsafe(24)

    CredentialBridgeHandler.token = token
    CredentialBridgeHandler.payload = {
        "email": email,
        "password": password,
        "serverURL": server_url,
    }

    server = ThreadingHTTPServer((host, port), CredentialBridgeHandler)
    print("CloudMail live credential bridge is running.")
    print("Use this URL as CLOUDMAIL_TEST_CREDENTIAL_BRIDGE_URL on device launch:")
    print(f"http://<mac-lan-ip>:{port}/{token}")
    print("Credentials are held in memory only. Stop this process after login.")
    server.serve_forever()


if __name__ == "__main__":
    main()
