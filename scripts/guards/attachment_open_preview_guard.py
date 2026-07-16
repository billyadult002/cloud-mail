#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
R2 = ROOT / "platform/cloud-mail/mail-worker/src/service/r2-service.js"
INDEX = ROOT / "platform/cloud-mail/mail-worker/src/index.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    r2 = R2.read_text(encoding="utf-8")
    index = INDEX.read_text(encoding="utf-8")
    print("ATTACHMENT_OPEN_PREVIEW_GUARD")
    require("import QuickLook" in detail and "QLPreviewController" in detail, "iOS uses native Quick Look preview")
    require("downloadAttachmentFile" in detail and "URLSession.shared.data" in detail, "iOS downloads remote attachments to a local file before open/save")
    require("AttachmentActivityView" in detail and "UIActivityViewController" in detail, "iOS download action exposes system local save/share")
    require("-CloudMailAttachmentAutoAction" in detail and "scheduleDebugAttachmentActionIfNeeded" in detail, "Debug real-device smoke can trigger attachment preview/share independently")
    require('ShareLink(item: url)' not in detail, "download action no longer shares the remote URL directly")
    require("url.pathname.startsWith('/attachments/')" in index and "r2Service.toObjResp" in index, "Worker attachment route uses object storage")
    require("async toObjResp(c, key)" in r2 and "status: 404" in r2, "missing attachments return 404 instead of Worker exception")
    print("SUCCESS: Attachment open/preview guard passed.")


if __name__ == "__main__":
    main()
