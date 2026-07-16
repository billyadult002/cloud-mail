#!/usr/bin/env bash
#
# verify.sh — CloudMail OS single source of PASS truth
# ---------------------------------------------------------------------------
# This script is the ONLY thing allowed to say PASS. It fails closed: every
# check must produce real evidence (a live HTTP response, a parsed .xcresult)
# or the whole run is FAIL. There is no "feature exists therefore PASS" path.
#
# It replaces the "Codex declares PASS / user finds FAIL on device" loop with a
# machine-checkable gate. An agent (local Claude Code, Codex, CI) is forbidden
# from writing PASS in any report unless `./verify.sh` exits 0.
#
# Usage:
#   ./verify.sh                      # backend HTTP checks + device gate
#   BASE_URL=https://... ./verify.sh # override worker origin
#   REQUIRE_DEVICE=0 ./verify.sh     # backend-only (device gate skipped)
#   DEVICE_XCRESULT=artifacts/... ./verify.sh
#                                    # required for device certification
#   CLOUDMAIL_DEVICE_EMAIL=... CLOUDMAIL_DEVICE_PASSWORD=... ./verify.sh
#                                    # also runs a real authenticated login
#   CLOUDMAIL_GMAIL_EMAIL=... CLOUDMAIL_GMAIL_APP_PASSWORD=... ./verify.sh
#                                    # also proves Gmail IMAP -> email -> Inbox
#
# Exit codes: 0 = PASS (all required checks green), 1 = FAIL, 2 = misuse.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE_URL="${BASE_URL:-https://cloud-mail.fastonegroup.workers.dev}"
DOMAIN="${CLOUDMAIL_DOMAIN:-fastonegroup.com}"
REQUIRE_DEVICE="${REQUIRE_DEVICE:-1}"
REQUIRE_AUTH="${REQUIRE_AUTH:-1}"
REQUIRE_GMAIL="${REQUIRE_GMAIL:-1}"
REQUIRE_SAME_DOMAIN_ATTACH="${REQUIRE_SAME_DOMAIN_ATTACH:-1}"
REQUIRE_REAL_DEVICE="${REQUIRE_REAL_DEVICE:-1}"
DEVICE_XCRESULT="${DEVICE_XCRESULT:-}"
DEVICE_EVIDENCE_MAX_AGE_SECONDS="${DEVICE_EVIDENCE_MAX_AGE_SECONDS:-86400}"
ACCOUNTS=("bill@${DOMAIN}" "admin@${DOMAIN}" "aki@${DOMAIN}" "alistair@${DOMAIN}")

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILURES=()

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
yellow(){ printf '\033[33m%s\033[0m' "$1"; }

ok()   { PASS_COUNT=$((PASS_COUNT+1)); printf '  [%s] %s\n' "$(green PASS)" "$1"; }
bad()  { FAIL_COUNT=$((FAIL_COUNT+1)); FAILURES+=("$1"); printf '  [%s] %s\n' "$(red FAIL)" "$1"; }
skip() { SKIP_COUNT=$((SKIP_COUNT+1)); printf '  [%s] %s\n' "$(yellow SKIP)" "$1"; }

