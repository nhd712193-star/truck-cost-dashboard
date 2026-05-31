# Truck Cost Dashboard Deployment Plan

Mục tiêu dài hạn:

```text
GitHub: lưu code dashboard
Vercel: host static app
Cloudflare R2: host data public cho dashboard đọc
Google Drive: lưu backup/staging output nội bộ
```

Lưu ý quan trọng: không commit `data/` lên GitHub. Thư mục `data/` chỉ dùng
để test local hoặc làm snapshot tạm thời.

Lưu ý về miễn phí: Vercel Hobby phù hợp cho personal/non-commercial use. Nếu
dashboard dùng chính thức trong công ty, cần kiểm tra chính sách nội bộ và điều
khoản Vercel. Phần data nên đặt ở Cloudflare R2 vì R2 có free tier riêng cho
storage/operations.

## 1. Cấu trúc production

Dashboard app trên Vercel chỉ chứa:

```text
index.html
app.js
styles.css
assets/
scripts/
vercel.json
```

Data production nằm trên Cloudflare R2:

```text
prod/manifest.json
prod/rollups/daily.csv.gz
prod/rollups/province.csv.gz
prod/rollups/ward.csv.gz
prod/rollups/order_index.csv.gz
```

Dashboard đọc data bằng query param trong giai đoạn đầu:

```text
https://your-dashboard.vercel.app?dataBase=https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod
```

R2 URL hiện đã được đặt làm default production trong `app.js`:

```text
https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod
```

Khi chạy local bằng `localhost`, dashboard vẫn mặc định đọc `./data`. Muốn ép
local đọc R2 thì mở:

```text
http://localhost:5173?dataBase=https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod
```

## 2. Thiết lập Cloudflare R2

1. Tạo Cloudflare account.
2. Vào `R2 Object Storage`.
3. Tạo bucket, ví dụ:

```text
b2b-truck-cost-dashboard
```

4. Bật public access.
   - Nếu chỉ test miễn phí ban đầu, có thể dùng public `r2.dev` URL.
   - Nếu dùng production ổn định, nên dùng custom domain/subdomain.

5. Thêm CORS policy cho bucket, cho phép dashboard đọc file. File cấu hình đã
   có sẵn tại:

```text
config/r2-cors.json
```

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["*"],
        "methods": ["GET", "HEAD"]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
```

## 3. Upload data lên R2

Từ project local, tạo snapshot data:

```bash
cd "/Users/nguyendung/Documents/Mở rộng B2B/truck_cost_dashboard"
node scripts/prepare_static_data.mjs
```

Sau đó upload `data/` lên R2 bằng script helper:

```bash
bash scripts/upload_r2_data.sh
```

Script này đọc credential từ file local `.env.r2`, tự tạo snapshot `data/`, rồi
upload các file cần thiết lên R2.

Nếu muốn dùng `rclone`, có thể sync tương đương:

```bash
rclone sync data r2:b2b-truck-cost-dashboard/prod
```

Kiểm tra các URL này mở được trên browser:

```text
https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod/manifest.json
https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod/rollups/daily.csv.gz
```

## 4. Deploy app lên Vercel qua GitHub

1. Tạo GitHub repo chỉ chứa code dashboard.
2. Không commit `data/`.
3. Import repo vào Vercel.
4. Cấu hình:

```text
Root Directory: .
Framework Preset: Other
Build Command: empty
Output Directory: empty hoặc .
```

5. Deploy.
6. Test URL:

```text
https://your-dashboard.vercel.app
```

Nếu cần override data endpoint để test:

```text
https://your-dashboard.vercel.app?dataBase=https://another-data-url/data
```

## 5. Job cập nhật 9h sáng

Luồng job nên là:

```text
pipeline rolling 30 days
-> generate monthly/rollups/manifest
-> node scripts/prepare_static_data.mjs
-> rclone sync data r2:b2b-truck-cost-dashboard/prod
```

Sau khi job upload xong, người dùng refresh dashboard là thấy data mới. Không
cần deploy lại Vercel nếu code dashboard không đổi.

## 6. Khi backfill từ 2025

Khi data nhiều lên, không đưa data vào Vercel/GitHub. Tiếp tục để data ở R2.

Nếu `order_index.csv.gz` quá lớn, bước tối ưu tiếp theo là chia theo tháng:

```text
prod/order_index/2025-01.csv.gz
prod/order_index/2025-02.csv.gz
...
```

Dashboard sẽ chỉ tải index của các tháng nằm trong filter, thay vì tải một file
`order_index.csv.gz` rất lớn.
