/**
 * Kamus: shell, navigasi, log masuk.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri.
 *
 * DUA PERATURAN PENTING:
 *
 * 1. Entri `ms` mesti sama tepat dengan teks yang sudah dipakai dalam sistem.
 *    Kamus ini bukan tempat memperbaiki wording Melayu — ia cuma memindahkan teks
 *    sedia ada ke satu tempat. Ini memastikan pengguna Melayu tidak nampak apa-apa
 *    perubahan apabila i18n dihidupkan.
 *
 * 2. Istilah yang lebih lazim dalam Bahasa Inggeris dikekalkan dalam Bahasa
 *    Inggeris walaupun dalam mod Melayu, kerana itulah yang digunakan di kaunter
 *    sebenar. Contohnya: POS, Point Of Sale, Back Office, Clock In, Clock Out,
 *    drawer, shift, KDS, COGS, QR. Istilah yang sudah lama diserap ke Bahasa
 *    Melayu pula dikekalkan dalam bentuk Melayu: resit, stok, inventori, menu,
 *    laporan, log masuk, kata laluan.
 */

var ms = {
  // ── Butang bahasa ───────────────────────────────────────────────────────────
  "lang.label": "Bahasa",
  "lang.ms": "BM",
  "lang.en": "EN",
  "lang.switchToEn": "Tukar ke Bahasa Inggeris",
  "lang.switchToMs": "Tukar ke Bahasa Melayu",
  "app.refresh": "Muat semula",
  "app.refreshHint": "Muat semula sistem jika ia menjadi perlahan atau tidak bertindak balas.",

  // ── Umum ────────────────────────────────────────────────────────────────────
  "common.loading": "Memuatkan…",
  "common.loadingMenu": "Memuatkan menu",
  "common.close": "Tutup",
  "common.cancel": "Batal",
  "common.logout": "Log keluar",

  // ── Log masuk ───────────────────────────────────────────────────────────────
  "login.docTitle": "Log masuk — TAB KAUNTER",
  "login.srHeading": "Selamat datang — log masuk TAB KAUNTER",
  "login.title": "Selamat datang",
  "login.lead": "Gembira melihat anda semula. Log masuk untuk teruskan ke menu utama.",
  "login.email": "E-mel",
  "login.emailPlaceholder": "nama@restoran.com",
  "login.password": "Kata laluan",
  "login.showPassword": "Tunjuk kata laluan",
  "login.submit": "Teruskan ke menu",
  "login.noAccount": "Belum ada akaun?",
  "login.requestAccess": "Mohon akses",
  "login.kicker": "Sistem POS Digital",
  "login.secure": "Log masuk selamat untuk kaunter",

  // ── Shell: bar sisi ─────────────────────────────────────────────────────────
  "shell.sidebarLabel": "Menu TAB KAUNTER",
  "nav.sidebarCollapse": "Sembunyikan menu sisi",
  "nav.sidebarExpand": "Tunjuk menu sisi",

  "nav.posLabel": "Menu jualan",
  "nav.section.operations": "Operasi",
  "nav.clockIn": "Clock In",
  "nav.sales": "Jualan",
  "nav.receipts": "Resit",
  "nav.orderList": "Senarai pesanan",

  "nav.boLabel": "Menu pejabat belakang",
  "nav.section.overview": "Ringkasan",
  "nav.dashboard": "Papan pemuka",
  "nav.section.reports": "Laporan",
  "nav.fullReport": "Laporan penuh",
  "nav.section.productsStaff": "Produk & kakitangan",
  "nav.products": "Produk",
  "nav.staff": "Kakitangan",
  "nav.section.inventory": "Inventori",
  "nav.ingredients": "Bahan mentah",
  "nav.productsCost": "Produk & kos",
  "nav.wastage": "Pembaziran",
  "nav.section.system": "Sistem",
  "nav.settings": "Tetapan",

  // ── Shell: lead menu sisi (tooltip bawah topbar) ────────────────────────────
  "lead.clockIn": "Clock in dahulu, kemudian buka drawer, kemudian jualan. Owner dan staf ikut aliran yang sama.",
  "lead.sales":
    "Aliran: troli → semakan → pembayaran → resit &amp; senarai dapur. Disambung dengan <strong>Resit</strong> dan <strong>Senarai pesanan</strong>.",
  "lead.receipts":
    "Senarai resit — disegerakkan dengan jualan. Drawer tunai &amp; audit: menu <strong>Clock In</strong>.",
  "lead.orderList": "Papan dapur (KDS) — status pesanan selepas bayaran.",

  // ── Shell: tajuk topbar bagi setiap paparan ─────────────────────────────────
  "topbar.staff": "Kakitangan",
  "topbar.fullReport": "Laporan penuh",
  "topbar.dashboard": "Papan pemuka",
  "topbar.clockPanel": "Kehadiran & drawer",
  "panel.clockInOut": "Clock In / Clock Out",

  // ── Shell: tajuk iframe terbenam ────────────────────────────────────────────
  "embed.title.staff": "Kakitangan — TAB KAUNTER",
  "embed.title.settings": "Tetapan — TAB KAUNTER",
  "embed.title.fullReport": "Laporan penuh — TAB KAUNTER",
  "embed.title.dashboard": "Papan pemuka — TAB KAUNTER",
  "embed.title.takeOrder": "Ambil pesanan — TAB KAUNTER",
  "embed.title.receipts": "Resit — TAB KAUNTER",
  "embed.title.orderList": "Senarai pesanan — TAB KAUNTER",
  "embed.title.productMenu": "Menu produk — TAB KAUNTER",
  "embed.title.costCalc": "Kalkulator kos — TAB KAUNTER",
  "embed.title.wastage": "Pembaziran — TAB KAUNTER",
  "topbar.wastage": "Pembaziran",
  "topbar.takeOrder": "Ambil pesanan",
  "topbar.productMenu": "Menu produk",

  // ── Shell: lead di bawah topbar ─────────────────────────────────────────────
  "lead.staffMonitor":
    "<strong>Pemantauan</strong> — clock in/out, drawer tunai (audit POS), log aktiviti.",
  "lead.settingsStaff": "<strong>Kakitangan</strong> — sunting rekod staf operasi.",
  "lead.fullReport": "<strong>Paparan</strong> — mengikut <strong>tahun &amp; bulan</strong> kalendar.",
  "lead.dashboard":
    "<strong>Ringkasan pemilik</strong> — KPI, pesanan terkini, kakitangan &amp; drawer.",
  "lead.calcCatalog":
    "<strong>Produk</strong> — urus pakej sahaja. Item tunggal &amp; kos: <em>Inventori → Produk &amp; kos</em>.",
  "lead.calcModifiers":
    "<strong>Produk</strong> — resipi &amp; harga. Pakej urus di <strong>Menu Produk</strong>.",
  "lead.calcIngredients":
    "Isi borang <strong>Tambah bahan</strong>, simpan, kemudian urus stok melalui <strong>Tambah belian</strong>.",
  "lead.wastage":
    "Rekod bahan yang dibuang dari <strong>lot belian</strong> tertentu. Kos ikut harga lot itu; nampak dalam laporan bulanan.",

  // ── Shell: kandungan lalai setiap modul ─────────────────────────────────────
  "module.pos.tag": "Point Of Sale",
  "module.pos.topbar": "Laman utama — jualan",
  "module.pos.lead": "<strong>TAB KAUNTER</strong> — kaunter. Menu kiri untuk operasi harian.",
  "module.pos.panelTitle": "Ringkasan giliran kerja",
  "module.pos.panelBody": "Contoh: jualan hari ini, pesanan aktif, resit. Sambung data kemudian.",
  "module.bo.tag": "Back Office",
  "module.bo.topbar": "Laman utama — pentadbiran",
  "module.bo.lead":
    "<strong>TAB KAUNTER</strong> — pejabat belakang. Menu kiri: laporan, produk &amp; kakitangan, tetapan.",
  "module.bo.panelTitle": "Ringkasan perniagaan",
  "module.bo.panelBody": "Contoh: carta jualan, stok rendah. Inventori: Bahan mentah / Produk & kos.",

  // ── Shell: pemilih modul ────────────────────────────────────────────────────
  "module.title": "Pilih modul",
  "module.desc": "Setiap modul mempunyai menu yang berbeza di bar sisi.",
  "module.posHint": "Jualan, giliran kerja, resit",
  "module.boHint": "Laporan, produk, pentadbiran",

  // ── Clock In panel & status ─────────────────────────────────────────────────
  "clock.closeDrawerFirstTitle": "Tutup drawer tunai dahulu",
  "clock.drawerOpenBlockIn":
    "Drawer tunai masih <strong>dibuka</strong>. Tutup drawer di bawah dahulu, kemudian anda boleh clock in.",
  "clock.onDuty": "Sedang bertugas",
  "clock.started": "Mula",
  "clock.drawerOpenBlockOut":
    "Drawer tunai masih <strong>dibuka</strong> dalam Firestore. Selesaikan <strong>Tutup drawer</strong> di bawah, kemudian tekan Clock out.",
  "clock.confirmOpenDrawer": "Clock in berjaya. Buka drawer sekarang?",
  "clock.alertOkNamed": "Clock in berjaya — {name} ({role}).",
  "clock.status.notClockedIn":
    "Anda <strong>belum clock in</strong>. Clock in dahulu untuk guna Jualan, resit dan senarai pesanan.",
  "clock.status.clockedIn":
    "Anda <strong>sudah clock in</strong>. Jualan dan pesanan sudah dibuka. Buka drawer jika anda perlu rekod tunai, void resit atau tutup syif.",
  "clock.status.clockedInNeedDrawer":
    "Anda <strong>sudah clock in</strong>. Buka drawer dahulu sebelum ambil order di POS.",
  "clock.status.clockedInOwner":
    "Owner <strong>sudah clock in</strong>. POS sudah boleh digunakan. Tandakan Testing / Checking Only pada popup Clock In jika ini bukan syif kerja.",
  "clock.status.shiftOpen":
    "Sistem sedia beroperasi penuh: jualan, resit, dapur, dan kawalan tunai drawer sedang aktif.",
  "clock.status.shiftClosed":
    "Drawer tunai <strong>telah ditutup</strong>. Skrin kaunter dalam mod baca sahaja sehingga anda clock out atau pengurus membuka drawer baharu.",
  "clock.drawer.notClockedIn":
    "Laci tunai: <strong>tutup</strong>. Clock in dahulu untuk membolehkan buka drawer dan rekod tunai.",
  "clock.drawer.shiftClosed":
    "Laci tunai: drawer <strong>ditutup</strong>. Mod baca sahaja sehingga clock out atau buka drawer baharu.",
  "clock.drawer.open": "Laci tunai: dibuka. Rekod tunai drawer sedang aktif.",
  "clock.drawer.notOpen":
    "Laci tunai: <strong>belum dibuka</strong>. Gunakan butang <strong>Buka drawer</strong> di bawah.",
  "clock.roster.title": "Staf bertugas ({count})",
  "clock.roster.empty": "Tiada sesi clock in aktif.",
  "clock.roster.ownerHint": "Owner boleh clock out atau padam sesi aktif di sini. Slot Cashier akan dibuka semula serta-merta.",
  "clock.roster.forceOut": "Clock out (Owner)",
  "clock.roster.forceOutConfirm": "Clock out {name} ({role}) sekarang? Slot tugas akan dikosongkan dan peranti staf itu akan dikunci.",
  "clock.roster.clockOutHere": "Clock out di terminal asal",
  "clock.roster.clockOutFail": "Tidak dapat clock out sekarang.",
  "clock.roster.clockOutFailRetry": "Tidak dapat clock out sekarang. Sila cuba lagi.",
  "clock.fetch.noSession": "Sesi tidak ditemui — sila log masuk semula.",
  "clock.fetch.denied": "Akses dinafikan — semak Firestore rules untuk koleksi staff dan akaun anda.",
  "clock.fetch.network": "Rangkaian terganggu — cuba semula.",
  "clock.fetch.fail": "Gagal memuat senarai.",
  "clock.picker.title": "Pilih nama anda",
  "clock.picker.lead": "Pilih siapa yang sedang clock in. Rekod ini untuk kehadiran dan jualan.",
  "clock.picker.staff": "Kakitangan",
  "clock.picker.loading": "Memuat senarai…",
  "clock.picker.confirm": "Sahkan clock in",
  "clock.picker.staffAria": "Pilih kakitangan",
  "clock.picker.roleLabel": "Tugas untuk sesi ini",
  "clock.picker.roleAria": "Pilih tugas",
  "clock.picker.pickRole": "— Pilih tugas —",
  "clock.picker.roleError": "Sila pilih tugas (Cashier/Kitchen).",
  "clock.picker.empty": "— Tiada rekod kakitangan — tambah di Back Office —",
  "clock.picker.inFail": "Tidak dapat clock in.",
  "clock.picker.cashierTaken": "Cashier (sudah bertugas)",
  "clock.picker.cashierOption": "Cashier",
  "clock.picker.cashierNow": "Cashier sekarang: {name}. Pilih Kitchen atau minta Owner clock out sesi itu.",
  "clock.picker.verifyFail": "Tidak dapat sahkan clock in sekarang. Sila cuba lagi.",
  "clock.picker.cfDown":
    "Clock in gagal: sistem pengesahan tidak dapat dihubungi. Jangan tutup skrin — cuba semula. Jika berulang, beritahu Owner.",
  "clock.picker.verifyTimeout": "Clock in terlalu lama. Sila cuba lagi.",
  "clock.picker.ownerTitle": "Clock In — Owner",
  "clock.picker.ownerLead": "Hanya nama Owner dipaparkan. Tiada pilihan Cashier/Kitchen. Tekan Sahkan untuk terus clock in.",
  "clock.owner.testingLabel": "Testing / Checking Only — sesi ini direkod untuk audit tetapi tidak masuk full report, jam kerja atau gaji staf.",
  "clock.roster.forceReason": "Sebab / nota untuk audit (wajib):",
  "clock.roster.drawerLead": "Cash drawer staf ini masih terbuka.",
  "clock.roster.enterActual": "Masukkan jumlah tunai sebenar dalam laci (RM):",
  "clock.totp.needSixAuth": "Masukkan kod 2FA 6 digit dari app authenticator.",
  "clock.totp.outTitle": "Sahkan Clock Out — {name}",
  "clock.totp.outLead": "Masukkan kod 2FA dari app authenticator untuk sahkan clock out.",
  "clock.totp.codeLabel": "Kod 2FA (6 digit)",
  "clock.totp.codePh": "Kod dari app authenticator",
  "clock.totp.confirmOut": "Sahkan clock out",
  "clock.totp.verifying": "Mengesahkan…",
  "clock.totp.needSix": "Masukkan kod 2FA 6 digit.",
  "clock.totp.mismatch": "Kod 2FA tidak sepadan.",
  "clock.totp.fail": "Tidak dapat sahkan 2FA sekarang. Sila cuba lagi.",
  "clock.geo.blockedTitle": "Login disekat",
  "clock.geo.tooFar":
    "Peranti anda terlalu jauh dari terminal POS. Sila dekatkan diri ke peranti POS dan cuba lagi.",
  "clock.geo.gpsRequired":
    "Akses lokasi diperlukan. Benarkan GPS, dekatkan diri ke peranti POS, kemudian cuba lagi.",
  "clock.geo.locationNotSet":
    "Lokasi kedai belum ditetapkan. Owner mesti tetapkan lokasi POS dahulu. Clock-in jauh tidak dibenarkan.",
  "clock.geo.checking": "Memeriksa jarak ke terminal POS…",
  "clock.geo.nearOk": "Peranti berhampiran POS. Boleh teruskan clock in.",
  "clock.geo.gpsInaccurate":
    "GPS peranti tidak cukup tepat. Clock in staf hanya pada terminal POS kedai. Owner: tetapkan lokasi kedai (Guna lokasi semasa) sekali pada peranti POS ini, kemudian cuba lagi.",
  "clock.card.status": "Status sesi",
  "clock.card.drawer": "Drawer tunai",
  "clock.fact.clock": "Clock In",
  "clock.fact.role": "Tugas",
  "clock.fact.drawer": "Drawer",
  "clock.fact.totp": "2FA",
  "clock.chip.offDuty": "Belum clock in",
  "clock.chip.totpOn": "Wajib",
  "clock.chip.totpOff": "Tidak aktif",
  "clock.chip.totpWait": "…",
  "clock.chip.none": "—",

  // ── RBAC / log keluar ───────────────────────────────────────────────────────
  "rbac.logout.closeDrawer":
    "Tutup drawer tunai (syif kaunter) dahulu sebelum log keluar. Pergi ke menu Clock In / Drawer.",
  "rbac.logout.stillClocked":
    "Anda masih clock in. Sila clock out terlebih dahulu sebelum log keluar. Pergi ke menu Clock In / Clock Out.",
  "rbac.logout.clockOutFirst":
    "Sila clock out terlebih dahulu sebelum log keluar. Pergi ke menu Clock In / Clock Out.",
  "rbac.clock.notIn": "Belum clock in.",
  "rbac.clock.closeDrawerOut": "Tutup drawer tunai dahulu sebelum clock out.",
  "rbac.staffLock":
    "Sila clock in terlebih dahulu sebelum Jualan dan operasi POS.",
  "rbac.drawerLock":
    "Anda sudah clock in. Buka drawer tunai untuk void resit, cash in/out, atau tutup syif.",

  // ── Log masuk (mesej JS) ────────────────────────────────────────────────────
  "login.alert.connectFail": "Tidak dapat sambung ke menu.",
  "login.alert.finishClock":
    "Sila kembali ke menu utama untuk menyelesaikan clock out dan tutup drawer.",
  "login.alert.fillFields": "Sila isi e-mel dan kata laluan.",
  "login.userFallback": "Pengguna",
  "login.lockout": "Akaun disekat buat sementara. Cuba lagi dalam {remaining}.",
  "login.unit.sec": "saat",
  "login.unit.min": "minit",
  "login.unit.hr": "jam"
};

