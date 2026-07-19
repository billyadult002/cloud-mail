# Build & Release

Artifacts:
- iOS: artifacts/ios/CloudMail.ipa
- macOS app: artifacts/macos/CloudMail.app
- macOS DMG: artifacts/macos/CloudMail.dmg

## 1) Signing
The production recovery build uses Xcode Automatic Signing with Apple Development team `XC7JTUHQ33`. Distribution credentials are not required for the development-signed IPA or DMG.

## 2) Optional distribution signing
Distribution certificate and provisioning files may be added separately without changing `PRODUCT_BUNDLE_IDENTIFIER=app.wangbei8554.pingguo736`.
