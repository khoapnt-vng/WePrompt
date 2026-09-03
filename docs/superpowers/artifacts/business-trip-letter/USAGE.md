# Business-trip Letter assistant — usage / hướng dẫn

## For the user (Vy) / Dành cho người dùng
1. New chat → chọn assistant **"Thư cử công tác / Business-trip Letter"**.
2. Tải lên 3 tệp: (a) ảnh hộ chiếu, (b) thư mời PDF, (c) ảnh chụp hồ sơ Teams của nhân viên.
3. Kiểm tra bảng tóm tắt, xác nhận **công ty (entity)** và **ngày công tác**; nhập ngày nghỉ phép nếu cần.
4. Mở tệp `.docx` được tạo, kiểm tra các mục được đánh dấu, rồi chuyển C&B ký. / Open the generated `.docx`, check flagged items, then route to C&B for signature.

> The assistant DRAFTS only. A human must review and sign. / Assistant chỉ tạo bản nháp; người phải kiểm tra và ký.

## Data to verify (owner: HR/legal) / Dữ liệu cần xác minh
- `reference/entities.json`: every entity has `"verified": false` until head office, tel, scope, and signatory are confirmed. Set `"verified": true` once checked.

## Share with a teammate / Chia sẻ cho đồng nghiệp
1. Send them the whole `business-trip-letter/` folder.
2. They: **Settings → Skills → Import** → select the folder.
3. They: open the **Assistants** panel from the **main left sidebar** (👻 ghost icon, tooltip "Assistants" — NOT in Settings) → **Create** (or duplicate an office assistant), then set rules, pin skill + `greennode-idp` + `aionui-image-analysis` + officecli-docx, fixed model, starter prompt.
   (There is no one-click "share assistant" yet — this is the v1 path.)

## Known limitations
- Requires the `officecli` binary + `greennode-idp` + Kimi vision MCPs enabled.
- Passport OCR from a phone photo can misread; the invitation cross-check catches most errors — always review.
- <record dry-run result + officecli fill mode from Task 5 here>
