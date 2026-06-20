# B2B Truck Cost Dashboard

Static dashboard cho chi phí thuê xe B2B Truck Last-mile.

## Current Production

| Area | Value |
|---|---|
| Dashboard | https://truck-cost-dashboard.vercel.app |
| GitHub | https://github.com/nhd712193-star/truck-cost-dashboard |
| Data host | Cloudflare R2 private bucket |
| Data access | Vercel `/api/data/*` checks session and redirects to short-lived R2 signed URLs |

## Access Gate

- Dashboard yêu cầu Google Sign-In bằng email `@ghn.vn` trước khi server trả dashboard shell và trước khi tải dữ liệu.
- Frontend dùng Google Identity Services, serverless function `/api/auth` xác thực ID token với Google.
- `/api/session` kiểm tra signed HttpOnly cookie. Production không tin `sessionStorage` để mở dashboard.
- `/api/data/*` kiểm tra quyền `dashboard`, allowlist path dữ liệu, rồi cấp R2 signed URL ngắn hạn.
- Nếu cấu hình Firebase service account, `/api/auth` sẽ đọc/ghi Firestore để quản lý user, role và audit login.
- Vercel env:
  - `GOOGLE_CLIENT_ID`
  - `ALLOWED_DOMAIN`
  - `SESSION_SECRET`
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `BOOTSTRAP_ADMIN_EMAILS`, ví dụ `admin@ghn.vn,owner@ghn.vn`
  - `AUTO_PROVISION_USERS=false` nếu muốn chặn user chưa có trong Firestore.
  - `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PREFIX`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
  - `R2_SIGNED_URL_TTL_SECONDS=180`
  - `APP_ORIGIN=https://truck-cost-dashboard.vercel.app`
- Trong Google Cloud OAuth, Authorized JavaScript origins phải có production URL của dashboard.
- Local static test không cần OAuth: mở `http://localhost:5173/api/_templates/dashboard.html?devAuth=1`.

Firestore collections:

```text
dashboard_users/{base64url(email)}
dashboard_audit_logs/{autoId}
```

## Scope

- Đơn có `weight >= 15000` gram.
- Chỉ gồm `DELIVER` và `RETURN`.
- `PICK` chưa nằm trong scope hiện tại.
- `total_cost` là cost chính.
- `order_index` được chia theo tháng để dashboard không phải tải một file lớn.

## Folder Structure

```text
truck_cost_dashboard/
  index.html          # login-only static fallback
  app.js
  login.js
  styles.css
  vercel.json
  api/
    data.js
    page.js
    session.js
    _templates/
      dashboard.html
      login.html
  assets/
    vietnam-districts.geojson.gz
    vietnam-provinces.geojson.gz
  config/
    r2-cors.json
    r2.env.example
  docs/
    PROJECT_OVERVIEW.md
    DEPLOYMENT.md
    OPERATIONS.md
  scripts/
    prepare_static_data.mjs
    upload_r2_data.py
    upload_r2_data.sh
    verify_deployment.sh
  data/              # local only, ignored by Git
  .env.r2            # local only, ignored by Git
```

## Run Local

```bash
cd "/Users/nguyendung/Documents/Mở rộng B2B/truck_cost_dashboard"
/Users/nguyendung/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m http.server 5173
```

Mở dashboard static local:

```text
http://localhost:5173/api/_templates/dashboard.html?devAuth=1
```

Không nên mở trực tiếp bằng `file://` vì dashboard dùng `fetch` để đọc data. Local static mode đọc `./data`; production đọc qua `/api/data`.

## Prepare Data

Tạo snapshot local từ pipeline output:

```bash
node scripts/prepare_static_data.mjs
```

Snapshot sẽ tạo:

```text
data/manifest.json
data/rollups/daily.csv.gz
data/rollups/province.csv.gz
data/rollups/ward.csv.gz
data/rollups/order_index/month=YYYY-MM.csv.gz
```

Upload snapshot lên Cloudflare R2:

```bash
bash scripts/upload_r2_data.sh
```

## Verify

```bash
node --check app.js
node --check scripts/prepare_static_data.mjs
python3 -m py_compile scripts/upload_r2_data.py
bash -n scripts/upload_r2_data.sh
bash -n scripts/verify_deployment.sh
bash scripts/verify_deployment.sh
```

## Docs

- [Project Overview](docs/PROJECT_OVERVIEW.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Operations Runbook](docs/OPERATIONS.md)