# curl wrapper for unauthenticated, non-secret requests.
http() {
  local method="$1" url="$2"; shift 2
  curl -s -m 25 -o /tmp/cm_body.$$ -w '%{http_code}' -X "$method" "$url" "$@" 2>/dev/null
  local code=$?
  if [ $code -ne 0 ]; then echo "000"; return; fi
}
http_secret() {
  local method="$1" url="$2"
  python3 -c '
import json
import ssl
import sys
import urllib.error
import urllib.request

method, url, output = sys.argv[1:4]
spec = json.load(sys.stdin)
headers = spec.get("headers", {})
headers = {str(key): str(value) for key, value in headers.items()}
headers.setdefault("content-type", "application/json")
headers.setdefault("accept", "application/json")
headers.setdefault("user-agent", "CloudMailVerifier/1.0")
headers.setdefault("x-cloudmail-verifier", "verify-sh")
body = spec.get("body")
data = None
if body is not None:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
request = urllib.request.Request(url, data=data, headers=headers, method=method)
context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
try:
    with urllib.request.urlopen(request, timeout=25, context=context) as response:
        payload = response.read()
        status = response.getcode()
except urllib.error.HTTPError as exc:
    payload = exc.read()
    status = exc.code
except Exception:
    payload = b""
    status = 0
with open(output, "wb") as handle:
    handle.write(payload)
print(f"{status:03d}")
' "$method" "$url" "/tmp/cm_body.$$"
}
body() { cat /tmp/cm_body.$$ 2>/dev/null; }
json_code() { grep -o '"code":[0-9]*' /tmp/cm_body.$$ 2>/dev/null | head -1 | cut -d: -f2; }
json_string() {
  local key="$1"
  grep -o "\"${key}\":\"[^\"]*\"" /tmp/cm_body.$$ 2>/dev/null | head -1 | cut -d: -f2- | sed 's/^"//;s/"$//'
}
json_nested_string() {
  local key="$1"
  python3 - "$key" /tmp/cm_body.$$ <<'PY'
import json
import sys

key, path = sys.argv[1:3]
try:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception:
    sys.exit(0)
value = payload.get(key) if isinstance(payload, dict) else None
if value is None and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
    value = payload["data"].get(key)
if isinstance(value, str):
    print(value)
PY
}
json_bool() {
  local key="$1"
  grep -o "\"${key}\":\\(true\\|false\\)" /tmp/cm_body.$$ 2>/dev/null | head -1 | cut -d: -f2
}

echo "=============================================================="
echo " CloudMail OS verify.sh"
echo " backend : ${BASE_URL}"
echo " domain  : ${DOMAIN}"
echo " device  : REQUIRE_DEVICE=${REQUIRE_DEVICE}"
echo " auth    : REQUIRE_AUTH=${REQUIRE_AUTH}"
echo " gmail   : REQUIRE_GMAIL=${REQUIRE_GMAIL}"
echo " attach  : REQUIRE_SAME_DOMAIN_ATTACH=${REQUIRE_SAME_DOMAIN_ATTACH}"
echo "=============================================================="

# ---------------------------------------------------------------------------
echo ""
echo "[1] Backend identity — is this the REAL mail-worker (not the stub)?"
# The real mail-worker exposes /api/auth/email-discovery (cloudmail-v2).
# The stub worker (worker/src/worker.ts) does NOT define it -> 404.
HC="$(http GET "${BASE_URL}/api/auth/email-discovery?email=probe@${DOMAIN}")"
B="$(body)"
if [ "$HC" = "200" ] && echo "$B" | grep -q '"domainManaged"'; then
  ok "real backend confirmed (v2 discovery route live)"
elif [ "$HC" = "404" ]; then
  bad "backend is the STUB or wrong origin (/api/auth/email-discovery -> 404). App must point at the real mail-worker."
else
  bad "backend identity unclear (HTTP ${HC}). body: $(echo "$B" | head -c 200)"
fi

# v2 protected route must exist and be auth-gated (401), not missing (404).
HC="$(http GET "${BASE_URL}/api/v2/ai/providers")"
B="$(body)"
BC="$(json_code)"
if [ "$HC" = "200" ] && [ "$BC" = "401" ]; then
  ok "v2 routes present and protected (/api/v2/ai/providers -> body.code 401)"
elif [ "$HC" = "404" ]; then
  bad "v2 routes missing (/api/v2/ai/providers -> 404). Stub or undeployed v2."
else
  bad "v2 route returned unexpected HTTP ${HC}, body.code ${BC:-none}"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[2] CloudMail accounts — discovery returns a real, sane status"
