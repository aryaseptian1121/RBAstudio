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

### 4. Detail Engine / Logic Implementasi (WAJIB diikuti persis, jangan diimprovisasi)

**a. Struktur data internal**

Simpan setiap baris input sebagai objek, bukan string mentah:

```ts
type BarcodeEntry = {
  id: string;          // uuid, untuk key React & tracking error
  value: string;        // nilai barcode
  caption?: string;      // teks custom di bawah barcode (opsional)
  error?: string;        // pesan error validasi, null jika valid
};
```

Textarea "Barcode Values" adalah representasi teks dari array ini. Saat user mengetik, parse tiap baris:
- Split berdasarkan newline (`\n`) → tiap baris jadi 1 `BarcodeEntry`.
- Di tiap baris, jika ada karakter **tab** (`\t`), split lagi: bagian sebelum tab = `value`, bagian sesudah tab = `caption`.
- Saat generate string balik dari array ke textarea (misalnya setelah import CSV), gabungkan lagi pakai `\t` sebagai separator antara value dan caption, dan `\n` antar baris.

**b. Pemetaan tipe barcode (UI) → parameter JsBarcode**

Buat mapping object terpisah agar semua tipe konsisten:

```ts
const BARCODE_TYPE_MAP: Record<string, { jsBarcodeFormat: string; validate: (v: string) => string | null; example: string }> = {
  "code128":   { jsBarcodeFormat: "CODE128",  validate: validateAny,        example: "ABC-abc-1234" },
  "code128a":  { jsBarcodeFormat: "CODE128A", validate: validateUppercaseNumeric, example: "ABC123" },
  "code128b":  { jsBarcodeFormat: "CODE128B", validate: validateAny,        example: "Hello World!" },
  "code128c":  { jsBarcodeFormat: "CODE128C", validate: validateEvenDigits, example: "12345678" },
  "ean13":     { jsBarcodeFormat: "EAN13",    validate: validateDigits(12,13), example: "5901234123457" },
  "ean8":      { jsBarcodeFormat: "EAN8",     validate: validateDigits(7,8),   example: "96385074" },
  "upca":      { jsBarcodeFormat: "UPC",      validate: validateDigits(11,12), example: "042100005264" },
  "code39":    { jsBarcodeFormat: "CODE39",   validate: validateCode39Charset, example: "CODE39" },
  "itf14":     { jsBarcodeFormat: "ITF14",    validate: validateEvenDigits,    example: "10012345000017" },
  "msi":       { jsBarcodeFormat: "MSI",      validate: validateDigitsOnly,    example: "1234567" },
  "pharmacode":{ jsBarcodeFormat: "pharmacode", validate: validateNumericRange(3, 131070), example: "12345" },
  "codabar":   { jsBarcodeFormat: "codabar",  validate: validateCodabarCharset, example: "A123456A" },
};
```

- **GS1-128** perlu penanganan khusus: sebelum di-render, parse Application Identifier (AI) di dalam kurung, contoh input `(01)09521234543213(3103)000123`, lalu format ulang string sesuai standar GS1 (tambahkan FNC1 di awal via opsi `{ fontOptions: "", flat: false }` pada JsBarcode dengan format `"CODE128"`, dan sisipkan karakter FNC1 `\u00f1` di posisi AI). Buat fungsi terpisah `parseGS1Input(raw: string): string`.
- **QR Code / Data Matrix** tidak lewat JsBarcode — route ke komponen render berbeda (`qrcode.react` untuk QR, `bwip-js` dengan `bcid: "datamatrix"` untuk Data Matrix).

**c. Fungsi validasi (helper, buat betulan bukan placeholder)**

Contoh implementasi nyata, bukan stub:

```ts
const validateDigits = (min: number, max: number) => (v: string) => {
  if (!/^\d+$/.test(v)) return "Hanya boleh angka";
  if (v.length < min || v.length > max) return `Panjang harus ${min}-${max} digit`;
  return null;
};
const validateEvenDigits = (v: string) => {
  if (!/^\d+$/.test(v)) return "Hanya boleh angka";
  if (v.length % 2 !== 0) return "Jumlah digit harus genap";
  return null;
};
```

Error yang dihasilkan ditampilkan sebagai teks merah kecil di bawah baris terkait pada preview (bukan alert/toast, biar tidak mengganggu baris lain yang valid).

**d. Rendering real-time**

