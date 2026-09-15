/**
 * Kamus: Senarai resit, butiran resit, void dan refund.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 */

var ms = {
  // ?? Halaman & penapis ???????????????????????????????????????????????????????
  "receipt.docTitle": "Resit - Klik Burger",
  "receipt.listLabel": "Senarai resit",
  "receipt.search": "Cari",
  "receipt.searchPlaceholder": "No. resit / pesanan",
  "receipt.filter.pay": "Bayaran",
  "receipt.filter.all": "Semua",

  // Label kaedah bayaran - dipakai juga oleh paymentMethodLabel() dalam hub.
  "receipt.pay.cash": "Tunai",
  "receipt.pay.qr": "QR",

  // ?? Banner RBAC ?????????????????????????????????????????????????????????????
  "receipt.banner.readOnlyStaff":
    "Mod baca sahaja - resit boleh dilihat. Untuk void/refund, clock in dan buka drawer di menu <strong>Clock In / Drawer</strong>.",
  "receipt.banner.drawerClosed":
    "Drawer ditutup - skrin ini baca sahaja sehingga anda clock out atau pengurus membuka drawer baharu.",
  "receipt.banner.drawerNotOpen":
    "Drawer belum dibuka - void dan kawalan tunai: buka drawer di menu utama, <strong>Clock In / Drawer</strong>.",

  // ?? Senarai ?????????????????????????????????????????????????????????????????
  "receipt.count.none": "Tiada resit.",
  "receipt.count.one": "1 resit.",
  "receipt.count.suffix": " resit.",
  "receipt.list.empty":
    "Tiada resit dijumpai. Jualan daripada skrin <strong>Jualan</strong> akan muncul di sini.",
  "receipt.tag.void": "Batal",
  "receipt.tag.valid": "Sah",

  // ?? Drawer butiran ??????????????????????????????????????????????????????????
  "receipt.drawer.title": "Resit",
  "receipt.detail.total": "Jumlah",
  "receipt.detail.time": "Masa",
  "receipt.detail.payment": "Bayaran",
  "receipt.detail.customer": "Nama pelanggan",
  "receipt.detail.saleId": "ID jualan",
  "receipt.detail.items": "Item",
  "receipt.detail.noLines": "Tiada baris item.",
  "receipt.item.unnamed": "(Item)",
  "receipt.action.print": "Cetak",
  "receipt.action.void": "Void",
  "receipt.action.refund": "Refund",
  "receipt.action.delete": "Padam rekod",
  "receipt.delete.confirmPrefix": "Padam rekod ",
  "receipt.delete.confirmSuffix":
    " daripada senarai? Pesanan dapur berkaitan turut dibuang daripada pangkalan data.",

  // ?? Void ????????????????????????????????????????????????????????????????????
  "receipt.void.unavailable":
    "Void tidak tersedia - buka drawer di menu Clock In / Drawer, atau tunggu keluar mod baca sahaja.",
  "receipt.void.ownerOverride": "Owner override - void this receipt? (Audit will record override.)",
  "receipt.void.pinLocked": "PIN dikunci - cuba lagi kemudian.",
  "receipt.void.pinPrompt": "Manager PIN (prototype ",
  "receipt.void.done": "Resit dibatalkan (audit).",

  // ?? Refund ??????????????????????????????????????????????????????????????????
  "receipt.refund.title": "Pemulangan wang (Refund)",
  "receipt.refund.receiptNo": "No. Resit",
  "receipt.refund.amount": "Jumlah refund",
  "receipt.refund.method": "Kaedah",
  "receipt.refund.reason": "Sebab refund",
  "receipt.refund.reasonPlaceholder": "Contoh: Pesanan salah, pelanggan tidak berpuas hati",
  "receipt.refund.cancel": "Batal",
  "receipt.refund.confirm": "Sahkan refund",
  "receipt.refund.processing": "Memproses...",
  "receipt.refund.unavailable":
    "Refund tidak tersedia - buka drawer di menu Clock In / Drawer, atau tunggu keluar mod baca sahaja.",
  "receipt.refund.needDrawer": "Refund tidak tersedia - buka drawer dahulu.",
  "receipt.refund.pmCash": "Tunai (akan dipulangkan dari drawer)",
  "receipt.refund.pmQr": "QR/Online (proses manual diperlukan)",
  "receipt.refund.defaultNote": "Pemulangan wang",
  "receipt.refund.okCashPrefix": "Refund berjaya. RM ",
  "receipt.refund.okCashSuffix": " telah dipulangkan dari drawer tunai.",
  "receipt.refund.okQr": "Refund direkodkan. Bayaran QR/online perlu diproses secara manual.",
  "receipt.refund.errorPrefix": "Ralat: "
};