for acct in "${ACCOUNTS[@]}"; do
  HC="$(http GET "${BASE_URL}/api/auth/email-discovery?email=${acct}")"
  B="$(body)"
  status="$(json_string accountStatus)"
  if [ "$HC" = "200" ] && [ -n "$status" ] && [ "$status" != "not_found" ]; then
    ok "${acct} -> ${status}"
  else
    bad "${acct} -> discovery failed (HTTP ${HC}, status='${status:-none}')"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "[3] Gmail discovery reality — public discovery must not fake domain ownership"
HC="$(http GET "${BASE_URL}/api/auth/email-discovery?email=saercpku@gmail.com")"
B="$(body)"
BC="$(json_code)"
managed="$(json_bool domainManaged)"
if [ "$BC" = "429" ]; then
  bad "gmail.com discovery was rate limited (body.code 429) — retry later before claiming Gmail discovery truth"
elif [ "$managed" = "false" ]; then
  ok "gmail.com correctly unmanaged by Cloudflare discovery"
else
  bad "gmail.com reported domainManaged=${managed} — public discovery is confusing Gmail with managed Cloudflare mail"
fi

echo ""
echo "[3b] Gmail authorization model — Gmail is scoped per CloudMail identity"
if command -v npx >/dev/null 2>&1 && [ -d "platform/cloud-mail/mail-worker" ]; then
  D1_SCOPE_GAPS="$(
    cd platform/cloud-mail/mail-worker && \
    npx wrangler d1 execute cloud-mail --remote --command \
      "SELECT account.account_id AS account_id FROM account LEFT JOIN mail_provider_credentials ON mail_provider_credentials.user_id = account.user_id AND mail_provider_credentials.account_id = account.account_id AND mail_provider_credentials.provider = 'gmail' WHERE account.provider = 'gmail' AND account.is_del = 0 AND (account.user_id IS NULL OR mail_provider_credentials.id IS NULL) LIMIT 1;" 2>/tmp/cm_d1_owner_err.$$
  )"
  D1_STATUS=$?
  if [ $D1_STATUS -ne 0 ]; then
    bad "could not verify production Gmail per-identity authorization via D1"
  elif echo "$D1_SCOPE_GAPS" | grep -q '"account_id"'; then
    bad "production D1 has active Gmail accounts without scoped per-identity credentials"
  else
    ok "production D1 Gmail authorizations are scoped per CloudMail identity"
  fi
else
  bad "wrangler/npx or mail-worker checkout unavailable — Gmail per-identity authorization NOT proven"
fi