- Gunakan `useEffect` / reactive watcher yang men-debounce input textarea (misal 200ms) sebelum re-render seluruh preview, supaya tidak lag saat user mengetik cepat / paste ratusan baris sekaligus.
- Render tiap barcode ke elemen `<svg>` tersembunyi terlebih dahulu via `JsBarcode(svgElement, value, options)`, baru tampilkan hasilnya di grid card.
- Jika jumlah baris > 200, tampilkan hanya sebagian dulu (virtualized list / pagination) agar browser tidak freeze, dengan indikator "Menampilkan 200 dari 1000 barcode".

**e. Logic "Create sequence" (modal)**

Input modal: `prefix`, `startNumber`, `endNumber` atau `count`, `step`, `padding` (jumlah digit, isi 0 di depan), `suffix`. Generate array:

```ts
function generateSequence({ prefix, start, count, step, padding, suffix }: SequenceParams): string[] {
  const result: string[] = [];
  let current = start;
  for (let i = 0; i < count; i++) {
    const num = padding ? String(current).padStart(padding, "0") : String(current);
    result.push(`${prefix}${num}${suffix}`);
    current += step;
  }
  return result;
}
```
Hasilnya langsung menggantikan/menambah isi textarea "Barcode Values" (tanya user: replace semua atau append ke bawah).

**f. Logic export/download (harus benar-benar berfungsi, bukan hanya UI)**

- **SVG**: langsung serialize elemen `<svg>` (`new XMLSerializer().serializeToString(svgEl)`) → buat Blob `image/svg+xml` → trigger download via `<a download>`.
- **PNG/JPEG**: render SVG ke `<canvas>` (gambar SVG sebagai `Image` via `new Image()` + `canvas.drawImage`), lalu `canvas.toBlob("image/png")` atau `"image/jpeg"`.
- **PDF**: gunakan library `jspdf` — convert tiap barcode (dari canvas PNG di atas) jadi image lalu `doc.addImage()`, satu barcode per halaman atau grid label (lihat poin g).
- Jika value lebih dari 1 baris dan user pilih Download: buat file terpisah per barcode lalu bungkus jadi `.zip` pakai library `jszip`, kecuali user pilih PDF (semua barcode jadi 1 file PDF multi-halaman/multi-grid).

**g. Logic "Print Labels"**

- Buka komponen/halaman baru `PrintLabelsView` yang menyusun semua barcode dalam grid CSS (`display: grid`, kolom & baris menyesuaikan ukuran label, default mendekati ukuran label Avery 5160: 2.625in x 1in, bisa dikustom via input jumlah kolom/baris per halaman).
- Tambahkan CSS `@media print` untuk menghilangkan UI lain (sidebar, tombol) saat mode print, hanya grid barcode yang tampil.
- Panggil `window.print()` setelah render selesai.

### 5. Struktur Kerja

1. Cek dulu struktur folder project RBA saat ini (routing, komponen shared, styling system yang dipakai) sebelum membuat file baru.
2. Install dependency yang dibutuhkan (`jsbarcode`, dan `qrcode.react` jika opsional QR ditambahkan).
3. Buat komponen-komponen sesuai pemisahan di atas.
4. Buat 1 halaman/route baru misalnya `/tools/barcode-generator` yang merangkai semua komponen.
5. Tambahkan entry menu/navigasi ke halaman baru ini di tempat menu fitur/tools yang sudah ada di RBA.
6. Test dengan minimal 3 tipe barcode berbeda dan pastikan Download + Print Labels berfungsi.

Tolong mulai dengan menjelaskan rencana implementasi singkat dan struktur file yang akan dibuat sebelum mulai coding, supaya saya bisa review dulu.

---

## PROMPT LANJUTAN (kirim setelah versi pertama — perbaikan total desain + engine)

Hasil implementasi Barcode Generator kamu SAAT INI masih sangat mentah dan banyak yang salah/tidak berfungsi. Ini bukan revisi kecil, tolong perbaiki total sesuai daftar bug dan spesifikasi detail di bawah. Jangan cuma tempel CSS di atas struktur yang salah — perbaiki struktur HTML/komponennya juga.

### A. Daftar BUG yang harus diperbaiki (saya screenshot kondisi sekarang)

