#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
INDEX = ROOT / "platform/cloud-mail/mail-worker/src/index.js"
R2_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/r2-service.js"
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ATTACHMENT_DOWNLOAD_URL_GUARD")
service = EMAIL_SERVICE.read_text(encoding="utf-8")
index = INDEX.read_text(encoding="utf-8")
r2_service = R2_SERVICE.read_text(encoding="utf-8")
detail = DETAIL.read_text(encoding="utf-8")
models = MODELS.read_text(encoding="utf-8")
require("downloadURL" in service and "domainUtils.toOssDomain" in service, "backend decorates attachments with download URLs")
require("new URL(c.req.url).origin" in service, "backend falls back to Worker origin when r2Domain is absent")
require("downloadUrl" in service, "backend also emits camel-case tolerant downloadUrl")
require("url.pathname.startsWith('/attachments/')" in index and "r2Service.toObjResp" in index, "public attachment route reads through the configured object storage")
require("async toObjResp(c, key)" in r2_service and "status: 404" in r2_service, "object response returns 404 instead of Worker exception when missing")
require("case downloadURL" in models and "case downloadUrl" in models, "iOS decodes attachment download URL aliases")
require("downloadAttachmentFile" in detail and "URLSession.shared.data" in detail, "iOS downloads attachments into a local file before opening or saving")
require('Label("Open", systemImage: "doc.text.magnifyingglass")' in detail, "Email detail shows a local-preview open attachment action")
require("AttachmentActivityView" in detail and "attachmentShareItem" in detail, "Email detail exposes system save/share for the downloaded local file")
require('ShareLink(item: url)' not in detail, "Email detail no longer shares the remote attachment URL as the download action")
require("Download unavailable" in detail, "Email detail explains missing attachment URL")
print("SUCCESS: Attachment download URL guard passed.")
