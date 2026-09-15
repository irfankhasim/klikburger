/**
 * Kamus: POS ambil pesanan, troli, pembayaran, papan dapur (KDS).
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 */

var ms = {
  // Rangka halaman ambil pesanan
  "order.doc.title": "Ambil pesanan - Klik Burger",
  "order.h1": "Ambil pesanan",
  "order.menu.title": "Menu jualan",
  "order.cats.aria": "Kategori",
  "order.cart.title": "Pesanan semasa",
  "order.btn.clear": "Kosongkan troli",
  "order.btn.submit": "Hantar pesanan",
  "order.flow.close": "Tutup",

  // Grid menu jualan
  "order.grid.loading": "Memuatkan senarai menu\u2026",
  "order.grid.noProducts": "Tiada produk. Tambah di <strong>Produk &amp; kos</strong> atau semak sambungan.",
  "order.grid.emptyPackage": "Pakej kosong - ubah di Menu Produk atau pilih <strong>Semua menu</strong>.",
  "order.card.insufficientTitle": "Bahan tidak mencukupi untuk satu lagi unit (semak inventori / lot FIFO).",
  "order.cat.all": "Semua menu",
  "order.cat.packageFallback": "Pakej",
  "order.product.fallback": "Produk",

  // Troli
  "order.cart.empty": "Klik menu untuk tambah.",
  "order.line.plusAria": "Tambah",
  "order.line.minusAria": "Kurang",
  "order.line.maxTitle": "Stok maksimum {n} unit",
  "order.line.remove": "Buang",
  "order.stock.lowAlert": "Amaran stok rendah bagi bahan dalam pesanan ini!",
  "order.totals.subtotal": "Subjumlah",
  "order.totals.tax": "Cukai ({p}%)",
  "order.totals.total": "Jumlah",

  // Sekatan RBAC / drawer
  "order.rbac.readOnly":
    "Drawer ditutup - mod baca sahaja. Bayaran baharu tidak dibenarkan sehingga drawer baharu dibuka atau anda clock out.",
  "order.rbac.noDrawer": "Drawer belum dibuka - sila buka drawer untuk membolehkan checkout dan bayaran.",

  // Ralat
  "order.err.unknown": "Ralat tidak diketahui.",
  "order.err.permissionDenied":
    "Akses baca menu ditolak. Semak peraturan pangkalan data atau buka halaman Produk & kos sekali untuk ujian.",
  "order.err.buildMenu": "Menu tidak dapat dibina. Semak data produk atau konsol.",
  "order.err.incompleteTxn": "Transaksi jualan tidak lengkap (pesanan/resit).",

  // Aliran: semakan pesanan
  "order.flow.reviewTitle": "Semakan pesanan",
  "order.flow.reviewIntro": "Semak item sebelum pembayaran. Status: <strong>Belum bayar</strong>.",
  "order.flow.customerLabel": "Nama pelanggan",
  "order.flow.customerPlaceholder": "Contoh: Puan Aminah",
  "order.btn.back": "Kembali",
  "order.btn.toPayment": "Teruskan ke pembayaran",

  // Aliran: pembayaran
  "order.flow.payTitle": "Pembayaran",
  "order.flow.custPrefix": "Pelanggan:",
  "order.pay.cash": "Tunai",
  "order.flow.tenderedLabel": "Diberi pelanggan (RM)",
  "order.flow.balanceEmpty": "Baki: -",
  "order.flow.balanceFor": "Baki untuk pelanggan:",
  "order.btn.confirmPay": "Sahkan pembayaran",

  // Aliran: kejayaan
  "order.flow.successTitle": "Pembayaran berjaya",
  "order.flow.successLead": "Terima kasih - pesanan <strong>{no}</strong> telah direkodkan.",
  "order.flow.successPay": "Bayaran diterima ({label})",
  "order.flow.successReceipt": "Resit {no} dicipta",
  "order.flow.successTicket": "Tiket dapur {id} dihantar",
  "order.flow.successStock": "Stok dikemas kini (ikut resipi)",
  "order.flow.successOrder": "Pesanan {no} dalam <strong>Senarai pesanan</strong> (Menunggu)",
  "order.flow.cogsPrefix": "COGS:",
  "order.flow.grossPrefix": "Untung kasar:",
  "order.flow.changeLabel": "Baki tunai:",
  "order.btn.newOrder": "Pesanan baharu",

  // Toast
  "order.toast.insufficientAdd": "Bahan tidak mencukupi untuk tambah item ini.",
  "order.toast.insufficientQty": "Bahan tidak mencukupi untuk tambah kuantiti.",
  "order.toast.maxForItem": "Had maksimum {n} unit untuk {name} berdasarkan stok semasa.",
  "order.toast.maxQty": "Had maksimum {n} unit berdasarkan stok semasa.",
  "order.toast.thisItem": "item ini",
  "order.toast.needCustomer": "Sila masukkan nama pelanggan.",
  "order.toast.needCustomerBack": "Sila masukkan nama pelanggan - kembali ke semakan pesanan.",
  "order.toast.payNotAllowed": "Bayaran tidak dibenarkan - sila clock in dahulu.",
  "order.toast.tenderShort": "Amaun diberi tidak mencukupi.",
  "order.toast.stockShortFlow": "Stok tidak mencukupi - tutup aliran dan semak troli.",
  "order.toast.openDrawerFirst": "Buka drawer dahulu untuk menerima bayaran.",
  "order.toast.cartEmpty": "Troli kosong - tambah item dahulu.",
  "order.toast.ingredientsLoading": "Data bahan belum dimuatkan - tunggu sebentar atau muat semula halaman.",
  "order.toast.stockShortSale": "Stok bahan tidak mencukupi untuk jualan ini - kurangkan kuantiti dalam troli.",

  // Papan dapur (KDS)
  "order.board.doc.title": "Senarai pesanan - Klik Burger",
  "order.board.h1": "Senarai pesanan",
  "order.board.col.waiting": "Menunggu",
  "order.board.col.preparing": "Penyediaan",
  "order.board.col.ready": "Siap",
  "order.board.col.handed": "Diserahkan",
  "order.board.noOrders": "Tiada pesanan",
  "order.board.readOnly": "Read-only (shift closed).",
  "order.board.rbacReadOnly": "Drawer ditutup - papan pesanan dalam mod baca sahaja.",
  "order.board.aria.prev": "Alih ke kolum sebelumnya",
  "order.board.aria.next": "Alih ke kolum seterusnya",
  "order.board.aria.markDone": "Tandakan pesanan Selesai",
  "order.board.title.next": "Kolum seterusnya",
  "order.board.title.markDone": "Tandakan Selesai (keluar dari papan)"
};