1. **Textarea menampilkan karakter `\\n` secara literal** (contoh placeholder muncul sebagai teks `1234567890\\nABC123\\n...` bukan baris baru sungguhan). Ini bug — placeholder/default value harus pakai newline asli (`\\n` sebagai escape character di string JS, BUKAN string literal dua karakter `\\` dan `n`). Cek juga apakah ada `.replace()` atau serialisasi yang salah sehingga newline ter-escape dua kali.
2. **Semua elemen numpuk jadi satu kolom panjang ke bawah** (Select Format → Search → Barcode Values → Options → Create Sequence semua vertikal). Ini SALAH. Harus 3 kolom sejajar (kiri: format, tengah: input+output, kanan: options) sesuai wireframe yang sudah saya berikan sebelumnya.
3. **Tidak ada preview barcode yang benar-benar di-generate** — hanya ada satu gambar barcode statis kecil di bagian atas ("Custom Barcode Design"), tidak ada grid output barcode hasil generate dari tiap baris di textarea. Preview harus live-update dan menampilkan SATU BARCODE PER BARIS input.
4. **Tidak ada daftar/grid kartu tipe barcode** (Code 128, Code 128A/B/C, GS1-128, EAN, UPC, dst) — cuma teks judul tanpa list. Search box juga tidak ada hasil yang bisa difilter karena listnya tidak pernah dirender.
5. **Semua input pakai elemen HTML native tanpa styling** (checkbox kotak default browser, `<select>` default, color input kotak persegi default). Tidak sesuai dark theme aplikasi RBA Studio sama sekali.
6. **"Create sequence" tidak muncul sebagai modal/dialog** — malah dirender sebagai section biasa yang didorong ke paling bawah halaman, tercampur dengan konten lain. Ini harus jadi popup modal dengan overlay gelap transparan di atas semua konten, muncul saat tombol "Create sequence" diklik, dan hilang saat "Cancel"/"Apply"/klik di luar modal.
7. Tombol "Copy", "Print Labels", "Download" belum jelas apakah benar-benar berfungsi atau hanya elemen visual kosong — pastikan semuanya well-wired ke logic asli (lihat bagian Engine di prompt sebelumnya), BUKAN `onClick` kosong atau `console.log` saja.

### B. Design System — WAJIB ikuti tema RBA Studio yang sudah ada

Jangan bikin palet warna baru sendiri. Ambil token warna dari UI aplikasi RBA Studio yang sudah berjalan (sidebar gelap, header dengan tombol RUN gradient ungu-biru, tombol STOP merah, background utama near-black `#0e0f14`-ish, border tipis abu gelap, teks putih/abu terang). Gunakan variabel CSS/theme yang SUDAH ADA di project (cek file theme/tailwind config dulu — jangan hardcode warna baru kalau sudah ada token resmi).

Detail komponen yang wajib di-restyle:
- **Kartu tipe barcode**: kotak dengan background sedikit lebih terang dari base (`bg-surface` / elevated), border radius besar (`rounded-xl`), padding cukup, preview barcode kecil di tengah, nama tipe di bawah, border highlight warna ungu/biru saat kartu aktif/dipilih, hover state (background sedikit terang + cursor pointer).
- **Toggle "Show Text"**: ganti checkbox native jadi custom toggle switch (pill shape, warna aktif ungu/biru sesuai aksen RUN button, animasi geser smooth).
- **Input angka** (Max Width, Height, Margin, Font Size, Rotation, Start, Count, Step, Padding): styled dark input dengan border tipis, focus ring warna aksen, bukan input polos putih.
- **Color picker** (Barcode Color, Background): custom swatch bulat/rounded dengan border, klik membuka color picker popover kecil, bukan kotak input color browser default.
- **Dropdown** (Text Alignment, Download format): custom styled select (dark background, chevron icon custom, dropdown list juga dark theme), bukan `<select>` default putih.
- **Modal "Create sequence"**: card dengan max-width sekitar 420-480px, di-center secara vertikal & horizontal di layar, backdrop `rgba(0,0,0,0.6)` blur tipis di belakangnya, header modal ada judul + tombol close (X), footer modal ada tombol "Cancel" (outline) dan "Apply" (filled, warna aksen).
- **Search barcode format**: input dengan icon kaca pembesar di kiri, styled dark, placeholder abu redup.
- **Output/preview grid**: barcode-barcode hasil generate ditampilkan sebagai card putih (barcode selalu di atas background putih supaya kontras dan bisa di-scan meskipun app-nya dark mode) disusun dalam grid responsif (misal `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`), dengan gap yang rapi.

### C. Layout struktur ulang (WAJIB 3 kolom, bukan 1 kolom vertikal)

