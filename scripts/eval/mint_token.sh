#!/usr/bin/env bash
# mint_token.sh — print an OIDC id_token for the eval harness to send to /api/chat.
#
# Reuses the proven Authorization-Code+PKCE password flow against the Citrate
# authority. Parameterized by env so it works against any deployment:
#
#   AUTH_ISSUER    (default https://auth.citrate.ai)
#   CLIENT_ID      (default citrate-explorer)
#   EXPLORER_URL   (default https://explorer.citrate.ai)   # the registered redirect origin
#   EVAL_EMAIL     (default a random agt<rand>@citrate.test)
#   EVAL_PASSWORD  (default Testpass123)
#
# Modes:
#   ./mint_token.sh           # mint a real id_token via the authority
#   ./mint_token.sh --mock    # emit a base64url mock token (for local AUTH_MODE=mock)
#
# Prints ONLY the token to stdout (diagnostics go to stderr) so callers can:
#   EVAL_TOKEN="$(./scripts/eval/mint_token.sh)"
set -euo pipefail

AUTH_ISSUER="${AUTH_ISSUER:-https://auth.citrate.ai}"
CLIENT_ID="${CLIENT_ID:-citrate-explorer}"
EXPLORER_URL="${EXPLORER_URL:-https://explorer.citrate.ai}"
EVAL_EMAIL="${EVAL_EMAIL:-agt${RANDOM}${RANDOM}@citrate.test}"
EVAL_PASSWORD="${EVAL_PASSWORD:-Testpass123}"

if [[ "${1:-}" == "--mock" ]]; then
  # Mirrors the mock adapter token the server's mock verifier decodes:
  # base64url(JSON{sub, wallet_address}). Only valid when the app runs AUTH_MODE=mock.
  ADDR="${EVAL_MOCK_ADDRESS:-0x4250675f9015e65fc866f3a373f82bb9dfc000c6}"
  python3 - "$ADDR" <<'PY'
import base64, json, sys
addr = sys.argv[1].lower()
payload = json.dumps({"sub": f"mock:{addr}", "wallet_address": addr}).encode()
print(base64.urlsafe_b64encode(payload).decode().rstrip("="))
PY
  exit 0
fi

JAR="$(mktemp)"; HDR="$(mktemp)"
trap 'rm -f "$JAR" "$HDR"' EXIT

VER="$(openssl rand -hex 32)"
CH="$(printf '%s' "$VER" | openssl dgst -binary -sha256 | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
RUE="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('${EXPLORER_URL}/auth/callback',safe=''))")"

echo "mint_token: issuer=${AUTH_ISSUER} client=${CLIENT_ID} email=${EVAL_EMAIL}" >&2

curl -s -c "$JAR" "${AUTH_ISSUER}/auth?client_id=${CLIENT_ID}&response_type=code&scope=openid%20profile%20wallet&redirect_uri=${RUE}&state=s&nonce=n&code_challenge=${CH}&code_challenge_method=S256" -o /dev/null
REG="$(curl -s -b "$JAR" -c "$JAR" -X POST "${AUTH_ISSUER}/auth/password/register" -H 'content-type: application/json' --data "{\"email\":\"${EVAL_EMAIL}\",\"password\":\"${EVAL_PASSWORD}\"}")"
RESUME="$(printf '%s' "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("redirectTo",""))' 2>/dev/null || true)"
if [[ -z "$RESUME" ]]; then echo "mint_token: register did not return redirectTo: $REG" >&2; exit 1; fi

curl -s -b "$JAR" -c "$JAR" -L --max-redirs 10 -D "$HDR" -o /dev/null "$RESUME"
CODE="$(grep -i '^location:' "$HDR" | grep -oE 'code=[^&[:space:]]+' | head -1 | cut -d= -f2 || true)"
if [[ -z "$CODE" ]]; then echo "mint_token: no auth code in redirect" >&2; exit 1; fi

TOK="$(curl -s -X POST "${AUTH_ISSUER}/token" -H 'content-type: application/x-www-form-urlencoded' \
  --data "grant_type=authorization_code&code=${CODE}&redirect_uri=${EXPLORER_URL}/auth/callback&client_id=${CLIENT_ID}&code_verifier=${VER}")"
IDT="$(printf '%s' "$TOK" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id_token",""))' 2>/dev/null || true)"
if [[ -z "$IDT" ]]; then echo "mint_token: token exchange failed: $TOK" >&2; exit 1; fi

printf '%s' "$IDT"
