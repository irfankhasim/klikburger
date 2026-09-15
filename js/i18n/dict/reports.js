/**
 * Kamus: Laporan bulanan penuh dan menu costing.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 */

var ms = {
  // ?? Nama bulan (dipakai oleh penapis dan tajuk laporan) ?????????????????????
  "report.month.0": "Jan",
  "report.month.1": "Feb",
  "report.month.2": "Mac",
  "report.month.3": "Apr",
  "report.month.4": "Mei",
  "report.month.5": "Jun",
  "report.month.6": "Jul",
  "report.month.7": "Ogs",
  "report.month.8": "Sep",
  "report.month.9": "Okt",
  "report.month.10": "Nov",
  "report.month.11": "Dis",

  // ?? Halaman laporan bulanan: toolbar ????????????????????????????????????????
  "report.docTitle": "Laporan Perniagaan - Tab Kaunter",
  "report.heading": "Laporan Perniagaan",
  "report.filtersLabel": "Penapis laporan",
  "report.year": "Tahun",
  "report.monthField": "Bulan",
  "report.generate": "Jana laporan",
  "report.generating": "Jana...",
  "report.downloadPdf": "Muat turun PDF",
  "report.tip.cannotGenerate": "Tidak boleh jana laporan untuk bulan semasa atau hadapan",
  "report.tip.canGenerate": "Jana laporan untuk tempoh ini",

  // ?? Keadaan kosong ??????????????????????????????????????????????????????????
  "report.empty.title": "Tiada laporan untuk tempoh ini.",
  "report.empty.hint": "Klik <strong>Jana laporan</strong> untuk menjana laporan baru.",

  // ?? Dokumen laporan ?????????????????????????????????????????????????????????
  "report.doc.title": "Laporan Prestasi Perniagaan",
  "report.doc.generated": "Dijana:",
  "report.orders": "pesanan",

  "report.section.financial": "Ringkasan kewangan",
  "report.section.topMenu": "Menu paling laris",
  "report.section.stock": "Status stok bahan",
  "report.section.expenses": "Perbelanjaan bulan ini",
  "report.section.payments": "Cara pembayaran pelanggan",
  "report.section.staff": "Senarai kakitangan",
  "report.section.actions": "Cadangan tindakan bulan depan",

  "report.kpi.totalSales": "Jumlah jualan",
  "report.kpi.netProfit": "Untung / Rugi bersih",
  "report.row.successfulTx": "Jumlah transaksi berjaya",
  "report.row.avgPerCustomer": "Nilai purata setiap pelanggan",
  "report.row.grossProfit": "Keuntungan kasar",
  "report.row.cogs": "Kos bahan digunakan",
  "report.row.wastage": "Pembaziran (kos lot belian)",
  "report.row.payroll": "Kos gaji pekerja",
  "report.row.netTotal": "untung/rugi",

  "report.topMenu.empty": "Jana laporan semula untuk lihat menu paling laris.",

  "report.stock.statusLabel": "Status stok",
  "report.stock.allSufficient": "Semua stok mencukupi",
  "report.stock.out": "Habis",
  "report.stock.low": "Rendah",
  "report.stock.used": "guna",
  "report.stock.wasted": "pembaziran",
  "report.stock.remaining": "berbaki",

  "report.exp.salary": "Gaji pekerja",
  "report.exp.wastage": "Pembaziran (harga lot belian)",
  "report.exp.purchasesThisMonth": "Pembelian stok bulan ini",
  "report.exp.tax": " -  termasuk cukai/SST belian borong",
  "report.exp.note":
    "* COGS = kos lot FIFO pada jualan. Pembaziran = harga lot belian yang dibuang; ditolak dari untung/rugi bersih, bukan dari keuntungan kasar.",

  "report.pay.cash": "Tunai",
  "report.pay.qr": "QR / DuitNow",

  "report.staff.empty":
    "Tiada rekod kakitangan - jalankan <code>node scripts/add-owner-staff.js</code> jika perlu.",
  "report.staff.owner": "Owner",
  "report.staff.noSalary": "tiada",
  "report.staff.hours": "jam",
  "report.staff.sessions": "sesi",
  "report.staff.estSalary": "Gaji anggaran",
  "report.staff.attendance": "Kehadiran bulan ini",

  "report.action.increaseSalesPre": "Tingkatkan jualan - perlu capai sekurang-kurangnya",
  "report.action.increaseSalesPost": "sebulan untuk titik pulang modal",
  "report.action.restock": "Restock segera:",
  "report.action.payrollHigh":
    "Kos gaji tinggi berbanding jualan - semak jadual bertugas dan kurangkan pada hari jualan rendah",
  "report.action.good":
    "Prestasi bulan ini baik - teruskan strategi semasa dan cari peluang untuk meningkatkan jualan",

  "report.footer.pre":
    "Laporan ini dijana secara automatik oleh sistem POS Klik Burger berdasarkan data",
  "report.footer.post":
    "Angka adalah anggaran - sila rujuk akauntan untuk penyata kewangan rasmi.",

  // ?? Status / makluman ???????????????????????????????????????????????????????
  "report.status.monthPrefix": "Bulan",
  "report.status.monthOngoing":
    "masih berjalan - laporan hanya boleh dijana selepas bulan tamat.",
  "report.status.monthNotStarted": "belum bermula - laporan tidak tersedia.",
  "report.status.noReportPre": "Tiada laporan untuk",
  "report.status.noReportPost": " -  klik Jana laporan.",
  "report.status.loadedPre": "Laporan",
  "report.status.loadedPost": "dimuatkan.",
  "report.status.loadFail": "Gagal memuatkan laporan.",
  "report.status.generatingPre": "Menjana laporan",
  "report.status.generateOk": "Laporan berjaya dijana.",
  "report.status.generateFail": "Gagal jana laporan.",
  "report.status.nothingToDownload": "Tiada laporan untuk dimuat turun.",
  "report.status.generatingPdf": "Menjana PDF...",
  "report.status.pdfOk": "PDF berjaya dimuat turun.",
  "report.status.pdfFail": "Gagal jana PDF:",

  "report.alert.ownerOnly": "Hanya pemilik boleh jana laporan.",
  "report.alert.currentMonthPre": "Laporan untuk bulan semasa",
  "report.alert.currentMonthPost":
    "tidak boleh dijana kerana bulan ini belum tamat. Sila tunggu sehingga bulan hadapan.",
  "report.alert.futureMonth": "Laporan untuk bulan hadapan tidak boleh dijana.",

  // ?? PDF (tajuk seksyen memakai huruf besar setiap perkataan) ????????????????
  "report.pdf.confidential": "Klik Burger - Laporan Sulit Dalaman",
  "report.pdf.section.financial": "Ringkasan Kewangan",
  "report.pdf.section.topMenu": "Menu Paling Laris",
  "report.pdf.section.stock": "Status Stok Bahan",
  "report.pdf.section.expenses": "Perbelanjaan Bulan Ini",
  "report.pdf.section.payments": "Cara Pembayaran Pelanggan",
  "report.pdf.section.actions": "Cadangan Tindakan Bulan Depan",
  "report.pdf.row.totalTx": "Jumlah transaksi",
  "report.pdf.row.purchases": "Pembelian stok bahan",
  "report.pdf.action.increaseSalesPost": "sebulan",
  "report.pdf.action.payrollHigh":
    "Kos gaji tinggi - semak jadual bertugas pada hari jualan rendah",
  "report.pdf.action.good": "Prestasi baik - teruskan strategi semasa",

  // ?? Kos menu (Firestore) ????????????????????????????????????????????????????
  "report.costing.docTitle": "Kos menu (Firestore) - Klik Burger",
  "report.costing.heading": "Kos menu (Firestore)",
  "report.costing.lead":
    "Jadual gabungan <code>menu_items</code> + <code>recipes</code> + <code>ingredients</code>. Ubah <strong>harga jual</strong> dalam jadual - nilai akan disimpan ke Firestore selepas anda klik luar medan atau tekan Enter. Kalkulator asal kekal di <a href=\"pos-cost-calculator.html\">pos-cost-calculator.html</a> (koleksi <code>modifiers</code>).",
  "report.costing.seedDemo": "Seed demo",
  "report.costing.mainMenu": "? Menu utama",
  "report.costing.th.item": "Menu item",
  "report.costing.th.recipe": "Resipi",
  "report.costing.th.cost": "Harga modal",
  "report.costing.th.sell": "Harga jual",
  "report.costing.th.profit": "Untung",
  "report.costing.th.margin": "Margin",
  "report.costing.loadingHint":
    "Memuatkan -  pastikan Firestore Rules membenarkan bacaan koleksi ini.",
  "report.costing.emptyHtml":
    "Tiada <code>menu_items</code> lagi. Klik <strong>Seed demo</strong> (jika koleksi kosong) atau tambah dokumen dalam Firestore.",
  "report.costing.noRecipe": "(tiada resipi)",
  "report.costing.recipeMissing": "recipeId tidak jumpa",
  "report.costing.sellAriaPrefix": "Harga jual untuk",
  "report.costing.errIngredients": "Ralat ingredients:",
  "report.costing.checking": "Menyemak...",
  "report.costing.seedAdded": "Seed demo ditambah.",
  "report.costing.seedUnchanged": "Tidak diubah:",
  "report.costing.error": "Ralat:"
};

