# Operations Runbook

## Daily Update

Job 9h sáng nên chạy theo luồng:

```text
truck_cost_pipeline rolling 30 days
-> generate monthly files and rollups
-> truck_cost_dashboard prepare static data
-> upload dashboard data to Cloudflare R2
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
toàn bộ data 12 tháng. Nếu người dùng chọn cả 12 tháng, browser vẫn phải tải
12 partition tương ứng để có số đơn unique chính xác.

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

Mở:

```text
http://localhost:5173
```

Ép local đọc R2:

```text
http://localhost:5173?dataBase=https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod
```

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

- Kiểm tra `manifest.json` trên R2 mở được.
- Kiểm tra CORS có `Access-Control-Allow-Origin`.
- Kiểm tra browser console có lỗi fetch `.csv.gz`.
- Kiểm tra `app.js` production còn trỏ đúng `REMOTE_DATA_BASE`.

Nếu số `Chi phí/đơn` hiện `Đang tải...` lâu:

- Kiểm tra các file `rollups/order_index/month=YYYY-MM.csv.gz` tồn tại trên R2.
- Kiểm tra filter ngày có bao nhiêu tháng.
- Chọn khoảng ngày ngắn hơn để xác nhận partition loading hoạt động.

