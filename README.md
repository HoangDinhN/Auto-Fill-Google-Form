# Random Form Filler

Chrome extension điền đáp án ngẫu nhiên cho Google Form đã cấu hình trong `manifest.json`.

## Tính năng

- Điền ngẫu nhiên câu trắc nghiệm, checkbox, danh sách thả xuống và bảng thang đo.
- Có thể giữ nguyên những câu đã trả lời.
- Mặc định tránh lựa chọn “Mục khác”.
- Chế độ tự động tiếp tục hoạt động dù Google Forms thay nội dung tại chỗ hoặc
  tải lại toàn bộ trang.
- Có chế độ điền và gửi liên tiếp `n` form (`1–50` lượt), kèm bước xác nhận
  trước khi bắt đầu.
- Có hai chế độ chọn đáp án: ngẫu nhiên hoàn toàn hoặc theo tỷ lệ phần trăm đã
  nhập trong file Word. Bật chế độ thứ hai bằng ô **Điền theo tỷ lệ phần trăm**.
- Tỷ lệ tích hợp sẵn luôn là cấu hình mặc định. Có thể bấm **Trích xuất từ
  Word** để nhập một cấu hình tạm thời mà không cần Python hoặc tải lại
  extension; bấm **Khôi phục mặc định** để quay về cấu hình ban đầu.
- Chế độ tỷ lệ lập lịch đáp án cho toàn bộ `n` lượt để kết quả tổng hợp gần tỷ
  lệ mục tiêu nhất. Với `n = 1`, chọn đáp án có tỷ lệ cao nhất; với `n = 2`, ưu
  tiên hai đáp án có tỷ lệ dương cao nhất.
- Bảng tiến trình nổi ở góc trên bên trái trang Google Form cập nhật theo thời
  gian thực số form đã gửi và trạng thái hiện tại.
- Chỉ được cấp quyền trên đúng biểu mẫu đã cấu hình.

## Cài đặt trên Chrome

1. Mở `chrome://extensions`.
2. Bật **Chế độ dành cho nhà phát triển** (Developer mode).
3. Chọn **Tải tiện ích đã giải nén** (Load unpacked).
4. Chọn thư mục chứa các file này.
5. Mở lại hoặc tải lại Google Form.

Nếu form đã mở trước khi extension được cài hoặc cập nhật, popup sẽ tự kết nối
lại với trang ở lần bấm đầu tiên; thông thường bạn không cần tải lại form.

## Sử dụng

- Bấm biểu tượng extension để mở tùy chọn.
- Nhập số lượt vào ô **Số form cần điền và gửi**, sau đó bấm nút chính để
  tự động điền, gửi và bắt đầu phản hồi tiếp theo.
- Nếu muốn dùng các tỷ lệ từ file Word, tích **Điền theo tỷ lệ phần trăm** trước
  khi bắt đầu. Extension dùng tỷ lệ mặc định cho đến khi bạn bấm **Trích xuất
  từ Word** và chọn một file `.docx` hợp lệ. Bỏ tích để quay lại chế độ chọn
  ngẫu nhiên.
- Theo dõi số form đã hoàn tất và giai đoạn đang chạy trên bảng tiến trình độc
  lập trong khoảng trống bên trái biểu mẫu.
- Sau mỗi lần gửi, background service worker trực tiếp mở lại trang đầu của
  form để tiếp tục lượt kế tiếp; không phụ thuộc nhãn hoặc cấu trúc của liên
  kết **Gửi ý kiến phản hồi khác**.
- Hỗ trợ cả URL Google Forms thông thường (`/forms/d/e/...`) và URL gắn với
  tài khoản đăng nhập (`/forms/u/0/d/e/...`).
- Trạng thái chạy được lưu trong `chrome.storage.local`; mỗi trang Google Form
  tự đọc trạng thái này và tiếp tục điền, không phụ thuộc background phát lệnh
  sau mỗi lần chuyển trang.
- Theo dõi thay đổi DOM của Google Forms để phát hiện trang xác nhận được thay
  nội dung tại chỗ và tiếp tục lượt kế tiếp.
- **Dừng tự động** hủy chế độ điền nhiều trang.

## Lưu ý

Extension được thiết kế để kiểm thử biểu mẫu. Không dùng để gửi dữ liệu giả, spam, hoặc làm sai lệch khảo sát mà bạn không được phép kiểm thử.

## Cập nhật tỷ lệ từ file Word

1. Sửa và lưu các con số phần trăm trong file Word theo đúng mẫu.
2. Mở popup extension và bấm **Trích xuất từ Word**.
3. Chọn file `.docx`. Extension sẽ kiểm tra đủ số câu, đủ số đáp án và tổng tỷ
   lệ của từng câu phải bằng 100%.
4. Cấu hình nhập từ Word được lưu trong Chrome và dùng cho các lần chạy tiếp
   theo. Không cần Python hoặc Reload extension.

Nút **Khôi phục mặc định** xóa cấu hình đã nhập và dùng lại tỷ lệ tích hợp sẵn
trong extension.
