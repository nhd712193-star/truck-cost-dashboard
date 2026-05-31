# Deployment Guide

Mục tiêu dài hạn:

```text
GitHub: lưu code dashboard
Vercel: host static app
Cloudflare R2: host data public cho dashboard đọc
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

`vercel.json` nằm ở project root và đang cấu hình header cho static assets. Theo
tài liệu Vercel, `vercel.json` là file cấu hình root cho headers, redirects,
build command và các thiết lập deployment khác.

## 3. Cloudflare R2

Bucket:

```text
b2b-truck-cost-dashboard
```

Public data base:

```text
https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod
```

CORS phải cho phép browser từ Vercel đọc object. File cấu hình Wrangler nằm ở:

```text
config/r2-cors.json
```

Cloudflare R2 hỗ trợ cấu hình CORS bằng dashboard hoặc Wrangler. Nếu dùng
Wrangler:

```bash
npx wrangler r2 bucket cors set b2b-truck-cost-dashboard --file config/r2-cors.json
```

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
curl -I https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod/manifest.json
curl -I -H "Origin: https://truck-cost-dashboard.vercel.app" \
  https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod/rollups/order_index/month=2026-04.csv.gz
```

Kết quả tốt:

- Vercel trả `HTTP 200`.
- R2 `manifest.json` trả `HTTP 200`.
- R2 object trả `Access-Control-Allow-Origin: *`.
- `manifest.json` có `order_index_partitions`.

## References

- Cloudflare R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
- Vercel `vercel.json`: https://vercel.com/docs/project-configuration/vercel-json

