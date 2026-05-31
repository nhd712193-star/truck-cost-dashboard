# B2B Truck Cost Dashboard

Static dashboard cho chi phí thuê xe B2B Truck Last-mile.

## Current Production

| Area | Value |
|---|---|
| Dashboard | https://truck-cost-dashboard.vercel.app |
| GitHub | https://github.com/nhd712193-star/truck-cost-dashboard |
| Data host | Cloudflare R2 |
| Data base | `https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod` |

## Scope

- Đơn có `weight >= 15000` gram.
- Chỉ gồm `DELIVER` và `RETURN`.
- `PICK` chưa nằm trong scope hiện tại.
- `total_cost` là cost chính.
- `order_index` được chia theo tháng để dashboard không phải tải một file lớn.

## Folder Structure

```text
truck_cost_dashboard/
  index.html
  app.js
  styles.css
  vercel.json
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

Mở:

```text
http://localhost:5173
```

Không nên mở trực tiếp bằng `file://` vì dashboard dùng `fetch` để đọc data.

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

