# Zalo Scheduler

Ban viet lai tu dau theo huong on dinh hon cho nhu cau:

- Hen gio gui tin nhan cho khach hang tren `https://chat.zalo.me/`
- Anh duoc luu san trong project, khong can chon file thu cong
- Uu tien tranh gui lap hon la co gang retry nhieu lan

## Kien truc moi

- `popup.html` / `popup.js`
  Popup gon, chi giu:
  - Lay cuoc tro chuyen dang mo
  - Chon preset trong `preset-library.json`
  - Sua noi dung neu can
  - Chon gio gui
  - Xem, gui ngay, xoa lich

- `background.js`
  Quan ly lich bang `chrome.storage.local` va `chrome.alarms`.
  Moi lich chi co mot execution lock. Neu phien cu dang do dang hoac bi gian doan, app danh dau `failed` thay vi tu retry de tranh gui trung.

- `content.js`
  Chi giu mot luong gui duy nhat:
  1. Chon dung cuoc tro chuyen
  2. Gan anh tu `preset-assets/`
  3. Chen noi dung
  4. Bam gui dung mot lan
  5. Xac minh bang DOM

## Cai dat

1. Mo `chrome://extensions`
2. Bat `Developer mode`
3. Bam `Load unpacked`
4. Chon thu muc nay: `/Users/mac/Documents/ZaloChatCus`
5. Reload extension neu truoc do da tung load ban cu

## Cach dung

1. Dang nhap Zalo Web tren `https://chat.zalo.me/`
2. Mo dung cuoc tro chuyen cua khach
3. Mo extension va bam `Lay khach tu tab dang mo`
4. Chon preset neu muon gui anh / noi dung co san
5. Chinh lai noi dung neu can
6. Chon thoi gian gui va bam `Luu lich gui`

## Quan ly anh mau

- Dat anh vao thu muc `preset-assets/`
- Khai bao trong `preset-library.json`
- Sau khi them anh moi hoac sua JSON, vao `chrome://extensions` va bam `Reload`

Vi du:

```json
{
  "id": "nhac-checkout",
  "label": "Nhac check out",
  "message": "Noi dung can gui",
  "imagePath": "preset-assets/checkout.png",
  "imageName": "checkout.png"
}
```

## Chu y ve do on dinh

- Ban moi khong con upload file thu cong
- Khong con debugger, offscreen, clipboard flow, hay retry nhieu nhanh
- Neu o chat dang co ban nhap / anh cho gui, lich se `failed` thay vi co gang gui de tranh nham lan
- Neu Zalo doi DOM, can chinh selector trong `content.js`