var en = {
  // ── Language button ─────────────────────────────────────────────────────────
  "lang.label": "Language",
  "lang.ms": "BM",
  "lang.en": "EN",
  "lang.switchToEn": "Switch to English",
  "lang.switchToMs": "Switch to Malay",
  "app.refresh": "Refresh",
  "app.refreshHint": "Reload the system if it becomes slow or unresponsive.",

  // ── General ─────────────────────────────────────────────────────────────────
  "common.loading": "Loading…",
  "common.loadingMenu": "Loading menu",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.logout": "Log out",

  // ── Login ───────────────────────────────────────────────────────────────────
  "login.docTitle": "Log in — TAB KAUNTER",
  "login.srHeading": "Welcome — log in to TAB KAUNTER",
  "login.title": "Welcome",
  "login.lead": "Good to see you again. Log in to continue to the main menu.",
  "login.email": "Email",
  "login.emailPlaceholder": "name@restaurant.com",
  "login.password": "Password",
  "login.showPassword": "Show password",
  "login.submit": "Continue to menu",
  "login.noAccount": "Don't have an account?",
  "login.requestAccess": "Request access",
  "login.kicker": "Digital POS System",
  "login.secure": "Secure sign-in for the counter",

  // ── Shell: sidebar ──────────────────────────────────────────────────────────
  "shell.sidebarLabel": "TAB KAUNTER menu",
  "nav.sidebarCollapse": "Hide sidebar",
  "nav.sidebarExpand": "Show sidebar",

  "nav.posLabel": "Sales menu",
  "nav.section.operations": "Operations",
  "nav.clockIn": "Clock In",
  "nav.sales": "Sales",
  "nav.receipts": "Receipts",
  "nav.orderList": "Order list",

  "nav.boLabel": "Back office menu",
  "nav.section.overview": "Overview",
  "nav.dashboard": "Dashboard",
  "nav.section.reports": "Reports",
  "nav.fullReport": "Full report",
  "nav.section.productsStaff": "Products & staff",
  "nav.products": "Products",
  "nav.staff": "Staff",
  "nav.section.inventory": "Inventory",
  "nav.ingredients": "Ingredients",
  "nav.productsCost": "Products & cost",
  "nav.wastage": "Wastage",
  "nav.section.system": "System",
  "nav.settings": "Settings",

  // ── Shell: sidebar leads ────────────────────────────────────────────────────
  "lead.clockIn": "Clock in first, then open the drawer, then sell. Owner and staff follow the same flow.",
  "lead.sales":
    "Flow: cart → review → payment → receipt &amp; kitchen list. Connected to <strong>Receipts</strong> and <strong>Order list</strong>.",
  "lead.receipts":
    "Receipt list — synced with sales. Cash drawer &amp; audit: <strong>Clock In</strong> menu.",
  "lead.orderList": "Kitchen display (KDS) — order status after payment.",

  // ── Shell: topbar title per view ────────────────────────────────────────────
  "topbar.staff": "Staff",
  "topbar.fullReport": "Full report",
  "topbar.dashboard": "Dashboard",
  "topbar.clockPanel": "Attendance & drawer",
  "panel.clockInOut": "Clock In / Clock Out",

  // ── Shell: embedded iframe titles ───────────────────────────────────────────
  "embed.title.staff": "Staff — TAB KAUNTER",
  "embed.title.settings": "Settings — TAB KAUNTER",
  "embed.title.fullReport": "Full report — TAB KAUNTER",
  "embed.title.dashboard": "Dashboard — TAB KAUNTER",
  "embed.title.takeOrder": "Take order — TAB KAUNTER",
  "embed.title.receipts": "Receipts — TAB KAUNTER",
  "embed.title.orderList": "Order list — TAB KAUNTER",
  "embed.title.productMenu": "Product menu — TAB KAUNTER",
  "embed.title.costCalc": "Cost calculator — TAB KAUNTER",
  "embed.title.wastage": "Wastage — TAB KAUNTER",
  "topbar.wastage": "Wastage",
  "topbar.takeOrder": "Take order",
  "topbar.productMenu": "Product menu",

  // ── Shell: lead under the topbar ────────────────────────────────────────────
  "lead.staffMonitor":
    "<strong>Monitoring</strong> — clock in/out, cash drawer (POS audit), activity log.",
  "lead.settingsStaff": "<strong>Staff</strong> — edit operational staff records.",
  "lead.fullReport": "<strong>View</strong> — by calendar <strong>year &amp; month</strong>.",
  "lead.dashboard": "<strong>Owner summary</strong> — KPIs, recent orders, staff &amp; drawer.",
  "lead.calcCatalog":
    "<strong>Products</strong> — manage packages only. Single items &amp; cost: <em>Inventory → Products &amp; cost</em>.",
  "lead.calcModifiers":
    "<strong>Products</strong> — recipes &amp; pricing. Packages are managed in <strong>Product Menu</strong>.",
  "lead.calcIngredients":
    "Fill in the <strong>Add ingredient</strong> form, save, then manage stock via <strong>Add purchase</strong>.",
  "lead.wastage":
    "Record thrown-away stock from a specific <strong>purchase lot</strong>. Cost follows that lot's price and appears on the monthly report.",

  // ── Shell: default content per module ───────────────────────────────────────
  "module.pos.tag": "Point Of Sale",
  "module.pos.topbar": "Home — sales",
  "module.pos.lead": "<strong>TAB KAUNTER</strong> — counter. Left menu for daily operations.",
  "module.pos.panelTitle": "Shift summary",
  "module.pos.panelBody": "Example: today's sales, active orders, receipts. Connect live data later.",
  "module.bo.tag": "Back Office",
  "module.bo.topbar": "Home — administration",
  "module.bo.lead":
    "<strong>TAB KAUNTER</strong> — back office. Left menu: reports, products &amp; staff, settings.",
  "module.bo.panelTitle": "Business summary",
  "module.bo.panelBody": "Example: sales chart, low stock. Inventory: Ingredients / Products & cost.",

  // ── Shell: module picker ────────────────────────────────────────────────────
  "module.title": "Choose module",
  "module.desc": "Each module has a different sidebar menu.",
  "module.posHint": "Sales, shifts, receipts",
  "module.boHint": "Reports, products, administration",

  // ── Clock In panel & status ─────────────────────────────────────────────────
  "clock.closeDrawerFirstTitle": "Close the cash drawer first",
  "clock.drawerOpenBlockIn":
    "The cash drawer is still <strong>open</strong>. Close the drawer below first, then you can clock in.",
  "clock.onDuty": "On duty",
  "clock.started": "Started",
  "clock.drawerOpenBlockOut":
    "The cash drawer is still <strong>open</strong> in Firestore. Finish <strong>Close drawer</strong> below, then tap Clock out.",
  "clock.confirmOpenDrawer": "Clock in successful. Open the drawer now?",
  "clock.alertOkNamed": "Clock in successful — {name} ({role}).",
  "clock.status.notClockedIn":
    "You have <strong>not clocked in</strong>. Clock in first to use Sales, receipts and the order list.",
  "clock.status.clockedIn":
    "You are <strong>clocked in</strong>. Sales and orders are unlocked. Open the drawer if you need cash records, void receipts or to close the shift.",
  "clock.status.clockedInNeedDrawer":
    "You are <strong>clocked in</strong>. Open the drawer before taking POS orders.",
  "clock.status.clockedInOwner":
    "Owner is <strong>clocked in</strong>. POS is available. Tick Testing / Checking Only on the Clock In popup if this is not a working shift.",
  "clock.status.shiftOpen":
    "The system is fully ready: sales, receipts, kitchen, and cash-drawer controls are active.",
  "clock.status.shiftClosed":
    "The cash drawer has <strong>been closed</strong>. The counter is read-only until you clock out or a manager opens a new drawer.",
  "clock.drawer.notClockedIn":
    "Cash drawer: <strong>closed</strong>. Clock in first to open the drawer and record cash.",
  "clock.drawer.shiftClosed":
    "Cash drawer: <strong>closed</strong>. Read-only until clock out or a new drawer is opened.",
  "clock.drawer.open": "Cash drawer: open. Drawer cash recording is active.",
  "clock.drawer.notOpen":
    "Cash drawer: <strong>not opened yet</strong>. Use the <strong>Open drawer</strong> button below.",
  "clock.roster.title": "Staff on duty ({count})",
  "clock.roster.empty": "No active clock-in sessions.",
  "clock.roster.ownerHint": "The owner can clock out or clear an active session here. The cashier slot frees immediately.",
  "clock.roster.forceOut": "Clock out (Owner)",
  "clock.roster.forceOutConfirm": "Clock out {name} ({role}) now? Their duty slot will be freed and their device will lock.",
  "clock.roster.clockOutHere": "Clock out on the original terminal",
  "clock.roster.clockOutFail": "Unable to clock out right now.",
  "clock.roster.clockOutFailRetry": "Unable to clock out right now. Please try again.",
  "clock.fetch.noSession": "Session not found — please log in again.",
  "clock.fetch.denied": "Access denied — check Firestore rules for the staff collection and your account.",
  "clock.fetch.network": "Network interrupted — please try again.",
  "clock.fetch.fail": "Failed to load the list.",
  "clock.picker.title": "Choose your name",
  "clock.picker.lead": "Choose who is clocking in. This record is for attendance and sales.",
  "clock.picker.staff": "Staff",
  "clock.picker.loading": "Loading list…",
  "clock.picker.confirm": "Confirm clock in",
  "clock.picker.staffAria": "Choose staff",
  "clock.picker.roleLabel": "Role for this session",
  "clock.picker.roleAria": "Choose role",
  "clock.picker.pickRole": "— Choose role —",
  "clock.picker.roleError": "Please choose a role (Cashier/Kitchen).",
  "clock.picker.empty": "— No staff records — add them in Back Office —",
  "clock.picker.inFail": "Unable to clock in.",
  "clock.picker.cashierTaken": "Cashier (already on duty)",
  "clock.picker.cashierOption": "Cashier",
  "clock.picker.cashierNow": "Cashier now: {name}. Choose Kitchen or ask the owner to clock that session out.",
  "clock.picker.verifyFail": "Unable to confirm clock in right now. Please try again.",
  "clock.picker.cfDown":
    "Clock-in failed: the verification service could not be reached. Keep this screen open and try again. If it keeps failing, tell the owner.",
  "clock.picker.verifyTimeout": "Clock in took too long. Please try again.",
  "clock.picker.ownerTitle": "Clock In — Owner",
  "clock.picker.ownerLead": "Only the Owner name is shown. No Cashier/Kitchen role. Tap confirm to clock in.",
  "clock.owner.testingLabel": "Testing / Checking Only — recorded for audit/history but excluded from the full report, working hours and staff salary.",
  "clock.roster.forceReason": "Reason / note for the audit log (required):",
  "clock.roster.drawerLead": "This staff cash drawer is still open.",
  "clock.roster.enterActual": "Enter the actual cash in the drawer (RM):",
  "clock.totp.needSixAuth": "Enter the 6-digit 2FA code from the authenticator app.",
  "clock.totp.outTitle": "Confirm Clock Out — {name}",
  "clock.totp.outLead": "Enter the 2FA code from the authenticator app to confirm clock out.",
  "clock.totp.codeLabel": "2FA code (6 digits)",
  "clock.totp.codePh": "Code from authenticator app",
  "clock.totp.confirmOut": "Confirm clock out",
  "clock.totp.verifying": "Confirming…",
  "clock.totp.needSix": "Enter the 6-digit 2FA code.",
  "clock.totp.mismatch": "The 2FA code does not match.",
  "clock.totp.fail": "Unable to verify 2FA right now. Please try again.",
  "clock.geo.blockedTitle": "Login Blocked",
  "clock.geo.tooFar":
    "Your device is too far from the POS terminal. Please move closer to the POS device and try again.",
  "clock.geo.gpsRequired":
    "Location access is required. Allow GPS, move closer to the POS device, and try again.",
  "clock.geo.locationNotSet":
    "Store location is not set. The owner must set the POS location first. Remote clock-in is not allowed.",
  "clock.geo.checking": "Checking distance to the POS terminal…",
  "clock.geo.nearOk": "Device is near the POS. You can continue clock-in.",
  "clock.geo.gpsInaccurate":
    "Device GPS is not accurate enough. Staff clock-in only on the shop POS. Owner: set store location (Use current location) once on this POS device, then try again.",
  "clock.card.status": "Session status",
  "clock.card.drawer": "Cash drawer",
  "clock.fact.clock": "Clock In",
  "clock.fact.role": "Role",
  "clock.fact.drawer": "Drawer",
  "clock.fact.totp": "2FA",
  "clock.chip.offDuty": "Not clocked in",
  "clock.chip.totpOn": "Required",
  "clock.chip.totpOff": "Off",
  "clock.chip.totpWait": "…",
  "clock.chip.none": "—",

  // ── RBAC / log out ──────────────────────────────────────────────────────────
  "rbac.logout.closeDrawer":
    "Close the cash drawer (counter shift) first before logging out. Go to the Clock In / Drawer menu.",
  "rbac.logout.stillClocked":
    "You are still clocked in. Please clock out first before logging out. Go to the Clock In / Clock Out menu.",
  "rbac.logout.clockOutFirst":
    "Please clock out first before logging out. Go to the Clock In / Clock Out menu.",
  "rbac.clock.notIn": "Not clocked in yet.",
  "rbac.clock.closeDrawerOut": "Please close the drawer before clocking out.",
  "rbac.staffLock":
    "Please clock in first before Sales and POS operations.",
  "rbac.drawerLock":
    "You are clocked in. Open the cash drawer for void receipts, cash in/out, or to close the shift.",

  // ── Login (JS messages) ─────────────────────────────────────────────────────
  "login.alert.connectFail": "Unable to connect to the menu.",
  "login.alert.finishClock":
    "Please return to the main menu to finish clock out and close the drawer.",
  "login.alert.fillFields": "Please fill in email and password.",
  "login.userFallback": "User",
  "login.lockout": "Account temporarily locked. Try again in {remaining}.",
  "login.unit.sec": "seconds",
  "login.unit.min": "minutes",
  "login.unit.hr": "hours"
};

export var SHELL = { ms: ms, en: en };
