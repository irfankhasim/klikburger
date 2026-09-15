/**
 * Kamus: Kalkulator kos: bahan mentah, produk, resipi, belian borong.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 *
 * Beberapa entri mengandungi ruang letak seperti {pct}, {count}, {name} - nilai
 * sebenar disisipkan di js/cost-calculator/main.js supaya teks terhasil kekal
 * sama dengan versi sebelum i18n.
 */

var ms = {
  // -? Dokumen & navigasi sisi -???????????????????????????????????????????????
  "calc.docTitle": "Klik Burger - Kalkulator kos jualan",
  "calc.nav.aria": "Navigasi",
  "calc.nav.ingredients": "Bahan mentah",
  "calc.nav.products": "Produk & kos",
  "calc.loading": "Memuatkan data...",

  // -? Halaman bahan mentah -??????????????????????????????????????????????????
  "calc.ing.title": "Bahan mentah",
  "calc.ing.lead":
    "Isi borang <strong>Tambah bahan</strong>, simpan, kemudian urus stok melalui <strong>Tambah belian</strong>.",
  "calc.ing.addBtn": "+ Tambah bahan",
  "calc.ing.bulkBtn": "Belian borong",
  "calc.ing.tableTitle": "Senarai bahan",

  // -? Borang draf bahan baharu -??????????????????????????????????????????????
  "calc.draft.formAria": "Butiran bahan baharu",
  "calc.draft.title": "Tambah bahan",
  "calc.draft.sub": "Nama, unit pakej, dan harga belian pertama. Stok seterusnya melalui Tambah belian.",
  "calc.draft.namePh": "cth. Ayam dada",
  "calc.draft.priceTitle": "Jumlah (RM) pakej - termasuk cukai jika ada",
  "calc.draft.submit": "Simpan ke senarai",

  // -? Label medan -???????????????????????????????????????????????????????????
  "calc.field.ingName": "Nama bahan",
  "calc.field.packUnit": "Unit pakej",
  "calc.field.totalRm": "Jumlah (RM)",
  "calc.field.packQty": "Kuantiti pakej",
  "calc.field.name": "Nama",
  "calc.field.sellPrice": "Harga jual (RM)",
  "calc.field.purchaseUnit": "Unit belian",
  "calc.field.purchasePrice": "Harga belian (RM)",
  "calc.field.qtyPurchased": "Jumlah dibeli",
  "calc.field.unit": "Unit",

  // -? Butang biasa -??????????????????????????????????????????????????????????
  "calc.btn.cancel": "Batal",
  "calc.btn.save": "Simpan",
  "calc.btn.add": "Tambah",
  "calc.btn.close": "Tutup",
  "calc.btn.edit": "Sunting",
  "calc.btn.delete": "Padam",
  "calc.btn.remove": "Buang",

  // -? Kepala jadual -?????????????????????????????????????????????????????????
  "calc.th.ingredient": "Bahan",
  "calc.th.remaining": "Baki / asal",
  "calc.th.unit": "Unit",
  "calc.th.costPerUnit": "Kos / unit",
  "calc.th.status": "Status",
  "calc.th.actions": "Tindakan",
  "calc.th.date": "Tarikh",
  "calc.th.pack": "Pakej",
  "calc.th.change": "Perubahan",

  // -? Jadual bahan (dibina oleh JS) -?????????????????????????????????????????
  "calc.unnamed": "Tanpa nama",
  "calc.ing.noRemaining": "Tiada baki. <strong>Tambah belian</strong>.",
  "calc.ing.noLotLine": "Tiada lot - <strong>Tambah belian</strong>.",
  "calc.ing.bakiTitle": "Baki / asal (ikut giliran lot)",
  "calc.ing.bakiAria": "Baki berbanding asal",
  "calc.ing.unitTitle": "Unit pakej rujukan",
  "calc.ing.cpuTitle": "Kos seunit",
  "calc.ing.addPurchase": "Tambah Belian Baru",
  "calc.ingredientFallback": "Bahan",

  // -? Status stok -???????????????????????????????????????????????????????????
  "calc.status.noLot": "Tiada lot",
  "calc.status.noLotTitle": "Tiada rekod lot. Tambah belian untuk mula jejak stok.",
  "calc.status.out": "Habis",
  "calc.status.outTitle": "Tiada baki untuk jualan (semua lot kosong).",
  "calc.status.ok": "OK",
  "calc.status.okInvalidTitle": "Lot aktif ada baki; kuantiti asal tidak sah untuk nisbah.",
  "calc.status.low": "Rendah",
  "calc.status.lowTitle":
    "Lot FIFO aktif tinggal {pct}% daripada asal (ambang rendah - {threshold}%).",
  "calc.status.okTitle": "Lot FIFO aktif melebihi ambang stok rendah ({threshold}%).",

  // -? Halaman produk & kos -??????????????????????????????????????????????????
  "calc.mod.titleFull": "Produk & kos",
  "calc.mod.descFull":
    "<strong>Produk</strong> - resipi &amp; harga. Pakej: <strong>Menu Produk</strong> (pejabat belakang).",
  "calc.mod.titleCatalog": "Pakej",
  "calc.mod.descCatalog": "Produk tunggal: <strong>Inventori - Produk &amp; kos</strong>.",

  // -? Kad produk -????????????????????????????????????????????????????????????
  "calc.tile.noProducts": "Tiada produk dipilih",
  "calc.tile.packageTag": "Pakej",
  "calc.tile.noIngredients": "Tiada bahan",
  "calc.tile.costPrice": "Harga modal",
  "calc.tile.sellPrice": "Harga jual",
  "calc.tile.profit": "Untung",
  "calc.grid.addProduct": "Produk",
  "calc.grid.addPackage": "Pakej",

  // -? Label margin -??????????????????????????????????????????????????????????
  "calc.margin.low": "Rendah",
  "calc.margin.medium": "Sederhana",
  "calc.margin.good": "Baik",

  // -? Modal produk -??????????????????????????????????????????????????????????
  "calc.modal.packageHelp": "Pilih produk untuk tab pakej di kaunter.",
  "calc.modal.packageListAria": "Produk",
  "calc.modal.ingLabel": "Bahan",
  "calc.modal.ingHint":
    "Isi kuantiti sebagai <strong>min - max</strong>. Untuk kuantiti tepat, letak nilai yang sama pada kedua-duanya (cth. <strong>1 - 1</strong>).",
  "calc.modal.addIngBtn": "+ Bahan baharu",
  "calc.modal.deleteProduct": "Padam produk",
  "calc.modal.titleAddItem": "Tambah item (resipi)",
  "calc.modal.titleAddPackage": "Tambah pakej",
  "calc.modal.titleEditItem": "Sunting item (resipi)",
  "calc.modal.titleEditPackage": "Sunting pakej",
  "calc.modal.qtyMin": "Kuantiti minimum",
  "calc.modal.qtyMax": "Kuantiti maksimum",
  "calc.modal.qtyMaxTitle": "Kuantiti maksimum - sama dengan min bermakna kuantiti tepat",
  "calc.modal.noSingles": "Tiada produk tunggal - tambah di <strong>Produk &amp; kos</strong>.",
  "calc.modal.suggestion": "Cadangan (30% margin): ",
  "calc.modal.useSuggestion": "Guna",
  "calc.qa.namePh": "cth. Sos lada hitam",

  // -? Ringkasan kos dalam modal -?????????????????????????????????????????????
  "calc.stats.totalCost": "Jumlah harga modal",
  "calc.stats.foodCostSuffix": "% kos bahan",
  "calc.stats.worstMargin": "margin terburuk {pct}%",
  "calc.stats.recipeRange": "Julat resipi {range}",
  "calc.stats.marginSuffix": "% margin",

  // -? Panel bahan (drawer) -??????????????????????????????????????????????????
  "calc.drawer.closeAria": "Tutup panel",
  "calc.drawer.formAria": "Rekod pakej belian",
  "calc.drawer.priceTitle": "Jumlah (RM) - termasuk cukai jika ada",
  "calc.drawer.cpuLabel": "Modal / unit",
  "calc.drawer.saveName": "Simpan nama",
  "calc.drawer.historyTitle": "Sejarah belian",
  "calc.drawer.fifoLegend": "Batch/lot yang sedang digunakan sekarang (FIFO aktif)",
  "calc.drawer.historyEmpty": "Tiada sejarah. Simpan rekod pertama di atas.",

  // -? Belian borong -?????????????????????????????????????????????????????????
  "calc.bulk.title": "Belian borong",
  "calc.bulk.sub":
    "Rekod pembelian bahan mentah. Kuantiti resepi ditetapkan kemudian di <strong>Produk &amp; kos</strong>.",
  "calc.bulk.colIngredient": "Bahan mentah",
  "calc.bulk.colQty": "Kuantiti",
  "calc.bulk.colPrice": "Harga (RM)",
  "calc.bulk.addExisting": "Tambah bahan sedia ada",
  "calc.bulk.addNew": "Tambah bahan baru",
  "calc.bulk.taxLabel": "Cukai / SST",
  "calc.bulk.subtotal": "Subtotal",
  "calc.bulk.grandTotal": "Jumlah keseluruhan",
  "calc.bulk.confirm": "Sahkan & simpan",
  "calc.bulk.selectIng": "-- Pilih bahan --",
  "calc.bulk.optAddNew": "+ Tambah bahan baru...",
  "calc.bulk.newNamePh": "Nama bahan baru",
  "calc.bulk.tagNew": "Baru",
  "calc.bulk.priceAria": "Harga RM",
  "calc.bulk.removeRowAria": "Buang baris",
  "calc.bulk.previewTitle": "Ringkasan & agihan cukai",
  "calc.bulk.taxPct": "Cukai ({value}%)",
  "calc.bulk.taxRm": "Cukai (RM {value})",
  "calc.bulk.newIngredient": "Bahan baru",
  "calc.bulk.noIngSelected": "Bahan tidak dipilih",
  "calc.bulk.plusTax": "+ cukai RM ",
  "calc.bulk.saving": "Menyimpan...",
  "calc.bulk.savedOk": "Belian borong berjaya disimpan!",
  "calc.bulk.errNoRows": "Tambah sekurang-kurangnya satu bahan.",
  "calc.bulk.errNewName": "Sila masukkan nama untuk bahan baru.",
  "calc.bulk.errSelectIng": "Sila pilih bahan untuk semua baris.",
  "calc.bulk.errQty": "Kuantiti mesti lebih dari 0.",
  "calc.bulk.errPrefix": "Ralat: ",

  // -? Mesej status & pengesahan -?????????????????????????????????????????????
  "calc.msg.fillName": "Isi nama.",
  "calc.msg.pickOneProduct": "Tandakan sekurang-kurangnya satu produk.",
  "calc.msg.packageSaved": "Pakej disimpan.",
  "calc.msg.packageUpdated": "Pakej dikemas kini.",
  "calc.msg.productAdded": "Produk ditambah.",
  "calc.msg.addSingleFirst": "Tambah produk tunggal di Produk & kos dahulu.",
  "calc.msg.fillIngName": "Isi nama bahan.",
  "calc.msg.priceNegative": "Jumlah (RM) tidak boleh negatif.",
  "calc.msg.packQtyPositive": "Kuantiti pakej mesti lebih daripada 0.",
  "calc.msg.ingAdded": "Bahan ditambah.",
  "calc.msg.savingName": "Menyimpan nama...",
  "calc.msg.nameUpdated": "Nama dikemas kini.",
  "calc.msg.qtyPositive": "Jumlah dibeli mesti > 0.",
  "calc.msg.saving": "Menyimpan...",
  "calc.msg.saved": "Disimpan.",
  "calc.msg.qtyGtZero": "Jumlah dibeli > 0.",
  "calc.msg.addingIng": "Menambah bahan...",
  "calc.msg.ingAddedLinked": "Bahan ditambah dan dipautkan ke menu ini.",
  "calc.thisProduct": "produk ini",
  "calc.confirm.deleteProduct":
    'Padam "{name}" dari Produk & kos?\n\nDokumen akan dibuang dari Firestore (modifiers). Tindakan ini tidak boleh dibuat asal.',
  "calc.impact.warning":
    "Kos naik - {count} produk kini margin rendah (<{threshold}%): {names}",

  // -? Ralat Firestore -???????????????????????????????????????????????????????
  "calc.err.unknown": "Ralat tidak diketahui.",
  "calc.err.permissionDenied":
    "Firestore menafikan baca/tulis. Kemas kini firestore.rules (contoh: benarkan baca/tulis untuk pembangunan) atau gunakan Emulator - lihat PANDUAN-FIREBASE.md.",
  "calc.err.indexMissing":
    "Sejarah tidak dimuatkan: Firestore memerlukan indeks untuk koleksi ingredient_ledger. Buka konsol pelayar (F12) untuk pautan - create index - , atau jalankan firebase deploy --only firestore:indexes.",

  // -? Format tarikh mengikut bahasa -?????????????????????????????????????????
  "calc.dateLocale": "ms-MY",
  "calc.ledger.wastage": "Pembaziran",
  "calc.ledger.initial": "Daftar",
  "calc.ledger.purchase": "Beli",
  "calc.ledger.price": "Harga",
  "calc.ledger.sale": "Jualan"
};

