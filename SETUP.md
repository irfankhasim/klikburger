# Setup terminal — Klik Burger POS (Firebase)

Matlamat: **clone → `npm install` → `npm run setup` → jalan** (minima langkah luar terminal).

## Apa yang `npm run setup` buat

1. `npm install` (termasuk `firebase-tools`, `firebase-admin`, `concurrently`).
2. Cuba `firebase deploy --only firestore:rules,firestore:indexes` (perlukan `firebase login` sekali di terminal).
3. Jika ada **kunci Admin SDK** (`firebase-service-account.json` di punca repo, atau `GOOGLE_APPLICATION_CREDENTIALS`):
   - Cipta / kemas kini pengguna demo Auth + dokumen `users/{uid}`.
   - Seed `pos_meta/counters`, drawer contoh, katalog burger (bahan, `modifiers` / produk, batch FIFO).
4. Jika **tiada** kunci: skrip menjalankan `firebase emulators:exec` untuk sahkan seed (data tidak kekal di Cloud); arahan seterusnya dipaparkan.

## Pra-syarat (sekali sahaja)

| Item | Cara |
|------|------|
| Firebase CLI login | `npx firebase login` (terminal, bukan Console) |
| Kunci perkhidmatan (disyorkan untuk seed Cloud) | Firebase Console → Tetapan projek → Akaun perkhidmatan → Kunci JSON → salin ke `firebase-service-account.json` di punca repo (fail ini dalam `.gitignore`) |

**Cipta projek Firebase baharu (pilihan):** `npx firebase projects:create YOUR_ID` kemudian salin `.firebaserc.example` ke `.firebaserc` dan set `default` kepada ID itu; kemas kini `js/firebase/config.js` dengan konfigurasi Web app projek tersebut.

## Pembangunan tempatan (emulator)

```bash
npm run dev
```

- Memulakan **Firestore**, **Auth**, dan **Hosting** emulator.
- Proses kedua menunggu port **8080** kemudian menjalankan seed (Auth + Firestore) ke emulator.
- Buka UI Emulator: http://127.0.0.1:4000  
- Aplikasi: http://127.0.0.1:5000/html/login.html  

SDK web disambung ke emulator **automatik** hanya pada port **5000/5001** (Firebase Hosting emulator semasa `npm run dev`). **VS Code Live Server (5500)** tidak disambung automatik — jika tidak, SDK cuba `127.0.0.1:9099` tanpa emulator → ralat **`auth/network-request-failed`**.

**Live Server + emulator:** jalankan `npm run dev`, kemudian buka contoh `http://127.0.0.1:5500/html/login.html?fbEmu=1` (atau sekali di konsol: `localStorage.setItem('kb_fb_emu','1')` kemudian reload).

**Live Server + Firebase production:** buka tanpa `fbEmu`; pastikan `js/firebase/config.js` betul dan kunci API browser membenarkan referrer `http://127.0.0.1:5500/*` (lihat nota dalam `config.js`).

### Ralat `auth/api-key-not-valid` (Live Server / localhost)

1. **Kemas kini config daripada projek Firebase (disyorkan):** `npx firebase login` kemudian jalankan **`npm run sync:webconfig`** (App ID WEB diambil daripada `config.js` sedia ada, atau hujung: `npm run sync:webconfig -- 1:XXX:web:YYY`).
2. **Sekatan kunci API:** Google Cloud Console → APIs & Services → Credentials → kunci API jenis “Browser” (Firebase) → *Application restrictions* → HTTP referrers → tambah `http://127.0.0.1:5500/*`, `http://localhost:5500/*`, atau untuk dev sahaja pilih “None”.
3. **Identity Toolkit:** pastikan API “Identity Toolkit API” didayakan untuk projek Google Cloud yang sama.

Log masuk demo (selepas seed):

- `irfan@gmail.com` / `irfan123` (owner)
- `ikhwan@gmail.com` / `ikhwan123` (staff / cashier)

## Seed semula ke emulator (terminal kedua)

```bash
npm run seed:local
```

(Pastikan `npm run dev` sedang berjalan.)

## Bersihkan legacy SQLite / `server/`

```bash
npm run cleanup
```

## Deploy Firestore sahaja

```bash
npm run deploy:firestore
```

## Skema & indeks

Lihat `FIRESTORE-POS-SCHEMA.md` dan `firestore.indexes.json`.

## Had automasi 100%

- **Kunci akaun perkhidmatan** untuk Admin SDK tidak boleh dijana sepenuhnya tanpa akses IAM (biasanya satu muat turun JSON dari Console, atau watak IAM oleh pentadbir organisasi).
- **Projek Firebase baharu** boleh dicipta melalui CLI (`firebase projects:create`) jika akaun anda dibenarkan; konfigurasi Web app (`apiKey`, `appId`, …) masih perlu disalin sekali ke `js/firebase/config.js` (boleh dijana semula dengan `firebase apps:sdkconfig WEB` selepas `firebase apps:create`).

Selepas itu, semua seed, rules, indeks, dan pengguna demo boleh diulang sepenuhnya dari terminal.
