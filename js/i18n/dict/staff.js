/**
 * Kamus: Papan pemuka kakitangan: kehadiran, drawer, prestasi.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 */

var ms = {
  // ?? Rangka halaman ??????????????????????????????????????????????????????????
  "staff.docTitle": "Kakitangan - Klik Burger",
  "staff.title": "Kakitangan",
  "staff.lead":
    "<strong>Pemantauan</strong> - kehadiran (clock in/out dari POS), <strong>penutupan drawer tunai</strong> (amaun awal, amaun akhir &amp; beza), dan ringkasan staf. Urus butiran penuh di <strong>Tetapan - Kakitangan</strong>.",
  "staff.filterSectionLabel": "Penapis bulan",
  "staff.filterMonth": "Bulan paparan",
  "staff.filterMonthTitle": "Pilih bulan untuk jadual di bawah",
  "staff.summaryLabel": "Ringkasan pemantauan",

  // ?? Kad ringkasan ???????????????????????????????????????????????????????????
  "staff.summary.activeStaff": "Staf aktif",
  "staff.summary.ofRecords": "Daripada {n} rekod",
  "staff.summary.clockRecords": "Rekod clock (bulan)",
  "staff.summary.clockRecordsHint": "Clock in / clock out",
  "staff.summary.shiftsClosed": "Tutup shift (bulan)",
  "staff.summary.shiftsClosedHint": "Penutupan drawer",
  "staff.summary.month": "Bulan paparan",
  "staff.summary.monthHint": "Tukar penapis di atas",

  // ?? Panel ???????????????????????????????????????????????????????????????????
  "staff.activeRosterTitle": "Sesi clock in aktif",
  "staff.activeRosterHint": "Owner boleh clock out atau padam sesi tersekat di sini. Hanya satu Cashier dibenarkan pada satu masa.",
  "staff.activeRosterEmpty": "Tiada sesi clock in aktif.",
  "staff.activeRosterForceOut": "Clock out",
  "staff.activeRosterForceConfirm": "Clock out {name} ({role}) sekarang? Slot Cashier/Kitchen akan dikosongkan serta-merta.",
  "staff.activeRosterFail": "Tidak dapat clock out sesi ini.",
  "staff.clockPanelTitle": "Kehadiran - Clock In / Clock Out",
  "staff.perfSalesTitle": "Prestasi Staf - Jualan (Cashier)",
  "staff.perfSalesHint": "Produktiviti dikira: jualan / jam bertugas sebagai Cashier.",
  "staff.drawerPanelTitle": "Drawer tunai - penutupan shift",

  // ?? Tajuk jadual ????????????????????????????????????????????????????????????
  "staff.th.date": "Tarikh",
  "staff.th.staff": "Staf",
  "staff.th.task": "Tugas",
  "staff.th.clockIn": "Clock In",
  "staff.th.clockOut": "Clock Out",
  "staff.th.duration": "Tempoh",
  "staff.th.manage": "Urus",
  "staff.manage": "Urus sesi",
  "staff.manageManualIn": "Clock in manual",
  "staff.manageReason": "Sebab / nota audit:",
  "staff.manageInTime": "Masa clock in (YYYY-MM-DD HH:MM):",
  "staff.manageOutTime": "Masa clock out (kosongkan jika masih aktif):",
  "staff.manageOk": "Sesi dikemaskini.",
  "staff.manageFail": "Tidak dapat kemaskini sesi.",
  "staff.badge.testing": "Owner Testing Session",
  "staff.badge.ownerRole": "Owner",
  "staff.th.cashierHours": "Jam Cashier",
  "staff.th.orderCount": "Bil. pesanan",
  "staff.th.totalSales": "Jumlah jualan",
  "staff.th.salesPerHour": "Jualan / jam",
  "staff.th.when": "Masa / tarikh",
  "staff.th.opening": "Amaun awal",
  "staff.th.closing": "Amaun akhir",
  "staff.th.variance": "Varians",
  "staff.th.note": "Nota",

  // ?? Kosong ??????????????????????????????????????????????????????????????????
  "staff.empty.clock": "Tiada rekod kehadiran pada bulan ini.",
  "staff.empty.drawer": "Tiada penutupan drawer untuk bulan ini.",
  "staff.empty.sales": "Tiada data jualan untuk bulan ini.",

  // ?? Lencana ?????????????????????????????????????????????????????????????????
  "staff.badge.owner": "Owner",
  "staff.badge.kitchen": "Dapur",
  "staff.badge.cashier": "Cashier",
  "staff.badge.onDuty": "Sedang bertugas",

  // ?? Unit & masa ?????????????????????????????????????????????????????????????
  "staff.unit.hourShort": "j",
  "staff.unit.minShort": "m",
  "staff.meridiem.am": "PG",
  "staff.meridiem.pm": "PTG",
  "staff.meridiem.noon": "TGH",

  // ?? Hari & bulan ????????????????????????????????????????????????????????????
  "staff.day.0": "Ahad",
  "staff.day.1": "Isnin",
  "staff.day.2": "Selasa",
  "staff.day.3": "Rabu",
  "staff.day.4": "Khamis",
  "staff.day.5": "Jumaat",
  "staff.day.6": "Sabtu",
  "staff.month.0": "Jan",
  "staff.month.1": "Feb",
  "staff.month.2": "Mac",
  "staff.month.3": "Apr",
  "staff.month.4": "Mei",
  "staff.month.5": "Jun",
  "staff.month.6": "Jul",
  "staff.month.7": "Ogs",
  "staff.month.8": "Sep",
  "staff.month.9": "Okt",
  "staff.month.10": "Nov",
  "staff.month.11": "Dis",

  // ?? Status & shift ??????????????????????????????????????????????????????????
  "staff.status.active": "Aktif",
  "staff.status.leave": "Cuti",
  "staff.status.terminated": "Berhenti",
  "staff.shift.pagi": "Pagi",
  "staff.shift.petang": "Petang",
  "staff.shift.penuh": "Sepenuh masa",
  "staff.shift.cuti": "Cuti"
};