```
┌─────────────────────┬───────────────────────────────────┬──────────────────┐
│ Select Barcode Format│  Barcode Values                    │  Options          │
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

### 4. Detail Engine / Logic Implementasi (WAJIB diikuti persis, jangan diimprovisasi)

**a. Struktur data internal**

Simpan setiap baris input sebagai objek, bukan string mentah:

```ts
type BarcodeEntry = {
  id: string;          // uuid, untuk key React & tracking error
  value: string;        // nilai barcode
  caption?: string;      // teks custom di bawah barcode (opsional)
  error?: string;        // pesan error validasi, null jika valid
};
```

Textarea "Barcode Values" adalah representasi teks dari array ini. Saat user mengetik, parse tiap baris:
- Split berdasarkan newline (`\n`) → tiap baris jadi 1 `BarcodeEntry`.
- Di tiap baris, jika ada karakter **tab** (`\t`), split lagi: bagian sebelum tab = `value`, bagian sesudah tab = `caption`.
- Saat generate string balik dari array ke textarea (misalnya setelah import CSV), gabungkan lagi pakai `\t` sebagai separator antara value dan caption, dan `\n` antar baris.

**b. Pemetaan tipe barcode (UI) → parameter JsBarcode**

Buat mapping object terpisah agar semua tipe konsisten:

```ts
const BARCODE_TYPE_MAP: Record<string, { jsBarcodeFormat: string; validate: (v: string) => string | null; example: string }> = {
  "code128":   { jsBarcodeFormat: "CODE128",  validate: validateAny,        example: "ABC-abc-1234" },
  "code128a":  { jsBarcodeFormat: "CODE128A", validate: validateUppercaseNumeric, example: "ABC123" },
  "code128b":  { jsBarcodeFormat: "CODE128B", validate: validateAny,        example: "Hello World!" },
  "code128c":  { jsBarcodeFormat: "CODE128C", validate: validateEvenDigits, example: "12345678" },
  "ean13":     { jsBarcodeFormat: "EAN13",    validate: validateDigits(12,13), example: "5901234123457" },
  "ean8":      { jsBarcodeFormat: "EAN8",     validate: validateDigits(7,8),   example: "96385074" },
  "upca":      { jsBarcodeFormat: "UPC",      validate: validateDigits(11,12), example: "042100005264" },
  "code39":    { jsBarcodeFormat: "CODE39",   validate: validateCode39Charset, example: "CODE39" },
  "itf14":     { jsBarcodeFormat: "ITF14",    validate: validateEvenDigits,    example: "10012345000017" },
  "msi":       { jsBarcodeFormat: "MSI",      validate: validateDigitsOnly,    example: "1234567" },
  "pharmacode":{ jsBarcodeFormat: "pharmacode", validate: validateNumericRange(3, 131070), example: "12345" },
  "codabar":   { jsBarcodeFormat: "codabar",  validate: validateCodabarCharset, example: "A123456A" },
};
```

- **GS1-128** perlu penanganan khusus: sebelum di-render, parse Application Identifier (AI) di dalam kurung, contoh input `(01)09521234543213(3103)000123`, lalu format ulang string sesuai standar GS1 (tambahkan FNC1 di awal via opsi `{ fontOptions: "", flat: false }` pada JsBarcode dengan format `"CODE128"`, dan sisipkan karakter FNC1 `\u00f1` di posisi AI). Buat fungsi terpisah `parseGS1Input(raw: string): string`.
- **QR Code / Data Matrix** tidak lewat JsBarcode — route ke komponen render berbeda (`qrcode.react` untuk QR, `bwip-js` dengan `bcid: "datamatrix"` untuk Data Matrix).

**c. Fungsi validasi (helper, buat betulan bukan placeholder)**

Contoh implementasi nyata, bukan stub:

```ts
const validateDigits = (min: number, max: number) => (v: string) => {
  if (!/^\d+$/.test(v)) return "Hanya boleh angka";
  if (v.length < min || v.length > max) return `Panjang harus ${min}-${max} digit`;
  return null;
};
const validateEvenDigits = (v: string) => {
  if (!/^\d+$/.test(v)) return "Hanya boleh angka";
  if (v.length % 2 !== 0) return "Jumlah digit harus genap";
  return null;
};
```

Error yang dihasilkan ditampilkan sebagai teks merah kecil di bawah baris terkait pada preview (bukan alert/toast, biar tidak mengganggu baris lain yang valid).

**d. Rendering real-time**

- Gunakan `useEffect` / reactive watcher yang men-debounce input textarea (misal 200ms) sebelum re-render seluruh preview, supaya tidak lag saat user mengetik cepat / paste ratusan baris sekaligus.
- Render tiap barcode ke elemen `<svg>` tersembunyi terlebih dahulu via `JsBarcode(svgElement, value, options)`, baru tampilkan hasilnya di grid card.
- Jika jumlah baris > 200, tampilkan hanya sebagian dulu (virtualized list / pagination) agar browser tidak freeze, dengan indikator "Menampilkan 200 dari 1000 barcode".

**e. Logic "Create sequence" (modal)**

Input modal: `prefix`, `startNumber`, `endNumber` atau `count`, `step`, `padding` (jumlah digit, isi 0 di depan), `suffix`. Generate array:

```ts
function generateSequence({ prefix, start, count, step, padding, suffix }: SequenceParams): string[] {
  const result: string[] = [];
  let current = start;
  for (let i = 0; i < count; i++) {
    const num = padding ? String(current).padStart(padding, "0") : String(current);
    result.push(`${prefix}${num}${suffix}`);
    current += step;
  }
  return result;
}
```

Hasilnya langsung menggantikan/menambah isi textarea "Barcode Values" (tanya user: replace semua atau append ke bawah).

**f. Logic export/download (harus benar-benar berfungsi, bukan hanya UI)**

- **SVG**: langsung serialize elemen `<svg>` (`new XMLSerializer().serializeToString(svgEl)`) → buat Blob `image/svg+xml` → trigger download via `<a download>`.
- **PNG/JPEG**: render SVG ke `<canvas>` (gambar SVG sebagai `Image` via `new Image()` + `canvas.drawImage`), lalu `canvas.toBlob("image/png")` atau `"image/jpeg"`.
- **PDF**: gunakan library `jspdf` — convert tiap barcode (dari canvas PNG di atas) jadi image lalu `doc.addImage()`, satu barcode per halaman atau grid label (lihat poin g).
- Jika value lebih dari 1 baris dan user pilih Download: buat file terpisah per barcode lalu bungkus jadi `.zip` pakai library `jszip`, kecuali user pilih PDF (semua barcode jadi 1 file PDF multi-halaman/multi-grid).

**g. Logic "Print Labels"**

- Buka komponen/halaman baru `PrintLabelsView` yang menyusun semua barcode dalam grid CSS (`display: grid`, kolom & baris menyesuaikan ukuran label, default mendekati ukuran label Avery 5160: 2.625in x 1in, bisa dikustom via input jumlah kolom/baris per halaman).
- Tambahkan CSS `@media print` untuk menghilangkan UI lain (sidebar, tombol) saat mode print, hanya grid barcode yang tampil.
- Panggil `window.print()` setelah render selesai.

### 5. Struktur Kerja

1. Cek dulu struktur folder project RBA saat ini (routing, komponen shared, styling system yang dipakai) sebelum membuat file baru.
2. Install dependency yang dibutuhkan (`jsbarcode`, dan `qrcode.react` jika opsional QR ditambahkan).
3. Buat komponen-komponen sesuai pemisahan di atas.
4. Buat 1 halaman/route baru misalnya `/tools/barcode-generator` yang merangkai semua komponen.
5. Tambahkan entry menu/navigasi ke halaman baru ini di tempat menu fitur/tools yang sudah ada di RBA.
6. Test dengan minimal 3 tipe barcode berbeda dan pastikan Download + Print Labels berfungsi.

Tolong mulai dengan menjelaskan rencana implementasi singkat dan struktur file yang akan dibuat sebelum mulai coding, supaya saya bisa review dulu.

---

## PROMPT LANJUTAN (kirim setelah versi pertama — perbaikan total desain + engine)

Hasil implementasi Barcode Generator kamu SAAT INI masih sangat mentah dan banyak yang salah/tidak berfungsi. Ini bukan revisi kecil, tolong perbaiki total sesuai daftar bug dan spesifikasi detail di bawah. Jangan cuma tempel CSS di atas struktur yang salah — perbaiki struktur HTML/komponennya juga.

### A. Daftar BUG yang harus diperbaiki (saya screenshot kondisi sekarang)

1. **Textarea menampilkan karakter `\\n` secara literal** (contoh placeholder muncul sebagai teks `1234567890\\nABC123\\n...` bukan baris baru sungguhan). Ini bug — placeholder/default value harus pakai newline asli (`\\n` sebagai escape character di string JS, BUKAN string literal dua karakter `\\` dan `n`). Cek juga apakah ada `.replace()` atau serialisasi yang salah sehingga newline ter-escape dua kali.
2. **Semua elemen numpuk jadi satu kolom panjang ke bawah** (Select Format → Search → Barcode Values → Options → Create Sequence semua vertikal). Ini SALAH. Harus 3 kolom sejajar (kiri: format, tengah: input+output, kanan: options) sesuai wireframe yang sudah saya berikan sebelumnya.
3. **Tidak ada preview barcode yang benar-benar di-generate** — hanya ada satu gambar barcode statis kecil di bagian atas ("Custom Barcode Design"), tidak ada grid output barcode hasil generate dari tiap baris di textarea. Preview harus live-update dan menampilkan SATU BARCODE PER BARIS input.
4. **Tidak ada daftar/grid kartu tipe barcode** (Code 128, Code 128A/B/C, GS1-128, EAN, UPC, dst) — cuma teks judul tanpa list. Search box juga tidak ada hasil yang bisa difilter karena listnya tidak pernah dirender.
5. **Semua input pakai elemen HTML native tanpa styling** (checkbox kotak default browser, `<select>` default, color input kotak persegi default). Tidak sesuai dark theme aplikasi RBA Studio sama sekali.
6. **"Create sequence" tidak muncul sebagai modal/dialog** — malah dirender sebagai section biasa yang didorong ke paling bawah halaman, tercampur dengan konten lain. Ini harus jadi popup modal dengan overlay gelap transparan di atas semua konten, muncul saat tombol "Create sequence" diklik, dan hilang saat "Cancel"/"Apply"/klik di luar modal.
7. Tombol "Copy", "Print Labels", "Download" belum jelas apakah benar-benar berfungsi atau hanya elemen visual kosong — pastikan semuanya well-wired ke logic asli (lihat bagian Engine di prompt sebelumnya), BUKAN `onClick` kosong atau `console.log` saja.

### B. Design System — WAJIB ikuti tema RBA Studio yang sudah ada

Jangan bikin palet warna baru sendiri. Ambil token warna dari UI aplikasi RBA Studio yang sudah berjalan (sidebar gelap, header dengan tombol RUN gradient ungu-biru, tombol STOP merah, background utama near-black `#0e0f14`-ish, border tipis abu gelap, teks putih/abu terang). Gunakan variabel CSS/theme yang SUDAH ADA di project (cek file theme/tailwind config dulu — jangan hardcode warna baru kalau sudah ada token resmi).

