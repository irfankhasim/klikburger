# Firestore POS — skema, indeks & migrasi

Projek ini menggunakan **Firestore sahaja** untuk hab POS (tiada SQLite / pelayan Node untuk data POS).

**Bootstrap dari terminal:** lihat `SETUP.md` (`npm run setup`, `npm run dev`, `npm run seed:local`).

## Koleksi & subkoleksi

| Koleksi | Tujuan | Medan utama |
|--------|--------|-------------|
| `users/{uid}` | RBAC & paparan | `displayName`, `role` (`owner`, `admin`, `shift_lead`, `staff`) — `uid` = Firebase Auth UID |
| `pos_meta/counters` | Nombor pesanan & resit | `seqOrder`, `seqReceipt`, `activeShiftDocId`, `updatedAt` |
| `pos_orders/{orderId}` | Pesanan POS | `orderNo`, `receiptNo`, `saleId`, `lifecycle`, `kitchenStage`, `lines[]`, `subtotal`, `paymentMethod`, `shiftDocId`, timestamps |
| `pos_orders/{orderId}/items/{lineId}` | Baris item (mirror/query) | `productId`, `name`, `qty`, `unitPrice`, `lineTotal`, `cogsFifo`, `sortIndex` |
| `pos_receipts/{receiptId}` | Resit | `receiptNo`, `orderId`, `saleId`, `voided`, `lines[]`, jumlah |
| `pos_shifts/{shiftId}` | Drawer tunai | `isOpen`, `openingCash`, `openedAt`, `closedAt`, `openedByStaffId`, … |
| `pos_shifts/{shiftId}/cash_movements/{id}` | Tunai masuk/keluar | `kind`, `amount`, `note`, `createdAt`, `staffId` |
| `pos_sales_transactions/{saleId}` | Ringkasan selaras `sales/{saleId}` | `saleId`, `orderId`, `receiptNo`, `lines`, `subtotal` |
| `pos_audit_logs/{id}` | Jejak audit | `type`, `message`, `userId`, `meta`, `createdAt` |
| `sales/{saleId}` | Jualan + FIFO COGS (sedia ada) | `posOrderId`, `posReceiptNo`, `posReceiptDocId`, `lines`, … |
| `ingredient_batches/{id}` | Stok FIFO | `qtyRemaining`, `ingredientId`, `openedAt`, … |

## Indeks

**`firestore.indexes.json`** hanya mengisytiharkan **indeks komposit** (dua medan atau lebih). Indeks satu medan (`orderBy("paidAt")`, `orderBy("createdAt")`, `where("status","==")`, dll.) diurus oleh **single-field index** lalai Firestore — jangan tambah entri satu-medan dalam JSON itu (Firebase akan laporkan “not necessary, configure using single field index controls”).

- POS (`pos_orders`, `pos_receipts`, `pos_audit_logs`, `pos_shifts`, subkoleksi `cash_movements`): query semasa hanya `orderBy` / `where` satu medan — tiada komposit di repo.
- Jika anda tambah query **gabungan** (contoh `where("voided","==",false)` + `orderBy("createdAt","desc")`), Firebase Console akan cadangkan komposit; tambah entri baharu dalam `firestore.indexes.json` pada masa itu.

## Security rules (production)

1. Gantikan `allow read, write: if true` pada koleksi POS dengan `request.auth != null`.
2. Hadkan tulis kritikal (void, tutup drawer, `pos_meta/counters`) kepada `role in ['owner','admin']` atau Cloud Functions.
3. `users/{uid}`: benarkan baca/tulis sendiri (`request.auth.uid == docId`) atau admin sahaja untuk medan `role`.

## Nota: folder `server/` (SQLite)

Kod sumber SQLite (`src/`, `scripts/`, `migrations/`, `package.json`) telah dibuang. Jika folder `server/data` atau `server/node_modules` masih wujud kerana fail dikunci oleh proses lain, tutup sebarang `node` / editor yang membuka `pos.sqlite`, kemudian padam folder `server` secara manual.

## Pelan migrasi dari SQLite (lama)

1. Eksport jadual SQLite (CSV/JSON) untuk `users`, `orders`, `order_items`, `receipts`, `shifts`, `cash_movements`, `audit_log`, `hub_meta`.
2. Cipta pengguna dalam **Firebase Auth**; map `users.id` lama → UID baharu atau kekalkan e-mel sebagai kunci.
3. Tulis skrip sekali guna (Node + `firebase-admin`): `set` dokumen Firestore mengikut struktur di atas; `pos_orders/{id}/items` dari `order_items`.
4. `pos_meta/counters`: set `seqOrder` / `seqReceipt` kepada nilai maksimum sedia ada + 1.
5. Sahkan `sales` sedia ada atau import ringkasan jualan; pastikan `ingredient_batches` konsisten sebelum go-live.

## Aliran transaksi

- **Checkout**: satu `runTransaction` — baca `pos_meta/counters` + semua `ingredient_batches` yang relevan, tolak FIFO, `set` `sales`, kemudian tulis `pos_orders`, `items`, `pos_receipts`, `pos_sales_transactions`, `update` `sales` dengan rujukan POS (lihat `pos-sale-fifo.js` + `pos-checkout-firestore-writer.js`).