var en = {
  // ?? Page shell ??????????????????????????????????????????????????????????????
  "staff.docTitle": "Staff - Klik Burger",
  "staff.title": "Staff",
  "staff.lead":
    "<strong>Monitoring</strong> - attendance (clock in/out from POS), <strong>cash drawer closings</strong> (opening amount, closing amount &amp; difference), and a staff summary. Edit full details in <strong>Settings - Staff</strong>.",
  "staff.filterSectionLabel": "Month filter",
  "staff.filterMonth": "Month",
  "staff.filterMonthTitle": "Choose the month for the tables below",
  "staff.summaryLabel": "Monitoring summary",

  // ?? Summary cards ???????????????????????????????????????????????????????????
  "staff.summary.activeStaff": "Active staff",
  "staff.summary.ofRecords": "of {n} records",
  "staff.summary.clockRecords": "Clock records",
  "staff.summary.clockRecordsHint": "Clock in / clock out",
  "staff.summary.shiftsClosed": "Shifts closed",
  "staff.summary.shiftsClosedHint": "Cash drawer closings",
  "staff.summary.month": "Month",
  "staff.summary.monthHint": "Change the filter above",

  // ?? Panels ??????????????????????????????????????????????????????????????????
  "staff.activeRosterTitle": "Active clock-in sessions",
  "staff.activeRosterHint": "The owner can clock out or clear a stuck session here. Only one cashier is allowed at a time.",
  "staff.activeRosterEmpty": "No active clock-in sessions.",
  "staff.activeRosterForceOut": "Clock out",
  "staff.activeRosterForceConfirm": "Clock out {name} ({role}) now? The cashier/kitchen slot will be freed immediately.",
  "staff.activeRosterFail": "Unable to clock out this session.",
  "staff.clockPanelTitle": "Attendance - Clock In / Clock Out",
  "staff.perfSalesTitle": "Staff performance - Sales (Cashier)",
  "staff.perfSalesHint": "Productivity is sales / hours worked as Cashier.",
  "staff.drawerPanelTitle": "Cash drawer - shift closing",

  // ── Table headers ───────────────────────────────────────────────────────────
  "staff.th.date": "Date",
  "staff.th.staff": "Staff",
  "staff.th.task": "Role",
  "staff.th.clockIn": "Clock In",
  "staff.th.clockOut": "Clock Out",
  "staff.th.duration": "Duration",
  "staff.th.manage": "Manage",
  "staff.manage": "Manage session",
  "staff.manageManualIn": "Manual clock in",
  "staff.manageReason": "Audit reason / note:",
  "staff.manageInTime": "Clock-in time (YYYY-MM-DD HH:MM):",
  "staff.manageOutTime": "Clock-out time (leave blank if still active):",
  "staff.manageOk": "Session updated.",
  "staff.manageFail": "Unable to update the session.",
  "staff.badge.testing": "Owner Testing Session",
  "staff.badge.ownerRole": "Owner",
  "staff.th.cashierHours": "Cashier hours",
  "staff.th.orderCount": "Orders",
  "staff.th.totalSales": "Total sales",
  "staff.th.salesPerHour": "Sales / hour",
  "staff.th.when": "Date / time",
  "staff.th.opening": "Opening",
  "staff.th.closing": "Closing",
  "staff.th.variance": "Variance",
  "staff.th.note": "Note",

  // ── Empty ───────────────────────────────────────────────────────────────────
  "staff.empty.clock": "No attendance records this month.",
  "staff.empty.drawer": "No cash drawer closings this month.",
  "staff.empty.sales": "No sales data this month.",

  // ── Badges ──────────────────────────────────────────────────────────────────
  "staff.badge.owner": "Owner",
  "staff.badge.kitchen": "Kitchen",
  "staff.badge.cashier": "Cashier",
  "staff.badge.onDuty": "On duty",

  // ── Units & time ────────────────────────────────────────────────────────────
  "staff.unit.hourShort": "h",
  "staff.unit.minShort": "m",
  "staff.meridiem.am": "AM",
  "staff.meridiem.pm": "PM",
  "staff.meridiem.noon": "NOON",

  // ── Days & months ───────────────────────────────────────────────────────────
  "staff.day.0": "Sun",
  "staff.day.1": "Mon",
  "staff.day.2": "Tue",
  "staff.day.3": "Wed",
  "staff.day.4": "Thu",
  "staff.day.5": "Fri",
  "staff.day.6": "Sat",
  "staff.month.0": "Jan",
  "staff.month.1": "Feb",
  "staff.month.2": "Mar",
  "staff.month.3": "Apr",
  "staff.month.4": "May",
  "staff.month.5": "Jun",
  "staff.month.6": "Jul",
  "staff.month.7": "Aug",
  "staff.month.8": "Sep",
  "staff.month.9": "Oct",
  "staff.month.10": "Nov",
  "staff.month.11": "Dec",

  // ── Status & shift ──────────────────────────────────────────────────────────
  "staff.status.active": "Active",
  "staff.status.leave": "On leave",
  "staff.status.terminated": "Left",
  "staff.shift.pagi": "Morning",
  "staff.shift.petang": "Evening",
  "staff.shift.penuh": "Full day",
  "staff.shift.cuti": "Off"
};

export var STAFF = { ms: ms, en: en };