var en = {
  // ?? Month names ?????????????????????????????????????????????????????????????
  "report.month.0": "Jan",
  "report.month.1": "Feb",
  "report.month.2": "Mar",
  "report.month.3": "Apr",
  "report.month.4": "May",
  "report.month.5": "Jun",
  "report.month.6": "Jul",
  "report.month.7": "Aug",
  "report.month.8": "Sep",
  "report.month.9": "Oct",
  "report.month.10": "Nov",
  "report.month.11": "Dec",

  // ?? Monthly report page: toolbar ????????????????????????????????????????????
  "report.docTitle": "Business Report - Tab Kaunter",
  "report.heading": "Business Report",
  "report.filtersLabel": "Report filters",
  "report.year": "Year",
  "report.monthField": "Month",
  "report.generate": "Generate report",
  "report.generating": "Generating...",
  "report.downloadPdf": "Download PDF",
  "report.tip.cannotGenerate": "Cannot generate a report for the current or a future month",
  "report.tip.canGenerate": "Generate the report for this period",

  // ?? Empty state ?????????????????????????????????????????????????????????????
  "report.empty.title": "No report for this period.",
  "report.empty.hint": "Click <strong>Generate report</strong> to create a new report.",

  // ?? Report document ?????????????????????????????????????????????????????????
  "report.doc.title": "Business Performance Report",
  "report.doc.generated": "Generated:",
  "report.orders": "orders",

  "report.section.financial": "Financial summary",
  "report.section.topMenu": "Best-selling menu items",
  "report.section.stock": "Ingredient stock status",
  "report.section.expenses": "Expenses this month",
  "report.section.payments": "Customer payment methods",
  "report.section.staff": "Staff list",
  "report.section.actions": "Recommended actions for next month",

  "report.kpi.totalSales": "Total sales",
  "report.kpi.netProfit": "Net profit / loss",
  "report.row.successfulTx": "Total successful transactions",
  "report.row.avgPerCustomer": "Average value per customer",
  "report.row.grossProfit": "Gross profit",
  "report.row.cogs": "Cost of ingredients used",
  "report.row.wastage": "Wastage (purchase-lot cost)",
  "report.row.payroll": "Staff salary cost",
  "report.row.netTotal": "profit/loss",

  "report.topMenu.empty": "Regenerate the report to see the best-selling menu items.",

  "report.stock.statusLabel": "Stock status",
  "report.stock.allSufficient": "All stock is sufficient",
  "report.stock.out": "Out of stock",
  "report.stock.low": "Low",
  "report.stock.used": "used",
  "report.stock.wasted": "wastage",
  "report.stock.remaining": "remaining",

  "report.exp.salary": "Staff salaries",
  "report.exp.wastage": "Wastage (purchase-lot price)",
  "report.exp.purchasesThisMonth": "Stock purchases this month",
  "report.exp.tax": " -  including tax/SST on wholesale purchases",
  "report.exp.note":
    "* COGS = FIFO lot cost of sales. Wastage = purchase-lot price of stock thrown away; deducted from net profit/loss, not from gross profit.",

  "report.pay.cash": "Cash",
  "report.pay.qr": "QR / DuitNow",

  "report.staff.empty":
    "No staff records - run <code>node scripts/add-owner-staff.js</code> if needed.",
  "report.staff.owner": "Owner",
  "report.staff.noSalary": "none",
  "report.staff.hours": "hours",
  "report.staff.sessions": "sessions",
  "report.staff.estSalary": "Estimated salary",
  "report.staff.attendance": "Attendance this month",

  "report.action.increaseSalesPre": "Increase sales - you need to reach at least",
  "report.action.increaseSalesPost": "a month to break even",
  "report.action.restock": "Restock immediately:",
  "report.action.payrollHigh":
    "Salary cost is high relative to sales - review the duty roster and cut back on low-sales days",
  "report.action.good":
    "This month's performance is good - keep the current strategy and look for ways to grow sales",

  "report.footer.pre":
    "This report was generated automatically by the Klik Burger POS system based on data for",
  "report.footer.post":
    "Figures are estimates - please consult an accountant for official financial statements.",

  // ?? Status / alerts ?????????????????????????????????????????????????????????
  "report.status.monthPrefix": "Month",
  "report.status.monthOngoing":
    "is still in progress - the report can only be generated after the month ends.",
  "report.status.monthNotStarted": "has not started - the report is not available.",
  "report.status.noReportPre": "No report for",
  "report.status.noReportPost": " -  click Generate report.",
  "report.status.loadedPre": "Report",
  "report.status.loadedPost": "loaded.",
  "report.status.loadFail": "Failed to load the report.",
  "report.status.generatingPre": "Generating report",
  "report.status.generateOk": "Report generated successfully.",
  "report.status.generateFail": "Failed to generate the report.",
  "report.status.nothingToDownload": "No report available to download.",
  "report.status.generatingPdf": "Generating PDF...",
  "report.status.pdfOk": "PDF downloaded successfully.",
  "report.status.pdfFail": "Failed to generate the PDF:",

  "report.alert.ownerOnly": "Only the owner can generate reports.",
  "report.alert.currentMonthPre": "The report for the current month",
  "report.alert.currentMonthPost":
    "cannot be generated because this month has not ended. Please wait until next month.",
  "report.alert.futureMonth": "A report for a future month cannot be generated.",

  // ?? PDF (section titles use Title Case) ?????????????????????????????????????
  "report.pdf.confidential": "Klik Burger - Internal Confidential Report",
  "report.pdf.section.financial": "Financial Summary",
  "report.pdf.section.topMenu": "Best-Selling Menu Items",
  "report.pdf.section.stock": "Ingredient Stock Status",
  "report.pdf.section.expenses": "Expenses This Month",
  "report.pdf.section.payments": "Customer Payment Methods",
  "report.pdf.section.actions": "Recommended Actions For Next Month",
  "report.pdf.row.totalTx": "Total transactions",
  "report.pdf.row.purchases": "Ingredient stock purchases",
  "report.pdf.action.increaseSalesPost": "a month",
  "report.pdf.action.payrollHigh":
    "Salary cost is high - review the duty roster on low-sales days",
  "report.pdf.action.good": "Good performance - keep the current strategy",

  // ?? Menu costing (Firestore) ????????????????????????????????????????????????
  "report.costing.docTitle": "Menu cost (Firestore) - Klik Burger",
  "report.costing.heading": "Menu cost (Firestore)",
  "report.costing.lead":
    "Combined table of <code>menu_items</code> + <code>recipes</code> + <code>ingredients</code>. Change the <strong>selling price</strong> in the table - the value is saved to Firestore after you click outside the field or press Enter. The original calculator remains at <a href=\"pos-cost-calculator.html\">pos-cost-calculator.html</a> (the <code>modifiers</code> collection).",
  "report.costing.seedDemo": "Seed demo",
  "report.costing.mainMenu": "? Main menu",
  "report.costing.th.item": "Menu item",
  "report.costing.th.recipe": "Recipe",
  "report.costing.th.cost": "Cost price",
  "report.costing.th.sell": "Selling price",
  "report.costing.th.profit": "Profit",
  "report.costing.th.margin": "Margin",
  "report.costing.loadingHint":
    "Loading -  make sure the Firestore Rules allow reading these collections.",
  "report.costing.emptyHtml":
    "No <code>menu_items</code> yet. Click <strong>Seed demo</strong> (if the collection is empty) or add documents in Firestore.",
  "report.costing.noRecipe": "(no recipe)",
  "report.costing.recipeMissing": "recipeId not found",
  "report.costing.sellAriaPrefix": "Selling price for",
  "report.costing.errIngredients": "Ingredients error:",
  "report.costing.checking": "Checking...",
  "report.costing.seedAdded": "Seed demo added.",
  "report.costing.seedUnchanged": "Unchanged:",
  "report.costing.error": "Error:"
};

export var REPORTS = { ms: ms, en: en };
