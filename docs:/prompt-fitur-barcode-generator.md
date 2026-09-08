# Prompt untuk Copilot — Fitur Barcode Generator (mirip barcode-maker.com)

Salin seluruh isi di bawah ini dan tempelkan ke Copilot Chat / Copilot Agent di project RBA kamu.

---

## PROMPT

Saya sedang mengembangkan aplikasi bernama **RBA**. Saya ingin kamu membuatkan fitur baru: **Barcode Generator**, yang fungsinya meniru web `barcode-maker.com`, tapi dengan tampilan UI yang lebih modern. Ikuti spesifikasi berikut dengan detail, jangan ada fitur yang terlewat.

### 1. Layout Halaman (3 kolom / 3 panel)

Gunakan layout 3 kolom yang bisa di-resize (drag divider antar panel), responsif ke layout stack (atas-bawah) di mobile.

**Panel Kiri — "Select Barcode Format"**
- Kartu besar "Custom Barcode Design" sebagai opsi default/aktif (highlight warna beda saat dipilih).
- Search bar untuk mencari tipe barcode berdasarkan nama (real-time filter, contoh: ketik "128" langsung filter ke semua varian Code 128).
- Daftar tipe barcode dikelompokkan per kategori (accordion/section), minimal:
  - **Code 128**: Code 128, Code 128A, Code 128B, Code 128C, GS1-128
  - **EAN / UPC**: EAN-13, EAN-8, UPC-A, UPC-E
  - **Code 39 / Code 93**
  - **ITF (Interleaved 2 of 5)**
  - **MSI**
  - **Pharmacode**
  - **Codabar**
  - (Opsional lanjutan) **QR Code** dan **Data Matrix** sebagai kategori 2D terpisah.
- Tiap kartu tipe barcode menampilkan preview mini barcode + nama tipe di bawahnya (generate preview otomatis dari contoh value).
- Saat sebuah tipe dipilih, kartu tersebut ter-highlight dan value contoh menyesuaikan format tipe tsb.

**Panel Tengah — "Barcode Values"**
- Textarea besar berlabel "Barcode Values (one per line)" — setiap baris = satu barcode.
- Tombol "Import CSV" (icon upload) — parsing file CSV, setiap baris jadi satu barcode value.
- Tombol "Create sequence" — modal untuk generate rangkaian nilai otomatis (contoh: angka urut dari 000001 sampai 000100, dengan prefix/suffix opsional, padding zero, step increment).
- Teks bantuan di bawah textarea: instruksi bahwa user bisa menekan Tab setelah value untuk menambahkan caption custom, ATAU copy-paste 2 kolom dari Excel (kolom 1 = value barcode, kolom 2 = display text) langsung ke textarea dan otomatis terpisah dengan benar (parse tab-separated values).
- Section "Output":
  - Tombol icon "Copy" (copy hasil sebagai gambar/SVG ke clipboard).
  - Tombol "Print Labels" (generate halaman print-friendly berisi semua barcode dalam grid label siap print/PDF).
  - Area preview barcode yang di-generate secara real-time sesuai textarea (looping semua baris → looping semua barcode), ditampilkan dalam grid card putih dengan barcode + teks value/caption di bawahnya.

**Panel Kanan — "Options"**
- Toggle "Show Text" — tampil/sembunyikan teks value di bawah barcode.
- Input number "Maximum Display Width (px)".
- Input number "Barcode Height (px)".
- Input number "Barcode Margin (px)".
- (Opsional tambahan agar lebih lengkap dari kompetitor): opsi warna barcode, warna background, font size teks, alignment teks (left/center/right), rotasi barcode.
- Tombol besar "Download" dengan dropdown pilihan format: **SVG, PNG, PDF, JPEG**.
- Semua perubahan option langsung live-update ke preview di panel tengah tanpa reload.

### 2. Requirement Teknis

- Gunakan library **JsBarcode** untuk barcode 1D (Code 128, EAN, UPC, Code 39, ITF, MSI, Pharmacode, Codabar), dan **qrcode.react / bwip-js** untuk QR Code / Data Matrix jika opsional 2D diimplementasikan.
- Semua rendering barcode dilakukan client-side (real-time), tidak perlu request ke backend kecuali untuk fitur simpan riwayat (jika aplikasi RBA punya backend/database, tambahkan opsi "Save to history").
- Validasi otomatis: jika value tidak sesuai format tipe barcode yang dipilih (misal EAN-13 harus 12-13 digit angka), tampilkan pesan error inline di bawah baris yang bermasalah, jangan bikin crash.
- Export "Download" harus menghasilkan file sesuai jumlah value (1 value = 1 file, atau jika banyak value sekaligus, otomatis di-zip).
- Fitur "Print Labels" membuka layout khusus label (grid rapi, ukuran bisa disesuaikan seperti label Avery) lalu memanggil `window.print()` dengan CSS print media query khusus.
- Gunakan state management yang sudah dipakai di project RBA (misalnya React Context / Zustand / Redux — sesuaikan dengan stack yang sudah ada, cek dulu struktur project sebelum menambah dependency baru).
- Buat sebagai komponen modular: `BarcodeFormatSelector`, `BarcodeValueInput`, `BarcodeOutputPreview`, `BarcodeOptionsPanel`, agar mudah dipelihara dan dipakai ulang di halaman lain.

### 3. Requirement UI/UX (Modern Look)

- Ganti gaya flat lama menjadi lebih modern: rounded corner lebih besar (`rounded-2xl`), soft shadow, spacing lebih lega, dan gunakan warna aksen gradient (biru ke ungu) untuk tombol utama seperti "Download".
- Gunakan micro-interaction: hover state halus di kartu tipe barcode, transisi smooth saat toggle/slider berubah, skeleton loading saat preview barcode sedang di-generate untuk value dalam jumlah banyak.
- Gunakan font yang konsisten dengan design system RBA yang sudah ada (cek Tailwind config / theme project untuk warna & font yang konsisten, jangan bikin palet baru yang beda sendiri).
- Pastikan dark mode ikut didukung jika aplikasi RBA sudah punya dark mode.
- Tambahkan empty state yang menarik saat textarea "Barcode Values" masih kosong (ilustrasi + teks ajakan mengisi value pertama).

### 4. Struktur Kerja

1. Cek dulu struktur folder project RBA saat ini (routing, komponen shared, styling system yang dipakai) sebelum membuat file baru.
2. Install dependency yang dibutuhkan (`jsbarcode`, dan `qrcode.react` jika opsional QR ditambahkan).
3. Buat komponen-komponen sesuai pemisahan di atas.
4. Buat 1 halaman/route baru misalnya `/tools/barcode-generator` yang merangkai semua komponen.
5. Tambahkan entry menu/navigasi ke halaman baru ini di tempat menu fitur/tools yang sudah ada di RBA.
6. Test dengan minimal 3 tipe barcode berbeda dan pastikan Download + Print Labels berfungsi.

Tolong mulai dengan menjelaskan rencana implementasi singkat dan struktur file yang akan dibuat sebelum mulai coding, supaya saya bisa review dulu.

---
