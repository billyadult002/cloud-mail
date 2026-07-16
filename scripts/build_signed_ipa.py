#!/usr/bin/env python3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
PROFILE_DIR = ROOT / "profile 00008150-000629623EC0401C"
ARTIFACTS_DIR = ROOT / "artifacts/gmail-reconnect-routing-real-replay"

def run(cmd, shell=True, check=True, cwd=ROOT, env=None):
    print(f"Running command: {cmd}")
    res = subprocess.run(cmd, shell=shell, cwd=cwd, env=env, capture_output=True, text=True)
    if res.returncode != 0 and check:
        print(f"Error executing command: {cmd}")
        print(f"Stdout:\n{res.stdout}")
        print(f"Stderr:\n{res.stderr}")
        sys.exit(res.returncode)
    return res

def main():
    print("Starting automated build & codesign process...")
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Convert P12 to legacy format to avoid MAC verification failures
    p12_path = PROFILE_DIR / "证书文件.p12"
    legacy_p12 = BUILD_DIR / "legacy.p12"
    temp_pem = BUILD_DIR / "temp.pem"

    run(f'openssl pkcs12 -in "{p12_path}" -passin pass:1 -out "{temp_pem}" -nodes')
    run(f'openssl pkcs12 -export -in "{temp_pem}" -out "{legacy_p12}" -passout pass:1 -legacy')
    if temp_pem.exists():
        temp_pem.unlink()

    # 2. Create temporary keychain
    temp_keychain = BUILD_DIR / "temp.keychain"
    if temp_keychain.exists():
        # delete existing
        run(f'security delete-keychain "{temp_keychain}"', check=False)
    
    run(f'security create-keychain -p "1" "{temp_keychain}"')
    run(f'security unlock-keychain -p "1" "{temp_keychain}"')

    # 3. Import legacy P12 into the keychain
    run(f'security import "{legacy_p12}" -k "{temp_keychain}" -P "1" -A')

    # 4. Configure list-keychains
    # Get current list first
    res = run('security list-keychains -d user', check=False)
    current_keychains = []
    for line in res.stdout.split('\n'):
        line = line.strip().strip('"')
        if line:
            current_keychains.append(line)
    
    keychains_str = " ".join(f'"{k}"' for k in current_keychains if k != str(temp_keychain))
    run(f'security list-keychains -d user -s "{temp_keychain}" {keychains_str}')

    # Verify identity
    run(f'security find-identity -v -p codesigning "{temp_keychain}"')

    # 5. Build unsigned app
    run(
        'DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer '
        'xcodebuild -workspace files/GlassMail-project/GlassMail.xcworkspace '
        '-scheme GlassMail -configuration Release -destination generic/platform=iOS '
        '-derivedDataPath build/DerivedData-iPhone-unsigned -quiet clean build CODE_SIGNING_ALLOWED=NO'
    )

    # 6. Parse entitlements from mobileprovision
    prov_path = PROFILE_DIR / "描述文件.mobileprovision"
    profile_plist = BUILD_DIR / "profile.plist"
    entitlements_plist = BUILD_DIR / "entitlements.plist"

    run(f'security cms -D -i "{prov_path}" > "{profile_plist}"')
    run(f'plutil -extract Entitlements xml1 -o "{entitlements_plist}" "{profile_plist}"')

    # 7. Copy mobileprovision to app bundle
    app_bundle = BUILD_DIR / "DerivedData-iPhone-unsigned/Build/Products/Release-iphoneos/CloudMail.app"
    run(f'cp "{prov_path}" "{app_bundle}/embedded.mobileprovision"')

    # 8. Modify CFBundleIdentifier to match the provisioning profile
    run(f'plutil -replace CFBundleIdentifier -string "app.wangbei8554.pingguo736" "{app_bundle}/Info.plist"')

    # 9. Codesign the app bundle
    run(f'codesign --force --sign "Apple Distribution: jian sun (4GGH43VE67)" --entitlements "{entitlements_plist}" "{app_bundle}"')

    # 10. Package into IPA
    ipa_path = ARTIFACTS_DIR / "CloudMail-owner-signed.ipa"
    payload_dir = BUILD_DIR / "ipa-build" / "Payload"
    if payload_dir.exists():
        run(f'rm -rf "{payload_dir.parent}"')
    payload_dir.mkdir(parents=True, exist_ok=True)

    run(f'cp -RP "{app_bundle}" "{payload_dir}/"')
    run(f'zip -r -q "{ipa_path}" Payload', cwd=payload_dir.parent)

    # 11. Final verification
    print("Verifying codesignature...")
    run(f'codesign -vd "{app_bundle}"')
    
    # Clean up temp keychain and legacy p12
    run(f'security delete-keychain "{temp_keychain}"', check=False)
    if legacy_p12.exists():
        legacy_p12.unlink()
    if profile_plist.exists():
        profile_plist.unlink()

    print(f"SUCCESS: Owner-signed IPA generated at: {ipa_path}")
    print(f"Size: {ipa_path.stat().st_size} bytes")

if __name__ == "__main__":
    main()
