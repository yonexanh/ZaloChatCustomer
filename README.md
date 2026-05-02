# Zalo Scheduler

Bản viết lại từ đầu theo hướng ổn định hơn cho nhu cầu:

- Hẹn giờ gửi tin nhắn cho khách hàng trên `https://chat.zalo.me/`
- Ảnh được lưu sẵn trong project, không cần chọn file thủ công
- Ưu tiên tránh gửi lặp hơn là cố gắng retry nhiều lần

## Kiến trúc mới

- `popup.html` / `popup.js`
  Popup gọn, chỉ giữ:
  - Lấy cuộc trò chuyện đang mở
  - Chọn preset trong `preset-library.json`
  - Sửa nội dung nếu cần
  - Chọn giờ gửi
  - Xem, gửi ngay, xóa lịch

- `background.js`
  Quản lý lịch bằng `chrome.storage.local` và `chrome.alarms`.
  Mỗi lịch chỉ có một execution lock. Nếu phiên cũ đang dở dang hoặc bị gián đoạn, app đánh dấu `failed` thay vì tự retry để tránh gửi trùng.

- `content.js`
  Chỉ giữ một luồng gửi duy nhất:
  1. Chọn đúng cuộc trò chuyện
  2. Gắn ảnh từ `preset-assets/`
  3. Chèn nội dung
  4. Bấm gửi đúng một lần
  5. Xác minh bằng DOM

## Cài đặt

1. Mở `chrome://extensions`
2. Bật `Developer mode`
3. Bấm `Load unpacked`
4. Chọn thư mục này: `/Users/mac/Documents/ZaloChatCus`
5. Reload extension nếu trước đó đã từng load bản cũ

## Cách dùng

1. Đăng nhập Zalo Web trên `https://chat.zalo.me/`
2. Mở đúng cuộc trò chuyện của khách
3. Mở extension và bấm `Lấy khách từ tab đang mở`
4. Chọn preset nếu muốn gửi ảnh / nội dung có sẵn
5. Chỉnh lại nội dung nếu cần
6. Chọn thời gian gửi và bấm `Lưu lịch gửi`

## Quản lý ảnh mẫu

- Đặt ảnh vào thư mục `preset-assets/`
- Khai báo trong `preset-library.json`
- Sau khi thêm ảnh mới hoặc sửa JSON, vào `chrome://extensions` và bấm `Reload`

Ví dụ:

```json
{
  "id": "nhac-checkout",
  "label": "Nhắc check out",
  "message": "Nội dung cần gửi",
  "imagePath": "preset-assets/anh-mau.png",
  "imageName": "anh-mau.png"
}
```

## Chú ý về độ ổn định

- Bản mới không còn upload file thủ công
- Không còn debugger, offscreen, clipboard flow, hay retry nhiều nhánh
- Nếu ô chat đang có bản nháp / ảnh chờ gửi, lịch sẽ `failed` thay vì cố gắng gửi để tránh nhầm lẫn
- Nếu Zalo đổi DOM, cần chỉnh selector trong `content.js`
