# B2B Truck Cost Dashboard

Static dashboard cho chi phí thuê xe B2B Truck Last-mile, scope hiện tại là đơn
từ 15kg trở lên và loại chuyến `DELIVER`/`RETURN`.

## Chạy local

```bash
cd truck_cost_dashboard
/Users/nguyendung/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m http.server 5173
```

Mở:

```text
http://localhost:5173
```

Không nên mở trực tiếp bằng `file://` vì dashboard dùng `fetch` để đọc data.

## Data hiện tại

`data` là snapshot static dùng được cho local và Vercel. Snapshot này được tạo
từ output pipeline bằng:

```bash
node scripts/prepare_static_data.mjs
```

Dashboard không đọc raw monthly trực tiếp trên màn hình. App đọc các rollup trong:

```text
data/manifest.json
data/rollups/daily.csv.gz
data/rollups/province.csv.gz
data/rollups/ward.csv.gz
data/rollups/order_index/month=YYYY-MM.csv.gz
```

`order_index` dùng để đếm `Đơn unique` theo `order_code`. KPI đơn không cộng
`nb_orders`. Để dashboard mở nhanh hơn khi dữ liệu nhiều tháng, `order_index`
được chia theo tháng và khai báo trong `manifest.json` bằng
`order_index_partitions`.

Nếu pipeline sinh data mới, chạy lại lệnh prepare ở trên để refresh snapshot
trước khi deploy.

## Trạng thái UI hiện tại

- Dashboard có 2 tab: `Dashboard` và `READ ME`.
- Header hiển thị scope: `Truck Last-mile`, `Đơn >= 15kg`, `Giao/Trả hàng`.
- KPI đầu trang chỉ còn 3 thẻ: `Tổng chi phí`, `Chi phí/kg`, `Chi phí/đơn`.
- `Chi phí/kg` và `Chi phí/đơn` chỉ tính phần đã có cost.
- Map nhiệt theo chi phí/kg, có drilldown tỉnh -> quận/huyện.
- Khi chọn quận/huyện, panel bên phải hiển thị bảng phường/xã của quận/huyện đó.
- Chart thời gian hiện có:
  - `So sánh tháng gần nhất`: chi phí/kg theo các tháng gần nhất, chờ dữ liệu
    cùng kỳ năm trước.
  - `So sánh tuần gần nhất`: chi phí/kg theo 8 tuần gần nhất.
- Footer dashboard chỉ hiển thị thời điểm cập nhật, ví dụ:
  `Cập nhật: 30/05/2026 22:10.`

## Lưu ý data quality

Tháng 05/2026 hiện có đơn và kg nhưng `total_cost = 0` do file Excel cost chưa
cập nhật. Không hiểu đây là chi phí thực tế bằng 0.

Default filter đang chọn 3 tháng gần nhất đã có đủ cost. Với data hiện tại là:

```text
2026-02-01 -> 2026-04-30
```

## Chuẩn bị đưa lên Vercel

App deploy được như static site. Cấu hình nằm ở `vercel.json`.

Phương án đơn giản nhất cho bản đầu là deploy cả dashboard và snapshot `data/`
trong cùng Vercel app:

- Project root trên Vercel: `truck_cost_dashboard`.
- Framework preset: `Other`.
- Build command: để trống.
- Output directory: để trống hoặc `.`.
- Trước khi deploy, chạy `node scripts/prepare_static_data.mjs` để bảo đảm
  `data/` là folder thật, không phải symlink.

Các phương án host data khác:

- Host folder `data/` ở public object storage có CORS như Vercel Blob, R2, S3
  hoặc GCS.
- Deploy frontend static lên Vercel, rồi truyền data endpoint bằng query param.
- App hỗ trợ đổi data base bằng query param:

```text
?dataBase=https://example.com/path/to/data
```

Endpoint data cần phục vụ được các file `.csv.gz` để browser fetch và giải nén.
Không để browser đọc trực tiếp Google Drive private/local sync.

Rollup hiện tại khoảng vài chục MB. Phần nặng nhất là `order_index`, nhưng đã
được chia thành các file tháng:

```text
rollups/order_index/month=2026-02.csv.gz ~ 5.7 MB
rollups/order_index/month=2026-03.csv.gz ~ 9.4 MB
rollups/order_index/month=2026-04.csv.gz ~ 8.3 MB
rollups/order_index/month=2026-05.csv.gz ~ 7.9 MB
```

Dashboard chỉ tải các file tháng nằm trong filter ngày hiện tại. Nếu sau này
chọn cả 12 tháng vẫn chậm, bước tiếp theo là chia `order_index` nhỏ hơn nữa
theo tháng + tỉnh.
