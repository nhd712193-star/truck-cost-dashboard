# Deployment Guide

Mục tiêu dài hạn:

```text
GitHub: lưu code dashboard
Vercel: host login page, dashboard page handler, serverless API
Cloudflare R2: lưu data private; browser chỉ đọc bằng signed URL ngắn hạn
Google Drive: lưu backup/staging output nội bộ
```

## 1. GitHub

Repo production:

```text
https://github.com/nhd712193-star/truck-cost-dashboard
```

Quy tắc:

- Chỉ commit code, docs, scripts, config mẫu.
- Không commit `data/`.
- Không commit `.env.r2`, token, access key, secret key.

Kiểm tra remote:

```bash
git remote -v
git status --short --branch
```

Push code:

```bash
git add .
git commit -m "Your message"
git push origin main
```

## 2. Vercel

Production URL:

```text
https://truck-cost-dashboard.vercel.app
```

Project settings:

```text
Framework Preset: Other
Root Directory: .
Build Command: empty
Output Directory: empty hoặc .
Install Command: empty
```

Vercel deploy tự động khi push `main` lên GitHub.

`vercel.json` nằm ở project root và cấu hình rewrite `/` qua `/api/page`, rewrite
`/api/data/*` qua signer, include private HTML templates, và security headers.

Production env bắt buộc:

```text
GOOGLE_CLIENT_ID
ALLOWED_DOMAIN=ghn.vn
SESSION_SECRET
FIREBASE_SERVICE_ACCOUNT_JSON
BOOTSTRAP_ADMIN_EMAILS
AUTO_PROVISION_USERS=false
R2_ACCOUNT_ID
R2_BUCKET=b2b-truck-cost-dashboard
R2_PREFIX=prod
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_SIGNED_URL_TTL_SECONDS=180
APP_ORIGIN=https://truck-cost-dashboard.vercel.app
```

## 3. Cloudflare R2

Bucket:

```text
b2b-truck-cost-dashboard
```

Bucket phải private. Không bật public access cho bucket hoặc prefix production.
Browser không gọi `pub-*.r2.dev`; browser chỉ nhận signed URL từ `/api/data`.

CORS chỉ cho phép origin dashboard đọc signed URL. File cấu hình Wrangler nằm ở:

```text
config/r2-cors.json
```

Nếu dùng Wrangler:

```bash
npx wrangler r2 bucket cors set b2b-truck-cost-dashboard --file config/r2-cors.json
```

Sau khi đổi CORS/public access, purge cache Cloudflare nếu trước đó bucket từng
được public. Rotate R2 access key nếu URL hoặc credential từng bị chia sẻ ngoài
máy local/Vercel env.

## 4. Prepare And Upload Data

Tạo snapshot local từ pipeline output:

```bash
cd "/Users/nguyendung/Documents/Mở rộng B2B/truck_cost_dashboard"
node scripts/prepare_static_data.mjs
```

Upload lên R2:

```bash
bash scripts/upload_r2_data.sh
```

Script upload sẽ:

- chạy `prepare_static_data.mjs`;
- upload toàn bộ `data/` lên R2 prefix `prod`;
- xoá object legacy `prod/rollups/order_index.csv.gz` nếu còn tồn tại.

## 5. Verify

Chạy kiểm tra nhanh:

```bash
bash scripts/verify_deployment.sh
```

Hoặc kiểm tra thủ công:

```bash
curl -I https://truck-cost-dashboard.vercel.app/
curl -I https://truck-cost-dashboard.vercel.app/api/data/manifest.json
SESSION_COOKIE="<truck_cost_session cookie value>" \
  bash scripts/verify_deployment.sh
```

Kết quả tốt:

- `/` trả login page khi chưa đăng nhập hoặc dashboard khi cookie hợp lệ.
- `/api/data/manifest.json` trả `401` khi chưa đăng nhập.
- Khi có cookie hợp lệ, `/api/data/...` trả `307` đến `*.r2.cloudflarestorage.com`
  với `X-Amz-Signature`.
- `app.js` không chứa public R2 URL hoặc `dataBase`.

## References

- Cloudflare R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
- Vercel `vercel.json`: https://vercel.com/docs/project-configuration/vercel-json