# ---------------------------------------------------------------------------
echo ""
echo "[4] Authenticated round-trip — REQUIRE_AUTH=${REQUIRE_AUTH}, REQUIRE_GMAIL=${REQUIRE_GMAIL}"
if [ -n "${CLOUDMAIL_DEVICE_EMAIL:-}" ] && [ -n "${CLOUDMAIL_DEVICE_PASSWORD:-}" ]; then
  HC="$(printf '{"headers":{"content-type":"application/json"},"body":{"email":%s,"password":%s}}\n' \
        "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_DEVICE_EMAIL"]))')" \
        "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_DEVICE_PASSWORD"]))')" |
        http_secret POST "${BASE_URL}/api/login")"
  B="$(body)"
  TOKEN="$(json_nested_string token)"
  if [ "$HC" = "200" ] && [ -n "$TOKEN" ]; then
    ok "login succeeded for supplied CloudMail credential"
    HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
          TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/v2/ai/providers")"
    B="$(body)"
    BC="$(json_code)"
    if [ "$HC" = "200" ] && [ "$BC" = "200" ]; then ok "authenticated /api/v2/ai/providers -> body.code 200"
    else bad "authenticated providers call failed (HTTP ${HC}, body.code ${BC:-none})"; fi
    HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
          TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/account/list")"
    B="$(body)"
    BC="$(json_code)"
    if [ "$HC" = "200" ] && [ "$BC" = "200" ]; then ok "authenticated /api/account/list -> body.code 200"
    else bad "authenticated account list failed (HTTP ${HC}, body.code ${BC:-none})"; fi

    HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
          TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/email/list?allReceive=1&size=5&type=0")"
    B="$(body)"
    BC="$(json_code)"
    if [ "$HC" = "200" ] && [ "$BC" = "200" ] &&
       echo "$B" | grep -q '"provider"' &&
       echo "$B" | grep -q '"accountEmail"' &&
       echo "$B" | grep -q '"accountDomain"' &&
       echo "$B" | grep -q '"threadId"'; then
      ok "authenticated /api/email/list includes provider/account/domain/thread source metadata"
    else
      bad "authenticated email list missing source metadata (HTTP ${HC}, body.code ${BC:-none})"
    fi

    if [ -n "${CLOUDMAIL_ATTACH_EMAIL:-}" ] && [ -n "${CLOUDMAIL_ATTACH_PASSWORD:-}" ]; then
      HC="$(printf '{"headers":{"authorization":%s,"content-type":"application/json"},"body":{"email":%s,"password":%s}}\n' \
            "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" \
            "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_ATTACH_EMAIL"]))')" \
            "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_ATTACH_PASSWORD"]))')" |
            TOKEN="$TOKEN" http_secret POST "${BASE_URL}/api/v2/mailbox-authorizations")"
      B="$(body)"
      BC="$(json_code)"
      if [ "$HC" = "200" ] && [ "$BC" = "200" ] &&
         echo "$B" | grep -q '"currentUserChanged":false' &&
         echo "$B" | grep -q '"ownerAccountId"'; then
        ok "same-domain mailbox authorized without switching current CloudMail user"
        OWNER_ACCOUNT_ID="$(python3 - /tmp/cm_body.$$ <<'PY'
import json, sys
try:
    payload = json.load(open(sys.argv[1], encoding='utf-8'))
    print(payload.get('data', {}).get('ownerAccountId') or '')
except Exception:
    print('')