Detail komponen yang wajib di-restyle:
- **Kartu tipe barcode**: kotak dengan background sedikit lebih terang dari base (`bg-surface` / elevated), border radius besar (`rounded-xl`), padding cukup, preview barcode kecil di tengah, nama tipe di bawah, border highlight warna ungu/biru saat kartu aktif/dipilih, hover state (background sedikit terang + cursor pointer).
- **Toggle "Show Text"**: ganti checkbox native jadi custom toggle switch (pill shape, warna aktif ungu/biru sesuai aksen RUN button, animasi geser smooth).
- **Input angka** (Max Width, Height, Margin, Font Size, Rotation, Start, Count, Step, Padding): styled dark input dengan border tipis, focus ring warna aksen, bukan input polos putih.
- **Color picker** (Barcode Color, Background): custom swatch bulat/rounded dengan border, klik membuka color picker popover kecil, bukan kotak input color browser default.
- **Dropdown** (Text Alignment, Download format): custom styled select (dark background, chevron icon custom, dropdown list juga dark theme), bukan `<select>` default putih.
- **Modal "Create sequence"**: card dengan max-width sekitar 420-480px, di-center secara vertikal & horizontal di layar, backdrop `rgba(0,0,0,0.6)` blur tipis di belakangnya, header modal ada judul + tombol close (X), footer modal ada tombol "Cancel" (outline) dan "Apply" (filled, warna aksen).
- **Search barcode format**: input dengan icon kaca pembesar di kiri, styled dark, placeholder abu redup.
- **Output/preview grid**: barcode-barcode hasil generate ditampilkan sebagai card putih (barcode selalu di atas background putih supaya kontras dan bisa di-scan meskipun app-nya dark mode) disusun dalam grid responsif (misal `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`), dengan gap yang rapi.

