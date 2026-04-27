# Panduan Firebase (Firestore) — Klik Burger FYP

Projek ini sudah **disambungkan ke Firestore** melalui fail JavaScript modul. Panduan ini untuk **setup konsol**, **uji**, dan **deploy**.

---

## 1. Apa yang sudah siap dalam kod

| Fail | Fungsi |
|------|--------|
| `js/firebase/config.js` | Objek `firebaseConfig` (isi dari Firebase Console → Web app) |
| `js/firebase/init.js` | `initializeApp` + `getFirestore` + eksport API (`collection`, `onSnapshot`, …) |
| `js/cost-calculator/collections.js` | Nama koleksi: `ingredients`, `modifiers` |
| `js/cost-calculator/main.js` | UI kalkulator + `onSnapshot` (masa nyata); tiada auto-seed |
| `js/cost-calculator/*-repository.js` | Tambah / kemas kini / padam dokumen |

**Nota:** `databaseURL` dalam `config.js` ialah untuk **Realtime Database** (produk lain). Modul **kalkulator kos** guna **Firestore** sahaja.

---

## 2. Langkah dalam Firebase Console

### 2.1 Dayakan Firestore

1. Buka [Firebase Console](https://console.firebase.google.com/) → pilih projek anda (contoh `possystem-6907d`).
2. **Build** → **Firestore Database**.
3. **Create database** (jika belum):
   - Pilih lokasi (disyorkan hampir dengan pengguna, contoh `asia-southeast1`).
   - Pilih mod **Production** atau **Test** mengikut keperluan FYP / penyelia.

### 2.2 Pastikan Web App wujud

1. **Project settings** (ikon gear) → **Your apps**.
2. Pastikan ada **Web app**; jika buat app baharu, **salin semula** objek config ke `js/firebase/config.js` (semua medan `apiKey`, `projectId`, `appId`, dll. mesti sepadan).

### 2.3 Firestore Security Rules

- Rules mengawal siapa boleh **baca / tulis** koleksi.
- Fail **`firestore.rules`** dalam repo ini pada masa ini **menafikan semua** akses (`allow read, write: if false`). Tanpa menukar rules (atau guna **Emulator** dengan rules lain), halaman **Bahan mentah** tidak boleh memuat data atau butang **+ Tambah bahan** tidak akan berjaya — pelayar akan tunjuk mesej ralat pada skrin (bukan senyap).
- Untuk **pembangunan**, jika data tidak load dan konsol pelayar tunjuk `permission-denied`, semak tab **Rules** dalam Firestore.
- **Production:** jangan biarkan `allow read, write: if true` kekal — rancang rules ikut auth / peranan pengguna (fasa akhir projek anda).

---

## 3. Struktur data (Firestore)

### Koleksi `ingredients`

Setiap dokumen = satu bahan. Medan utama (contoh):

- `name`, `purchasePrice`, `purchaseQty`, `unit`, `sortIndex`
- (pilihan) `category`, `supplier`, `minStockQty`, `stockStatus` — contoh data permulaan

### Koleksi `modifiers` (produk / menu)

Setiap dokumen = satu produk. Medan utama (contoh):

- `name`, `sellingPrice`, `sortIndex`
- `usage` — peta: ID bahan → **nombor** (lama) atau `{ guna, gunaUnit }` (jisim/isipadu)

### Data permulaan (seed) — burger

Fail `js/cost-calculator/burger-startup-seed.js` mengisi **21 bahan** + lot `ingredient_batches` + `ingredient_ledger` + satu dokumen `purchase_history`, serta **15** `modifiers` (menu + add-on) dengan resipi.

1. Pastikan koleksi **`ingredients`** dan **`modifiers`** kosong (padam dokumen sedia jika perlu; lot/ladger berkaitan boleh dibersihkan sekali).
2. Jalankan pelayan HTTP (`npx --yes serve .`).
3. Buka **`/html/seed-burger-startup.html`** dan tekan **Jalankan seed**.

Selepas itu, POS dan Produk & kos memuat data yang sama. Tiada auto-seed pada load halaman lain (elak overwrite tanpa sengaja).

### Seed dari terminal (disyorkan jika data tak keluar di pelayar)

1. Dalam folder projek, pasang dependensi (sekali): `npm install`
2. Firebase Console → **Tetapan projek** → **Akaun perkhidmatan** → **Kunci baharu** → muat turun JSON.  
   Letakkan fail itu sebagai **`firebase-service-account.json`** di punca repo `c:\fyp\` (fail ini disenarai abai dalam `.gitignore` — **jangan** commit ke Git).
3. Pastikan koleksi **`ingredients`** dan **`modifiers`** kosong dalam Firestore.
4. Jalankan:

```powershell
cd c:\fyp
npm run seed:burger
```

Atau laluan kunci tersuai:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\Anda\Downloads\serviceAccount.json"
npm run seed:burger
```

Skrip menulis terus ke Firestore (sama seperti halaman seed, tetapi guna **Admin SDK** — tiada isu rules `permission-denied` untuk akaun perkhidmatan).

---

## 4. Cara uji di komputer (disyorkan)

Jangan buka `pos-cost-calculator.html` terus sebagai `file://` — guna **pelayan HTTP**.

Dari folder **`c:\fyp`**:

```powershell
npx --yes serve .
```

Buka pelayar (contoh port 3000):

- `http://localhost:3000/html/pos-cost-calculator.html`  
  atau  
- `http://localhost:3000/html/main-menu.html` → mod **Pejabat belakang** → **Produk & kos** / **Bahan mentah**.
- `http://localhost:3000/html/seed-burger-startup.html` — isi data permulaan (sekali, pangkalan kosong).

Anda patut nampak teks **Memuatkan data…** sekejap, kemudian jadual. Tekan **F12** → **Console** jika ada ralat.

---

## 5. Deploy (Hosting) — ringkas

Fail `firebase.json` + `.firebaserc` sudah disediakan untuk projek ini.

```powershell
cd c:\fyp
firebase login
firebase deploy --only hosting:possystem-6907d-d94e2
```

URL contoh: `https://possystem-6907d-d94e2.web.app`  
Halaman utama akar: redirect ke `html/login.html` (`index.html`).

---

## 6. Troubleshooting

| Masalah | Tindakan |
|---------|----------|
| `permission-denied` | Semak **Firestore Rules** |
| Skrin loading lama / kosong | F12 Console; pastikan **Firestore** didayakan; pastikan `config.js` betul |
| Modul tidak load | Guna `http://localhost/...` bukan `file://` |
| CLI `firebase` tidak dikenali | Pasang: `npm install -g firebase-tools` |

---

## 7. Senarai perintah berguna

```powershell
# Pelayan tempatan
npx --yes serve .

# Log masuk Firebase (sekali per mesin / bila perlu)
firebase login

# Deploy semula selepas ubah fail statik
firebase deploy --only hosting:possystem-6907d-d94e2
```

---

*Kemas kini panduan ini jika anda tukar nama projek, site Hosting, atau struktur folder.*
