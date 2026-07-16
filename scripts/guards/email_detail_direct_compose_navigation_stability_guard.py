#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    reply_bar = detail[detail.index("private var replyBar"):detail.index("// MARK: Actions")]

    print("EMAIL_DETAIL_DIRECT_COMPOSE_NAVIGATION_STABILITY_GUARD")
    require("EmailComposeLaunchView" not in detail, "legacy Reply/Forward intermediate page is removed")
    require("compactReplyBarButton" in reply_bar, "Reply and Forward use direct compact buttons")
    require("startReply(withDraft: false)" in reply_bar and "startForward()" in reply_bar, "Reply and Forward open Compose directly")
    compose_flow = detail[detail.index("struct EmailDetailView"):detail.index("private func beginTranslateFlow")]
    require("EmailDetailComposePresentation" in detail, "Email Detail uses stable item-based Compose presentation")
    require(
        ".sheet(item: $composePresentation)" in compose_flow or ".fullScreenCover(item: $composePresentation)" in compose_flow,
        "Reply/Forward Compose is presented from item state"
    )
    require("presentComposeAfterStateUpdate" not in compose_flow and "showCompose = false" not in compose_flow, "Reply/Forward Compose no longer closes then reopens asynchronously")
    require("Color.clear" in compose_flow and ".frame(height: 14)" in compose_flow, "bottom action bar has separation from the main tab menu")
    require(".font(.system(size: 15, weight: .semibold))" in reply_bar, "bottom action icons are visually smaller")
    require(".frame(width: 38, height: 34)" in reply_bar, "bottom action hit targets remain stable after size reduction")
    require("VStack(alignment: .leading, spacing: 10)" in detail and ".padding(.vertical, 10)" in detail, "Email Detail content spacing is compact")
    require("SenderAvatar(name: email.fromName, size: 36)" in detail and ".font(.title3.weight(.bold))" in detail, "Email Detail header is compressed")
    for identifier in [
        "email-draft-reply-back",
        "email-ask-ai-back",
        "email-translate-back",
    ]:
        require(identifier in detail, f"explicit return control exists: {identifier}")
    require("@State private var isCancelling = false" in compose, "Compose cancel is guarded against repeated taps")
    require("guard !isCancelling else { return }" in compose, "Compose cancel ignores duplicate taps")
    require("let shouldSaveDraft = hasDraftContent" in compose and "dismiss()" in compose, "Compose cancel dismisses before saving draft")
    require("-CloudMailDetailAction" in detail and "CLOUDMAIL_DETAIL_ACTION" in detail and "scheduleDebugDetailActionIfNeeded" in detail, "DEBUG real-device smoke can open Reply/Forward directly")
    require("-CloudMailComposeAutoCancel" in compose and "CLOUDMAIL_COMPOSE_AUTO_CANCEL" in compose and "applyComposeAutoCancelLaunchArgumentIfNeeded" in compose, "DEBUG real-device smoke can validate Compose cancel return")
    print("SUCCESS: Email Detail direct compose navigation stability guard passed.")


if __name__ == "__main__":
    main()