var en = {
  // ?? Halaman & penapis ???????????????????????????????????????????????????????
  "receipt.docTitle": "Receipts - Klik Burger",
  "receipt.listLabel": "Receipt list",
  "receipt.search": "Search",
  "receipt.searchPlaceholder": "Receipt / order no.",
  "receipt.filter.pay": "Payment",
  "receipt.filter.all": "All",

  "receipt.pay.cash": "Cash",
  "receipt.pay.qr": "QR",

  // ?? Banner RBAC ?????????????????????????????????????????????????????????????
  "receipt.banner.readOnlyStaff":
    "Read-only mode - receipts can be viewed. To void/refund, clock in and open the drawer from the <strong>Clock In / Drawer</strong> menu.",
  "receipt.banner.drawerClosed":
    "Drawer closed - this screen is read-only until you clock out or a manager opens a new drawer.",
  "receipt.banner.drawerNotOpen":
    "Drawer not open yet - for void and cash controls, open the drawer from the main menu, <strong>Clock In / Drawer</strong>.",

  // ?? Senarai ?????????????????????????????????????????????????????????????????
  "receipt.count.none": "No receipts.",
  "receipt.count.one": "1 receipt.",
  "receipt.count.suffix": " receipts.",
  "receipt.list.empty":
    "No receipts found. Sales from the <strong>Sales</strong> screen will appear here.",
  "receipt.tag.void": "Voided",
  "receipt.tag.valid": "Valid",

  // ?? Drawer butiran ??????????????????????????????????????????????????????????
  "receipt.drawer.title": "Receipt",
  "receipt.detail.total": "Total",
  "receipt.detail.time": "Time",
  "receipt.detail.payment": "Payment",
  "receipt.detail.customer": "Customer name",
  "receipt.detail.saleId": "Sale ID",
  "receipt.detail.items": "Items",
  "receipt.detail.noLines": "No item lines.",
  "receipt.item.unnamed": "(Item)",
  "receipt.action.print": "Print",
  "receipt.action.void": "Void",
  "receipt.action.refund": "Refund",
  "receipt.action.delete": "Delete record",
  "receipt.delete.confirmPrefix": "Delete record ",
  "receipt.delete.confirmSuffix":
    " from the list? The related kitchen order will also be removed from the database.",

  // ?? Void ????????????????????????????????????????????????????????????????????
  "receipt.void.unavailable":
    "Void is unavailable - open the drawer from the Clock In / Drawer menu, or wait until read-only mode ends.",
  "receipt.void.ownerOverride": "Owner override - void this receipt? (Audit will record override.)",
  "receipt.void.pinLocked": "PIN locked - please try again later.",
  "receipt.void.pinPrompt": "Manager PIN (prototype ",
  "receipt.void.done": "Receipt voided (audited).",

  // ?? Refund ??????????????????????????????????????????????????????????????????
  "receipt.refund.title": "Refund",
  "receipt.refund.receiptNo": "Receipt No.",
  "receipt.refund.amount": "Refund amount",
  "receipt.refund.method": "Method",
  "receipt.refund.reason": "Refund reason",
  "receipt.refund.reasonPlaceholder": "Example: Wrong order, customer not satisfied",
  "receipt.refund.cancel": "Cancel",
  "receipt.refund.confirm": "Confirm refund",
  "receipt.refund.processing": "Processing...",
  "receipt.refund.unavailable":
    "Refund is unavailable - open the drawer from the Clock In / Drawer menu, or wait until read-only mode ends.",
  "receipt.refund.needDrawer": "Refund is unavailable - open the drawer first.",
  "receipt.refund.pmCash": "Cash (will be returned from the drawer)",
  "receipt.refund.pmQr": "QR/Online (manual processing required)",
  "receipt.refund.defaultNote": "Refund",
  "receipt.refund.okCashPrefix": "Refund successful. RM ",
  "receipt.refund.okCashSuffix": " has been returned from the cash drawer.",
  "receipt.refund.okQr": "Refund recorded. QR/online payment must be processed manually.",
  "receipt.refund.errorPrefix": "Error: "
};

export var RECEIPTS = { ms: ms, en: en };
