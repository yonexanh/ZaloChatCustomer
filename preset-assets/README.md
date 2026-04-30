# Thư viện ảnh mẫu

Đặt ảnh `.png`, `.jpg`, `.webp` anh muốn gửi nhanh vào thư mục này.

Ví dụ:

- `preset-assets/review-card.png`
- `preset-assets/check-out-note.jpg`

Sau đó mở file `preset-library.json` và điền thêm `imagePath` tương ứng, ví dụ:

```json
{
  "id": "nhac-danh-gia",
  "label": "Nhắc đánh giá Google Maps",
  "message": "Nội dung của anh",
  "imagePath": "preset-assets/review-card.png",
  "imageName": "review-card.png"
}
```

Sau khi sửa xong, vào `chrome://extensions` và bấm `Reload` extension để Chrome đọc file mới.
