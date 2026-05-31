#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://truck-cost-dashboard.vercel.app}"
DATA_BASE="${DATA_BASE:-https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod}"
TEST_ORDER_INDEX="${TEST_ORDER_INDEX:-rollups/order_index/month=2026-04.csv.gz}"

echo "Checking Vercel app..."
curl -fsSI "$APP_URL/" | grep -Eqi '^HTTP/.* 200'

echo "Checking production app bundle..."
curl -fsSL "$APP_URL/app.js" | grep -q 'order_index_partitions'

echo "Checking R2 manifest..."
curl -fsSL "$DATA_BASE/manifest.json" | grep -q 'order_index_partitions'

echo "Checking R2 CORS..."
curl -fsSI -H "Origin: $APP_URL" "$DATA_BASE/$TEST_ORDER_INDEX" \
  | grep -Eqi '^access-control-allow-origin:'

echo "Deployment verification passed."