### C. Layout struktur ulang (WAJIB 3 kolom, bukan 1 kolom vertikal)

```
┌─────────────────────┬───────────────────────────────────┬──────────────────┐
│ Select Barcode Format│  Barcode Values                    │  Options          │
│ (search + grid kartu │  (textarea + import CSV/           │  (semua kontrol   │
│  tipe barcode,       │   create sequence + Output preview │   styling &       │
│  scrollable)         │   grid + Copy/Print Labels)         │   Download)       │
└─────────────────────┴───────────────────────────────────┴──────────────────┘
```

Gunakan CSS Grid 3 kolom (`grid-template-columns: 300px 1fr 320px` sebagai contoh, sesuaikan), masing-masing kolom scroll independen jika kontennya panjang, dan tetap stack vertikal di layar sempit/mobile.

### D. Verifikasi fungsional yang WAJIB dites sebelum bilang selesai

1. Ketik 3 baris berbeda di "Barcode Values" → muncul 3 barcode berbeda di grid output secara real-time (tanpa delay lama, tanpa perlu refresh).
2. Klik salah satu kartu tipe barcode (misal EAN-13) → preview di output ikut berubah formatnya, dan kalau value tidak valid untuk EAN-13, muncul pesan error di baris itu saja.
3. Ketik di kolom Search → daftar kartu tipe barcode ter-filter sesuai kata kunci.
4. Klik "Create sequence" → modal muncul di tengah layar dengan overlay gelap, isi form, klik Apply → textarea "Barcode Values" terisi otomatis sesuai hasil generate, modal tertutup.
5. Ubah "Barcode Height" atau "Maximum Display Width" → semua barcode di grid output langsung berubah ukurannya.
6. Klik "Download" dengan format SVG dan PNG → file benar-benar terunduh dan valid (bisa dibuka).
7. Klik "Print Labels" → membuka tampilan khusus print berisi semua barcode dalam grid label, lalu memicu print dialog.
8. Klik "Copy" → barcode (atau gambar) benar-benar tersalin ke clipboard, bisa langsung di-paste ke aplikasi lain untuk membuktikan.