PY
)"
        HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
              TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/v2/accounts")"
        B="$(body)"
        BC="$(json_code)"
        if [ "$HC" = "200" ] && [ "$BC" = "200" ] && echo "$B" | grep -q '"delegated":true'; then
          ok "authorized same-domain mailbox appears in /api/v2/accounts as delegated"
        else
          bad "authorized same-domain mailbox was not visible as delegated in /api/v2/accounts (HTTP ${HC}, body.code ${BC:-none})"
        fi
        if [ -n "$OWNER_ACCOUNT_ID" ]; then
          HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
                TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/email/list?accountId=${OWNER_ACCOUNT_ID}&allReceive=0&size=5&type=0")"
          B="$(body)"
          BC="$(json_code)"
          if [ "$HC" = "200" ] && [ "$BC" = "200" ] && echo "$B" | grep -q '"accountEmail"'; then
            ok "authorized same-domain delegated mailbox is readable through /api/email/list"
          else
            bad "authorized same-domain delegated mailbox was not readable through /api/email/list (HTTP ${HC}, body.code ${BC:-none})"
          fi
        else
          bad "same-domain authorization did not return an owner account id"
        fi
      else
        bad "same-domain mailbox authorization failed (HTTP ${HC}, body.code ${BC:-none})"
      fi
    else
      if [ "$REQUIRE_SAME_DOMAIN_ATTACH" = "1" ]; then
        bad "no CLOUDMAIL_ATTACH_EMAIL/PASSWORD set — same-domain Add/Attach mailbox NOT proven"
      else
        skip "no CLOUDMAIL_ATTACH_EMAIL/PASSWORD set — same-domain Add/Attach mailbox NOT proven"
      fi
    fi

    if [ -n "${CLOUDMAIL_GMAIL_EMAIL:-}" ] && [ -n "${CLOUDMAIL_GMAIL_APP_PASSWORD:-}" ]; then
      HC="$(printf '{"headers":{"authorization":%s,"content-type":"application/json"},"body":{"email":%s,"appPassword":%s}}\n' \
            "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" \
            "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_GMAIL_EMAIL"]))')" \
            "$(python3 -c 'import json,os; print(json.dumps(os.environ["CLOUDMAIL_GMAIL_APP_PASSWORD"]))')" |
            TOKEN="$TOKEN" http_secret POST "${BASE_URL}/api/gmail/connect")"
      B="$(body)"
      BC="$(json_code)"
      if [ "$HC" = "200" ] && [ "$BC" = "200" ] &&
         echo "$B" | grep -q '"provider":"gmail"' &&
         echo "$B" | grep -q '"status":"connected"'; then
        ok "Gmail IMAP connected and initial sync returned connected status"
        HC="$(printf '{"headers":{"authorization":%s}}\n' "$(TOKEN="$TOKEN" python3 -c 'import json,os; print(json.dumps(os.environ["TOKEN"]))')" |
              TOKEN="$TOKEN" http_secret GET "${BASE_URL}/api/email/list?allReceive=1&provider=gmail&size=5&type=0")"
        B="$(body)"
        BC="$(json_code)"
        if [ "$HC" = "200" ] && [ "$BC" = "200" ] && echo "$B" | grep -q '"provider":"gmail"'; then
          ok "Gmail mail is visible through /api/email/list provider=gmail"
        else
          bad "Gmail connected but Gmail messages were not visible through the unified inbox API (HTTP ${HC}, body.code ${BC:-none})"
        fi
      else
        bad "Gmail IMAP connect failed (HTTP ${HC}, body.code ${BC:-none})"
      fi
    else
      if [ "$REQUIRE_GMAIL" = "1" ]; then
        bad "no CLOUDMAIL_GMAIL_EMAIL/APP_PASSWORD set — real Gmail IMAP sync NOT proven"
      else
        skip "no CLOUDMAIL_GMAIL_EMAIL/APP_PASSWORD set — real Gmail IMAP sync NOT proven"
      fi
    fi
  else
    bad "login failed for supplied CloudMail credential (HTTP ${HC})"
  fi
else
  if [ "$REQUIRE_AUTH" = "1" ]; then
    bad "no CLOUDMAIL_DEVICE_EMAIL/PASSWORD set — auth loop NOT proven"
  else
    skip "no CLOUDMAIL_DEVICE_EMAIL/PASSWORD set — auth loop NOT proven (set them to fully close Loop 1)"
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "[5] Device gate — PASS requires explicit, fresh, parsed current evidence"
if [ "$REQUIRE_DEVICE" = "0" ]; then
  skip "REQUIRE_DEVICE=0 — device gate intentionally skipped (NOT a product PASS)"
