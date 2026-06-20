# Operations Runbook

## Daily Update

Job 9h sáng nên chạy theo luồng:

```text
truck_cost_pipeline rolling 30 days
-> generate monthly files and rollups
-> truck_cost_dashboard prepare static data
-> upload dashboard data to private Cloudflare R2
-> user refreshes Vercel dashboard
```

Command dashboard:

```bash
cd "/Users/nguyendung/Documents/Mở rộng B2B/truck_cost_dashboard"
bash scripts/upload_r2_data.sh
```

Nếu chỉ đổi data, không cần deploy lại Vercel. Vercel chỉ cần deploy khi đổi
`index.html`, `app.js`, `styles.css`, assets, config hoặc docs.

## Backfill More Months

Khi backfill từ `2025-01-01` đến hiện tại:

1. Chạy pipeline theo từng chunk nhỏ để giảm rủi ro retry.
2. Kiểm tra rollup trong `truck_cost_pipeline/drive_output/data`.
3. Chạy `bash scripts/upload_r2_data.sh`.
4. Mở dashboard và chọn khoảng ngày cần xem.

Dashboard đã tối ưu `order_index` theo tháng, nên mở trang mặc định không tải
toàn bộ data 12 tháng. Browser chỉ tải partition qua `/api/data`, sau khi server
kiểm session/quyền và cấp signed URL ngắn hạn.

Tối ưu tiếp theo nếu 12 tháng vẫn chậm:

```text
rollups/order_index/month=YYYY-MM/province=<province>.csv.gz
```

Khi đó dashboard có thể tải theo `month + province`.

## Local Development

Chạy local:

```bash
cd "/Users/nguyendung/Documents/Mở rộng B2B/truck_cost_dashboard"
/Users/nguyendung/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m http.server 5173
```

Mở dashboard static local:

```text
http://localhost:5173/api/_templates/dashboard.html?devAuth=1
```

Local static mode đọc `./data`. Không còn tham số `dataBase` trong production.

## Quality Checks

Trước khi push code:

```bash
node --check app.js
node --check scripts/prepare_static_data.mjs
python3 -m py_compile scripts/upload_r2_data.py
bash -n scripts/upload_r2_data.sh
bash -n scripts/verify_deployment.sh
```

Sau khi upload data:

```bash
bash scripts/verify_deployment.sh
```

## Troubleshooting

Nếu dashboard trắng hoặc không có data:

- Kiểm tra `/api/session` trả `200` sau đăng nhập.
- Kiểm tra `/api/data/manifest.json` trả `307` khi có cookie hợp lệ.
- Kiểm tra R2 CORS chỉ allow origin dashboard, không dùng wildcard.
- Kiểm tra browser console có lỗi fetch `.csv.gz`.
- Kiểm tra Vercel env có đủ `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

Nếu số `Chi phí/đơn` hiện `Đang tải...` lâu:

- Kiểm tra các file `rollups/order_index/month=YYYY-MM.csv.gz` tồn tại trên R2.
- Kiểm tra filter ngày có bao nhiêu tháng.
- Chọn khoảng ngày ngắn hơn để xác nhận partition loading hoạt động.
