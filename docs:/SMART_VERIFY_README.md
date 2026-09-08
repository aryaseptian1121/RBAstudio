# Smart Verify & Self-Healing Features

Fitur Smart Verify & Self-Healing memungkinkan workflow untuk:
- Memverifikasi kondisi layar sebelum menjalankan action
- Melakukan recovery otomatis jika action gagal
- Melanjutkan flow meskipun ada error pada node tertentu

## Cara Penggunaan

### 1. Setup References Folder
Folder `references/` berisi screenshot referensi untuk verifikasi layar.

### 2. Menggunakan Screen Verification
Untuk node yang ingin diverifikasi sebelum eksekusi:

```javascript
{
  type: 'mobile-tap',
  name: 'Tap Login Button',
  mx: 540,
  my: 960,
  verifyBefore: 'login_screen.png',  // File referensi di folder references/
  verifyThreshold: 0.95               // Threshold similarity (0-1)
}
```

### 3. Menjalankan Flow dengan Smart Features
Flow akan otomatis:
- Capture screen sebelum menjalankan node dengan `verifyBefore`
- Membandingkan dengan referensi menggunakan Jimp
- Menjalankan recovery plan jika verifikasi gagal atau action gagal

### 4. Recovery Plans
Sistem memiliki recovery plans built-in untuk skenario umum:

- **tap-failed**: Retry tap, wait element, refresh screen
- **swipe-failed**: Retry swipe dengan delay berbeda, wait element
- **screen-not-ready**: Wait untuk screen match, retry
- **app-crashed**: Restart app, wait untuk app launched

### 5. Menambah Reference Screenshot
Untuk menambah screenshot referensi:

1. Pastikan device Android connected via ADB
2. Buka screen yang ingin dijadikan referensi
3. Screenshot akan otomatis di-capture saat flow running dengan `verifyBefore`

### 6. Dependencies
Pastikan package.json memiliki:
```json
{
  "dependencies": {
    "jimp": "^0.22.10"
  }
}
```

### 7. File Structure
```
project/
├── references/           # Screenshot referensi
│   ├── login_screen.png
│   ├── home_screen.png
│   └── ...
├── screenVerifier.js     # Screen verification logic
├── flowEngine.js         # Modified flow engine
└── main.js              # Electron main process
```

## Contoh Node dengan Smart Verify

```javascript
// Node tap dengan verifikasi layar
{
  id: 1,
  type: 'mobile-tap',
  name: 'Login Button',
  mx: 540,
  my: 960,
  verifyBefore: 'login_form.png',
  verifyThreshold: 0.9,
  delay: 500
}

// Node swipe dengan recovery
{
  id: 2,
  type: 'mobile-swipe',
  name: 'Scroll Down',
  sx: 540,
  sy: 1500,
  ex: 540,
  ey: 500,
  duration: 300
}
```

## Monitoring & Logging
Flow akan memberikan log detail:
- `[INFO] Verifying screen before mobile-tap...`
- `[SUCCESS] Screen verified (98.5% match)`
- `[WARN] Screen mismatch (85.2%), attempting recovery`
- `[INFO] Starting recovery plan for mobile-tap`
- `[INFO] Recovery: Retrying in 1000ms`

## Tips Optimalisasi
1. Gunakan threshold 0.9-0.95 untuk verifikasi layar
2. Simpan screenshot referensi dalam kondisi stabil
3. Test recovery plans dengan berbagai skenario error
4. Monitor log untuk mengidentifikasi pola kegagalan