Setelah selesai, laporkan ke saya: file apa saja yang diubah, dan konfirmasi ke-8 poin verifikasi di atas sudah dites dan berhasil satu per satu (bukan asumsi). Jangan bilang "sudah selesai" kalau salah satu dari 8 poin itu belum benar-benar bisa dijalankan.

---

## PROMPT LANJUTAN 3 — Bug KRITIS: bukan cuma soal rapi, ada kesalahan arsitektur

STOP sebelum menambahkan styling apapun lagi. Ada 2 bug fundamental di implementasi saat ini yang harus diperbaiki DULU dari sisi logika/state, baru boleh disentuh soal desain:

### BUG KRITIS 1 — Modal "Create sequence" bocor ke halaman lain (route lain)

Saya sudah membuktikan: saat saya pindah dari menu "Barcode" ke menu "Workflows" (halaman yang SAMA SEKALI TIDAK ADA HUBUNGANNYA dengan barcode), form/section "Create sequence" masih tampil menimpa seluruh halaman Workflow Editor.

Ini artinya:
- Komponen `CreateSequence` (atau modal-nya) kemungkinan besar di-render di level **root/App layout**, bukan di dalam halaman/route Barcode saja. Cek `App.tsx` / root layout / `_app` — pastikan komponen ini HANYA di-render di dalam halaman Barcode, bukan di root yang dishare semua route.
- Kemungkinan juga state `isCreateSequenceOpen` (atau semacamnya) disimpan di **global state/context** yang tidak di-reset saat pindah halaman, DAN parent yang me-render modal ini juga ikut global — jadi walau route berubah, komponennya tidak pernah unmount.

**Perbaikan yang wajib dilakukan:**
1. Pastikan komponen `CreateSequenceModal` didefinisikan dan diimport HANYA di dalam file halaman Barcode (misal `BarcodePage.tsx` / `pages/barcode/index.tsx`), tidak di root layout.
2. State buka/tutup modal (`isSequenceModalOpen`) harus **local state** di dalam `BarcodePage`, pakai `useState` biasa — JANGAN taruh di Redux/Zustand/Context global kecuali memang ada alasan kuat.
3. Modal harus di-render secara kondisional: `{isSequenceModalOpen && <CreateSequenceModal ... />}` — supaya saat `false`, elemen benar-benar tidak ada di DOM sama sekali (bukan cuma `display: none` yang lupa direset).
4. Setelah perbaikan, TES: buka Create Sequence di halaman Barcode → pindah ke halaman lain (Workflows/Dashboard) tanpa menutup modal dulu → pastikan modal HILANG dan tidak muncul di halaman lain. Baru lanjut ke perbaikan berikutnya.