var en = {
  // Order-taking page shell
  "order.doc.title": "Take order - Klik Burger",
  "order.h1": "Take order",
  "order.menu.title": "Sales menu",
  "order.cats.aria": "Categories",
  "order.cart.title": "Current order",
  "order.btn.clear": "Clear cart",
  "order.btn.submit": "Submit order",
  "order.flow.close": "Close",

  // Sales menu grid
  "order.grid.loading": "Loading menu list\u2026",
  "order.grid.noProducts": "No products yet. Add them under <strong>Products &amp; costs</strong> or check your connection.",
  "order.grid.emptyPackage": "Empty package - change it in the Product Menu or pick <strong>All menu</strong>.",
  "order.card.insufficientTitle": "Not enough ingredients for another unit (check inventory / FIFO lot).",
  "order.cat.all": "All menu",
  "order.cat.packageFallback": "Package",
  "order.product.fallback": "Product",

  // Cart
  "order.cart.empty": "Tap a menu item to add it.",
  "order.line.plusAria": "Increase",
  "order.line.minusAria": "Decrease",
  "order.line.maxTitle": "Maximum stock {n} units",
  "order.line.remove": "Remove",
  "order.stock.lowAlert": "Low stock warning for ingredients in this order!",
  "order.totals.subtotal": "Subtotal",
  "order.totals.tax": "Tax ({p}%)",
  "order.totals.total": "Total",

  // RBAC / drawer restrictions
  "order.rbac.readOnly":
    "Drawer closed - read-only mode. New payments are not allowed until a new drawer is opened or you Clock Out.",
  "order.rbac.noDrawer": "Drawer not opened yet - please open a drawer to enable checkout and payment.",

  // Errors
  "order.err.unknown": "Unknown error.",
  "order.err.permissionDenied":
    "Menu read access denied. Check the database rules or open the Products & costs page once to test.",
  "order.err.buildMenu": "Could not build the menu. Check the product data or the console.",
  "order.err.incompleteTxn": "Incomplete sale transaction (order/receipt).",

  // Flow: order review
  "order.flow.reviewTitle": "Order review",
  "order.flow.reviewIntro": "Check the items before payment. Status: <strong>Unpaid</strong>.",
  "order.flow.customerLabel": "Customer name",
  "order.flow.customerPlaceholder": "Example: Puan Aminah",
  "order.btn.back": "Back",
  "order.btn.toPayment": "Continue to payment",

  // Flow: payment
  "order.flow.payTitle": "Payment",
  "order.flow.custPrefix": "Customer:",
  "order.pay.cash": "Cash",
  "order.flow.tenderedLabel": "Given by customer (RM)",
  "order.flow.balanceEmpty": "Change: ...",
  "order.flow.balanceFor": "Change for customer:",
  "order.btn.confirmPay": "Confirm payment",

  // Flow: success
  "order.flow.successTitle": "Payment successful",
  "order.flow.successLead": "Thank you - order <strong>{no}</strong> has been recorded.",
  "order.flow.successPay": "Payment received ({label})",
  "order.flow.successReceipt": "Receipt {no} created",
  "order.flow.successTicket": "Kitchen ticket {id} sent",
  "order.flow.successStock": "Stock updated (based on the recipe)",
  "order.flow.successOrder": "Order {no} is in the <strong>Order list</strong> (Waiting)",
  "order.flow.cogsPrefix": "COGS:",
  "order.flow.grossPrefix": "Gross profit:",
  "order.flow.changeLabel": "Cash change:",
  "order.btn.newOrder": "New order",

  // Toasts
  "order.toast.insufficientAdd": "Not enough ingredients to add this item.",
  "order.toast.insufficientQty": "Not enough ingredients to increase the quantity.",
  "order.toast.maxForItem": "Maximum of {n} units for {name} based on current stock.",
  "order.toast.maxQty": "Maximum of {n} units based on current stock.",
  "order.toast.thisItem": "this item",
  "order.toast.needCustomer": "Please enter the customer name.",
  "order.toast.needCustomerBack": "Please enter the customer name - going back to the order review.",
  "order.toast.payNotAllowed": "Payment not allowed - please clock in first.",
  "order.toast.tenderShort": "The amount given is not enough.",
  "order.toast.stockShortFlow": "Not enough stock - close this flow and check the cart.",
  "order.toast.openDrawerFirst": "Open a drawer first to accept payment.",
  "order.toast.cartEmpty": "Cart is empty - add items first.",
  "order.toast.ingredientsLoading": "Ingredient data has not loaded yet - wait a moment or reload the page.",
  "order.toast.stockShortSale": "Not enough ingredient stock for this sale - reduce the quantity in the cart.",

  // Kitchen display (KDS)
  "order.board.doc.title": "Order list - Klik Burger",
  "order.board.h1": "Order list",
  "order.board.col.waiting": "Waiting",
  "order.board.col.preparing": "Preparing",
  "order.board.col.ready": "Ready",
  "order.board.col.handed": "Handed over",
  "order.board.noOrders": "No orders",
  "order.board.readOnly": "Read-only (shift closed).",
  "order.board.rbacReadOnly": "Drawer closed - the order board is in read-only mode.",
  "order.board.aria.prev": "Move to previous column",
  "order.board.aria.next": "Move to next column",
  "order.board.aria.markDone": "Mark order as Done",
  "order.board.title.next": "Next column",
  "order.board.title.markDone": "Mark as Done (leaves the board)"
};

export var ORDER = { ms: ms, en: en };