else
  ROOT="$(cd "$(dirname "$0")" && pwd)"
  if [ -n "$DEVICE_XCRESULT" ]; then
    case "$DEVICE_XCRESULT" in
      /*) XCRESULT="$DEVICE_XCRESULT" ;;
      *) XCRESULT="$ROOT/$DEVICE_XCRESULT" ;;
    esac
  else
    XCRESULT=""
  fi
  if [ -z "$XCRESULT" ]; then
    bad "DEVICE_XCRESULT is required. Run the current device test first and pass its result bundle explicitly:
        xcodebuild test \\
          -project acceptance/CloudMailDeviceAcceptance/CloudMailDeviceAcceptance.xcodeproj \\
          -scheme AcceptanceHost \\
          -destination 'platform=iOS,name=<YOUR_IPHONE>' \\
          -resultBundlePath artifacts/loop5-current-validation/CloudMail-Gmail-Real-iPhone-Current.xcresult

        DEVICE_XCRESULT=artifacts/loop5-current-validation/CloudMail-Gmail-Real-iPhone-Current.xcresult ./verify.sh"
  elif [ ! -d "$XCRESULT" ]; then
    bad "DEVICE_XCRESULT does not exist: ${XCRESULT}"
  elif ! command -v xcrun >/dev/null 2>&1; then
    bad "found ${XCRESULT} but xcrun is unavailable (run verify.sh on the Mac that built it)"
  else
    NOW="$(date +%s)"
    MTIME="$(stat -f '%m' "$XCRESULT" 2>/dev/null || echo 0)"
    AGE=$((NOW - MTIME))
    if [ "$AGE" -gt "$DEVICE_EVIDENCE_MAX_AGE_SECONDS" ]; then
      bad "device evidence is stale (${AGE}s old, max ${DEVICE_EVIDENCE_MAX_AGE_SECONDS}s): ${XCRESULT##*/}"
    fi

    SUMMARY="$(xcrun xcresulttool get test-results summary --path "$XCRESULT" 2>/dev/null \
               || xcrun xcresulttool get --format json --path "$XCRESULT" 2>/dev/null)"
    FAILED="$(echo "$SUMMARY" | grep -o '"failedTests"[^,]*' | grep -o '[0-9]\+' | head -1)"
    PASSED="$(echo "$SUMMARY" | grep -o '"passedTests"[^,]*' | grep -o '[0-9]\+' | head -1)"
    SKIPPED="$(echo "$SUMMARY" | grep -o '"skippedTests"[^,]*' | grep -o '[0-9]\+' | head -1)"
    PLATFORM="$(echo "$SUMMARY" | grep -o '"platform"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"platform"[[:space:]]*:[[:space:]]*"//;s/"$//')"
    DEVICE_NAME="$(echo "$SUMMARY" | grep -o '"deviceName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"deviceName"[[:space:]]*:[[:space:]]*"//;s/"$//')"
    DEVICE_GATE_BLOCKED=0
    if [ "$AGE" -gt "$DEVICE_EVIDENCE_MAX_AGE_SECONDS" ]; then
      DEVICE_GATE_BLOCKED=1
    fi
    if [ "$REQUIRE_REAL_DEVICE" = "1" ] && echo "$PLATFORM" | grep -qi 'Simulator'; then
      DEVICE_GATE_BLOCKED=1
      bad "device evidence is simulator evidence (${DEVICE_NAME:-unknown}, ${PLATFORM:-unknown}); real iPhone evidence required"
    fi
    if [ -n "$SKIPPED" ] && [ "$SKIPPED" != "0" ]; then
      DEVICE_GATE_BLOCKED=1
      bad "device tests include skipped tests (${SKIPPED}); skipped auth/device validation is not certification"
    fi
    if [ -n "$FAILED" ] && [ "$FAILED" = "0" ] && [ -n "$PASSED" ] && [ "$PASSED" -gt 0 ] &&
       { [ -z "$SKIPPED" ] || [ "$SKIPPED" = "0" ]; } &&
       { [ "$REQUIRE_REAL_DEVICE" != "1" ] || ! echo "$PLATFORM" | grep -qi 'Simulator'; } &&
       [ "$DEVICE_GATE_BLOCKED" = "0" ]; then
      ok "device tests: ${PASSED} passed / 0 failed (${XCRESULT##*/})"
    else
      bad "device tests not green/current (passed='${PASSED:-?}' failed='${FAILED:-?}' skipped='${SKIPPED:-?}' platform='${PLATFORM:-?}') in ${XCRESULT##*/}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "=============================================================="
echo " RESULT  pass=${PASS_COUNT}  fail=${FAIL_COUNT}  skip=${SKIP_COUNT}"
if [ "$FAIL_COUNT" -eq 0 ] && [ "$PASS_COUNT" -gt 0 ]; then
  echo " => $(green PASS)"
  echo "=============================================================="
  exit 0
else
  echo " => $(red FAIL)"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
  echo "=============================================================="
  exit 1
fi