### BUG KRITIS 2 — Preview barcode tidak reaktif terhadap input (menampilkan data hardcode)

Saya ketik `JY123456789` di textarea "Barcode Values", tapi barcode yang muncul di area Output malah menampilkan `ABC-abc-1234` — nilai contoh/placeholder, bukan nilai yang saya ketik.

Ini artinya komponen `BarcodeOutputPreview` kemungkinan:
- Masih pakai **hardcoded default value** (`"ABC-abc-1234"`) di dalam kode `JsBarcode(...)`, bukan mengambil dari state `barcodeValues` yang berasal dari textarea.
- ATAU state `barcodeValues` tidak ter-update saat user mengetik di textarea (event `onChange` tidak benar-benar mengubah state, atau state yang diubah bukan state yang dipakai untuk render).

**Perbaikan yang wajib dilakukan:**
1. Cek `onChange` handler di textarea "Barcode Values" — pastikan setiap ketikan benar-benar memperbarui state (misal `setBarcodeValues(parseInput(e.target.value))`), tambahkan `console.log(barcodeValues)` sementara untuk verifikasi di dev console kalau perlu, lalu hapus lagi setelah terbukti benar.
2. Cek komponen yang me-render barcode di Output — pastikan dia melakukan `.map()` terhadap array `barcodeValues` dari state (BUKAN memanggil `JsBarcode(el, "ABC-abc-1234", ...)` dengan value hardcoded). Hapus semua string contoh yang ke-hardcode di logic rendering — string contoh HANYA boleh dipakai sebagai **placeholder kosong di textarea saat belum ada input**, tidak boleh dipakai untuk render barcode sungguhan.
3. Setelah perbaikan, TES: hapus semua isi textarea → ketik `TEST123` → pastikan HANYA muncul satu barcode dengan teks `TEST123` di bawahnya (bukan barcode lain / bukan ABC-abc-1234). Tambah baris kedua `HELLO456` → pastikan muncul barcode kedua di sebelah/bawahnya sesuai teks itu juga.

### Baru setelah 2 bug di atas terbukti fix (sudah dites sendiri oleh kamu), lanjutkan ke:

**a. Grid kartu tipe barcode** — ini juga BELUM PERNAH tampil sama sekali di semua screenshot yang saya kirim. Render list dari `BARCODE_TYPE_MAP` yang sudah didefinisikan sebelumnya sebagai grid kartu (grid CSS, `repeat(auto-fill, minmax(140px, 1fr))`), tiap kartu render mini barcode preview pakai `JsBarcode` dengan `example` value dari map tsb (BUKAN barcode sungguhan dari input user — ini beda dengan Output Preview di poin sebelumnya). Klik kartu → set `selectedFormat` di state → Output Preview ikut pakai format ini untuk generate ulang.

**b. Layout 3 kolom + modal proper** — baru setelah A dan B fix serta grid kartu tipe muncul, terapkan CSS Grid 3 kolom dan modal overlay sesuai spesifikasi "PROMPT LANJUTAN" sebelumnya.

**c. Acuan fungsional akhir: samakan perilaku dengan barcode-maker.com** — buka https://barcode-maker.com/ sebagai referensi perilaku (bukan referensi kode, jangan copy source-nya): perhatikan bagaimana di sana setiap baris teks di textarea langsung menghasilkan satu barcode secara instan tanpa delay terasa, search tipe barcode langsung filter grid tanpa reload, dan ganti opsi (width/height/margin) langsung mengubah semua barcode di preview secara bersamaan. Target akhir: perilaku RBA Studio harus terasa identik cepat-responsifnya dengan itu.

### Laporan yang saya minta setelah ini selesai:

Jangan kirim "sudah saya perbaiki" tanpa bukti. Tolong screenshot/deskripsikan hasil dari 3 tes berikut secara spesifik:
1. Modal Create Sequence dibuka di halaman Barcode → pindah ke halaman Workflows → modal SUDAH TIDAK tampak di halaman Workflows. (fix Bug Kritis 1)
2. Ketik `TEST123` di textarea Barcode Values (setelah menghapus isi lama) → barcode yang tampil di Output benar-benar menampilkan teks `TEST123`, bukan `ABC-abc-1234`. (fix Bug Kritis 2)
3. Grid kartu tipe barcode (minimal Code 128, Code 128A/B/C, EAN-13, EAN-8, UPC-A, Code 39) tampil sebagai kartu-kartu di panel kiri, masing-masing dengan preview mini barcode-nya sendiri.

---

