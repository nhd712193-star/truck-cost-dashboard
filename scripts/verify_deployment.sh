#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://truck-cost-dashboard.vercel.app}"
TEST_ORDER_INDEX="${TEST_ORDER_INDEX:-rollups/order_index/month=2026-04.csv.gz}"
SESSION_COOKIE="${SESSION_COOKIE:-}"

echo "Checking Vercel app..."
curl -fsSI "$APP_URL/" | grep -Eqi '^HTTP/.* 200'

echo "Checking production app bundle..."
curl -fsSL "$APP_URL/app.js" | grep -q 'order_index_partitions'
if curl -fsSL "$APP_URL/app.js" | grep -Eq 'pub-[a-z0-9]+\.r2\.dev|dataBase'; then
  echo "app.js still exposes public R2/dataBase override" >&2
  exit 1
fi

echo "Checking unauthenticated data API is blocked..."
UNAUTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/api/data/manifest.json")"
test "$UNAUTH_STATUS" = "401"

if [[ -n "$SESSION_COOKIE" ]]; then
  echo "Checking authenticated data API issues a short-lived R2 signed redirect..."
  curl -fsSI -H "Cookie: truck_cost_session=$SESSION_COOKIE" "$APP_URL/api/data/$TEST_ORDER_INDEX" \
    | grep -Eqi '^location: https://[^/]+\.r2\.cloudflarestorage\.com/.+X-Amz-Signature='
else
  echo "Skipping authenticated data API check. Set SESSION_COOKIE to verify signed redirects."
fi

echo "Deployment verification passed."