var en = {
  // -? Document & side navigation -????????????????????????????????????????????
  "calc.docTitle": "Klik Burger - Sales cost calculator",
  "calc.nav.aria": "Navigation",
  "calc.nav.ingredients": "Raw ingredients",
  "calc.nav.products": "Products & cost",
  "calc.loading": "Loading data...",

  // -? Raw ingredients page -??????????????????????????????????????????????????
  "calc.ing.title": "Raw ingredients",
  "calc.ing.lead":
    "Fill in the <strong>Add ingredient</strong> form, save it, then manage stock through <strong>Add purchase</strong>.",
  "calc.ing.addBtn": "+ Add ingredient",
  "calc.ing.bulkBtn": "Bulk purchase",
  "calc.ing.tableTitle": "Ingredient list",

  // -? New ingredient draft form -?????????????????????????????????????????????
  "calc.draft.formAria": "New ingredient details",
  "calc.draft.title": "Add ingredient",
  "calc.draft.sub": "Name, pack unit, and first purchase price. Later stock goes through Add purchase.",
  "calc.draft.namePh": "e.g. Chicken breast",
  "calc.draft.priceTitle": "Package total (RM) - including tax if any",
  "calc.draft.submit": "Save to list",

  // -? Field labels -??????????????????????????????????????????????????????????
  "calc.field.ingName": "Ingredient name",
  "calc.field.packUnit": "Package unit",
  "calc.field.totalRm": "Total (RM)",
  "calc.field.packQty": "Package quantity",
  "calc.field.name": "Name",
  "calc.field.sellPrice": "Selling price (RM)",
  "calc.field.purchaseUnit": "Purchase unit",
  "calc.field.purchasePrice": "Purchase price (RM)",
  "calc.field.qtyPurchased": "Quantity bought",
  "calc.field.unit": "Unit",

  // -? Common buttons -????????????????????????????????????????????????????????
  "calc.btn.cancel": "Cancel",
  "calc.btn.save": "Save",
  "calc.btn.add": "Add",
  "calc.btn.close": "Close",
  "calc.btn.edit": "Edit",
  "calc.btn.delete": "Delete",
  "calc.btn.remove": "Remove",

  // -? Table headings -????????????????????????????????????????????????????????
  "calc.th.ingredient": "Ingredient",
  "calc.th.remaining": "Remaining / original",
  "calc.th.unit": "Unit",
  "calc.th.costPerUnit": "Cost / unit",
  "calc.th.status": "Status",
  "calc.th.actions": "Actions",
  "calc.th.date": "Date",
  "calc.th.pack": "Package",
  "calc.th.change": "Change",

  // -? Ingredient table (built by JS) -????????????????????????????????????????
  "calc.unnamed": "Unnamed",
  "calc.ing.noRemaining": "Nothing left. <strong>Add purchase</strong>.",
  "calc.ing.noLotLine": "No lot - <strong>Add purchase</strong>.",
  "calc.ing.bakiTitle": "Remaining / original (following lot order)",
  "calc.ing.bakiAria": "Remaining versus original",
  "calc.ing.unitTitle": "Reference package unit",
  "calc.ing.cpuTitle": "Cost per unit",
  "calc.ing.addPurchase": "Add new purchase",
  "calc.ingredientFallback": "Ingredient",

  // -? Stock status -??????????????????????????????????????????????????????????
  "calc.status.noLot": "No lot",
  "calc.status.noLotTitle": "No lot records yet. Add a purchase to start tracking stock.",
  "calc.status.out": "Out",
  "calc.status.outTitle": "Nothing left to sell (all lots are empty).",
  "calc.status.ok": "OK",
  "calc.status.okInvalidTitle":
    "The active lot still has stock; the original quantity is not valid for a ratio.",
  "calc.status.low": "Low",
  "calc.status.lowTitle":
    "The active FIFO lot has {pct}% of its original quantity left (low threshold - {threshold}%).",
  "calc.status.okTitle": "The active FIFO lot is above the low stock threshold ({threshold}%).",

  // -? Products & cost page -??????????????????????????????????????????????????
  "calc.mod.titleFull": "Products & cost",
  "calc.mod.descFull":
    "<strong>Products</strong> - recipes &amp; prices. Packages: <strong>Product Menu</strong> (Back Office).",
  "calc.mod.titleCatalog": "Packages",
  "calc.mod.descCatalog": "Single products: <strong>Inventory - Products &amp; cost</strong>.",

  // -? Product tiles -?????????????????????????????????????????????????????????
  "calc.tile.noProducts": "No product selected",
  "calc.tile.packageTag": "Package",
  "calc.tile.noIngredients": "No ingredients",
  "calc.tile.costPrice": "Cost price",
  "calc.tile.sellPrice": "Selling price",
  "calc.tile.profit": "Profit",
  "calc.grid.addProduct": "Product",
  "calc.grid.addPackage": "Package",

  // -? Margin labels -?????????????????????????????????????????????????????????
  "calc.margin.low": "Low",
  "calc.margin.medium": "Moderate",
  "calc.margin.good": "Good",

  // -? Product modal -?????????????????????????????????????????????????????????
  "calc.modal.packageHelp": "Choose the products for the package tab at the counter.",
  "calc.modal.packageListAria": "Products",
  "calc.modal.ingLabel": "Ingredients",
  "calc.modal.ingHint":
    "Enter the quantity as <strong>min - max</strong>. For an exact quantity, put the same value in both (e.g. <strong>1 - 1</strong>).",
  "calc.modal.addIngBtn": "+ New ingredient",
  "calc.modal.deleteProduct": "Delete product",
  "calc.modal.titleAddItem": "Add item (recipe)",
  "calc.modal.titleAddPackage": "Add package",
  "calc.modal.titleEditItem": "Edit item (recipe)",
  "calc.modal.titleEditPackage": "Edit package",
  "calc.modal.qtyMin": "Minimum quantity",
  "calc.modal.qtyMax": "Maximum quantity",
  "calc.modal.qtyMaxTitle": "Maximum quantity - the same as min means an exact quantity",
  "calc.modal.noSingles": "No single products - add one in <strong>Products &amp; cost</strong>.",
  "calc.modal.suggestion": "Suggested (30% margin): ",
  "calc.modal.useSuggestion": "Use",
  "calc.qa.namePh": "e.g. Black pepper sauce",

  // -? Cost summary inside the modal -?????????????????????????????????????????
  "calc.stats.totalCost": "Total cost price",
  "calc.stats.foodCostSuffix": "% ingredient cost",
  "calc.stats.worstMargin": "worst margin {pct}%",
  "calc.stats.recipeRange": "Recipe range {range}",
  "calc.stats.marginSuffix": "% margin",

  // -? Ingredient drawer -?????????????????????????????????????????????????????
  "calc.drawer.closeAria": "Close panel",
  "calc.drawer.formAria": "Record a purchase package",
  "calc.drawer.priceTitle": "Total (RM) - including tax if any",
  "calc.drawer.cpuLabel": "Cost / unit",
  "calc.drawer.saveName": "Save name",
  "calc.drawer.historyTitle": "Purchase history",
  "calc.drawer.fifoLegend": "The batch/lot being used right now (active FIFO)",
  "calc.drawer.historyEmpty": "No history yet. Save the first record above.",

  // -? Bulk purchase -?????????????????????????????????????????????????????????
  "calc.bulk.title": "Bulk purchase",
  "calc.bulk.sub":
    "Record raw ingredient purchases. Recipe quantities are set later in <strong>Products &amp; cost</strong>.",
  "calc.bulk.colIngredient": "Raw ingredient",
  "calc.bulk.colQty": "Quantity",
  "calc.bulk.colPrice": "Price (RM)",
  "calc.bulk.addExisting": "Add existing ingredient",
  "calc.bulk.addNew": "Add new ingredient",
  "calc.bulk.taxLabel": "Tax / SST",
  "calc.bulk.subtotal": "Subtotal",
  "calc.bulk.grandTotal": "Grand total",
  "calc.bulk.confirm": "Confirm & save",
  "calc.bulk.selectIng": "-- Choose ingredient --",
  "calc.bulk.optAddNew": "+ Add new ingredient...",
  "calc.bulk.newNamePh": "New ingredient name",
  "calc.bulk.tagNew": "New",
  "calc.bulk.priceAria": "Price RM",
  "calc.bulk.removeRowAria": "Remove row",
  "calc.bulk.previewTitle": "Summary & tax allocation",
  "calc.bulk.taxPct": "Tax ({value}%)",
  "calc.bulk.taxRm": "Tax (RM {value})",
  "calc.bulk.newIngredient": "New ingredient",
  "calc.bulk.noIngSelected": "No ingredient selected",
  "calc.bulk.plusTax": "+ tax RM ",
  "calc.bulk.saving": "Saving...",
  "calc.bulk.savedOk": "Bulk purchase saved successfully!",
  "calc.bulk.errNoRows": "Add at least one ingredient.",
  "calc.bulk.errNewName": "Please enter a name for the new ingredient.",
  "calc.bulk.errSelectIng": "Please choose an ingredient for every row.",
  "calc.bulk.errQty": "Quantity must be more than 0.",
  "calc.bulk.errPrefix": "Error: ",

  // -? Status & confirmation messages -????????????????????????????????????????
  "calc.msg.fillName": "Enter a name.",
  "calc.msg.pickOneProduct": "Tick at least one product.",
  "calc.msg.packageSaved": "Package saved.",
  "calc.msg.packageUpdated": "Package updated.",
  "calc.msg.productAdded": "Product added.",
  "calc.msg.addSingleFirst": "Add a single product in Products & cost first.",
  "calc.msg.fillIngName": "Enter the ingredient name.",
  "calc.msg.priceNegative": "Total (RM) cannot be negative.",
  "calc.msg.packQtyPositive": "Package quantity must be more than 0.",
  "calc.msg.ingAdded": "Ingredient added.",
  "calc.msg.savingName": "Saving name...",
  "calc.msg.nameUpdated": "Name updated.",
  "calc.msg.qtyPositive": "Quantity bought must be > 0.",
  "calc.msg.saving": "Saving...",
  "calc.msg.saved": "Saved.",
  "calc.msg.qtyGtZero": "Quantity bought > 0.",
  "calc.msg.addingIng": "Adding ingredient...",
  "calc.msg.ingAddedLinked": "Ingredient added and linked to this menu item.",
  "calc.thisProduct": "this product",
  "calc.confirm.deleteProduct":
    'Delete "{name}" from Products & cost?\n\nThe document will be removed from Firestore (modifiers). This action cannot be undone.',
  "calc.impact.warning":
    "Cost went up - {count} products now have a low margin (<{threshold}%): {names}",

  // -? Firestore errors -??????????????????????????????????????????????????????
  "calc.err.unknown": "Unknown error.",
  "calc.err.permissionDenied":
    "Firestore denied the read/write. Update firestore.rules (for example: allow read/write for development) or use the Emulator - see PANDUAN-FIREBASE.md.",
  "calc.err.indexMissing":
    "History did not load: Firestore needs an index for the ingredient_ledger collection. Open the browser console (F12) for the - create index -  link, or run firebase deploy --only firestore:indexes.",

  // -? Date formatting per language -??????????????????????????????????????????
  "calc.dateLocale": "en-MY",
  "calc.ledger.wastage": "Wastage",
  "calc.ledger.initial": "Opening",
  "calc.ledger.purchase": "Buy",
  "calc.ledger.price": "Price",
  "calc.ledger.sale": "Sale"
};

export var COST_CALCULATOR = { ms: ms, en: en };
