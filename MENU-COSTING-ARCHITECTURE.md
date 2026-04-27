# Seni bina: Menu costing + Firestore (FYP Klik Burger)

## 1. Analisis struktur semasa (ringkas)

```
c:\fyp\
├── html/           # login, main-menu, pos-cost-calculator, pos-order, menu-costing (baharu)
├── css/
├── js/
│   ├── firebase/   # config, init, collections (nama koleksi)
│   ├── cost-calculator/   # UI kalkulator legacy + ingredients + modifiers repos
│   ├── menu-costing/      # enjin kos, repos recipes/menu_items/sales/purchases, admin-app
│   └── main-menu.js
├── firebase.json / firestore.rules / firestore.indexes.json
└── PANDUAN-FIREBASE.md
```

**Modul kritikal sedia ada:** `ingredients` + `modifiers` (resipi terbenam dalam `usage` + `sellingPrice` satu dokumen).

**Modul baharu:** pisahkan **resipi** (`recipes`) dan **item menu** (`menu_items`) supaya satu resipi boleh dikongsi / diuji kos tanpa pendua harga jual.

---

## 2. Skema koleksi (cadangan)

| Koleksi | Peranan |
|---------|---------|
| `ingredients` | Stok / belian bulk → kos seunit (sedia ada) |
| `modifiers` | **Legacy** — kekalkan untuk `pos-cost-calculator.html` |
| `recipes` | BOM sahaja: `usage` (sama bentuk seperti `modifiers.usage`) |
| `menu_items` | `name`, `sellingPrice`, `recipeId` |
| `sales` | Rekod jualan (`lines`, `subtotal`, `createdAt`, …) |
| `purchase_history` | Belian / pembekal (`lines`, `totalAmount`, `createdAt`, …) |

### Medan utama (ringkas)

**recipes** `{ name, usage{}, sortIndex }`  
**menu_items** `{ name, sellingPrice, recipeId, sortIndex }`  
**sales** `{ createdAt, lines[], subtotal, notes? }`  
**purchase_history** `{ createdAt, totalAmount, supplier?, lines[], notes? }`

`createdAt` nombor epoch (ms) mudah untuk `orderBy` tanpa `serverTimestamp()` dari klien modul CDN (jika mahu Timestamp, guna `import { serverTimestamp }` kemudian).

---

## 3. Enjin kos (kod)

Fail **`js/menu-costing/costing-engine.js`**:

- `recipeTotalCost(ingredients, usageMap)` — guna semula `productCost` / logik `usage` + `usageBaseQty` dari `cost-calculator/core.js`.
- `menuItemCostModel(ingredients, menuItem, recipe)` → `{ cost, sellingPrice, profit, marginPct }`.

Tiada pendua formula kos seunit — kekal di **`costPerUnit`**.

---

## 4. Integrasi & fasa migrasi

| Fasa | Tindakan |
|------|----------|
| **A (sekarang)** | `menu-costing.html` + `admin-app.js` — pantau & seed demo `recipes` / `menu_items`; **tidak** ubah kalkulator lama. |
| **B** | `pos-order.html` atau POS: tulis `sales` melalui `sales-repository.js`. |
| **C** | Borang belian: tulis `purchase_history` + kemas kini `ingredients` (manual atau fungsi berasingan). |
| **D (pilihan)** | Migrasi: satu `modifier` → satu `recipe` + satu `menu_item`; **perlukan skrip / kelulusan** — perubahan destruktif. |

---

## 5. ⚠️ Firestore Rules (penyekat semasa)

Fail **`firestore.rules`** pada repo semasa **menafikan semua baca/tulis** (`if false`). Tanpa mengubah rules atau guna **Emulator** dengan rules lain, **tiada data** akan masuk dari pelayar.

- **Anda** perlu longgar / betulkan rules (atau arahkan saya secara eksplisit untuk edit rules).
- Perintah deploy rules (bila sedia, **minta kelulusan** sebelum production):

```powershell
cd c:\fyp
firebase deploy --only firestore:rules
```

---

## 6. Index Firestore

Jika `subscribeRecentSales` / `subscribeRecentPurchases` (`orderBy("createdAt")`) gagal dengan pautan index, ikut URL ralat dalam konsol untuk tambah indeks, atau kemas kini `firestore.indexes.json`.

---

## 7. Ujian & deploy (ulang dari panduan)

```powershell
cd c:\fyp
npx --yes serve .
```

Buka: `http://localhost:3000/html/menu-costing.html`

**Hosting (jangan production tanpa kelulusan):**

```powershell
firebase deploy --only hosting:possystem-6907d-d94e2
```

---

## 8. Emulator (disyorkan untuk FYP)

```powershell
firebase emulators:start --only firestore
```

Tambah `connectFirestoreEmulator(db, host, port)` dalam `init.js` **hanya** bila flag dev (contoh `?emulator=1`) — boleh dilaksanakan dalam fasa berikut.

---

*Dokumen ini diselaraskan dengan kod pada tarikh penulisan; kemas kini skema dalam repo jika berubah.*
