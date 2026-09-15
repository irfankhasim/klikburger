/**
 * Kamus: Tetapan: rekod kakitangan, TOTP, geofence, pangkalan data.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 */

var ms = {
  // ?? Rangka tetapan ??????????????????????????????????????????????????????????
  "settings.docTitle": "Tetapan - TAB KAUNTER",
  "settings.title": "Tetapan",
  "settings.lead": "Urus rekod kakitangan operasi.",
  "settings.iframe.staff": "Kakitangan - Tetapan",

  // ?? Halaman kakitangan ??????????????????????????????????????????????????????
  "settings.staff.docTitle": "Kakitangan - Tetapan",
  "settings.staff.title": "Kakitangan",
  "settings.staff.addBtn": "Tambah kakitangan",
  "settings.staff.lead":
    "Sunting butiran staf operasi. Pemantauan clock in/out &amp; drawer ada di menu <strong>Kakitangan</strong> sidebar.",

  // ?? Lokasi kedai ????????????????????????????????????????????????????????????
  "settings.store.title": "Lokasi kedai",
  "settings.store.hint": "Sekatan clock-in - staf hanya boleh clock in dalam radius kedai.",
  "settings.store.radius": "Radius (meter)",
  "settings.store.useCurrent": "Guna lokasi semasa",
  "settings.store.clear": "Buang sekatan",
  "settings.store.footnote": "Buka halaman ini di kedai (peranti dengan GPS) sebelum tetapkan lokasi.",
  "settings.store.statusUnset": "Lokasi belum ditetapkan.",
  "settings.store.statusSet": "Ditetapkan: {radius} m - {lat}, {lng}",
  "settings.store.statusError": "Gagal muat lokasi kedai.",
  "settings.store.noGps": "Peranti ini tidak menyokong GPS.",
  "settings.store.noPermission": "Kebenaran lokasi ditolak.",
  "settings.store.msgSet": "Lokasi kedai ditetapkan.",
  "settings.store.msgSetFailed": "Gagal tetapkan lokasi: {error}",
  "settings.store.msgCleared": "Sekatan lokasi dibuang.",
  "settings.store.msgClearFailed": "Gagal buang sekatan lokasi: {error}",

  // ?? Senarai & borang ????????????????????????????????????????????????????????
  "settings.list.title": "Senarai kakitangan",
  "settings.list.hint": "Pilih nama untuk sunting butiran.",
  "settings.list.empty": "Tiada rekod staf. Klik <strong>Tambah kakitangan</strong> untuk mula.",
  "settings.form.title": "Butiran staf",
  "settings.form.ownerNote":
    "<strong>Profil pemilik</strong> - kemaskini nama paparan sahaja.",
  "settings.form.sectionBasic": "Maklumat asas",
  "settings.form.name": "Nama penuh",
  "settings.form.email": "E-mel",
  "settings.form.emailPlaceholder": "nama@contoh.com",
  "settings.form.role": "Jawatan",
  "settings.form.status": "Status",
  "settings.form.sectionWork": "Butiran kerja",
  "settings.form.phone": "Telefon",
  "settings.form.startedAt": "Tarikh mula bekerja",
  "settings.form.payType": "Jenis gaji",
  "settings.form.payAmount": "Kadar / gaji asas (RM)",
  "settings.form.sectionSecurity": "Keselamatan clock-in",
  "settings.form.delete": "Padam",
  "settings.form.save": "Simpan",

  // ?? Jawatan & gaji ??????????????????????????????????????????????????????????
  "settings.role.owner": "Pemilik",
  "settings.role.cashier": "Kaunter",
  "settings.role.kitchen": "Dapur",
  "settings.role.runner": "Runner",
  "settings.role.supervisor": "Penyelia",
  "settings.payType.hourly": "Sejam",
  "settings.payType.salary": "Bulanan",

  // ?? 2FA ?????????????????????????????????????????????????????????????????????
  "settings.totp.loadError": "Gagal muat status 2FA.",
  "settings.totp.statusOff": "Off",
  "settings.totp.statusOn": "On",
  "settings.totp.headTitle": "2FA Clock In (Authenticator App)",
  "settings.totp.setupBtn": "Setup 2FA",
  "settings.totp.resetBtn": "Reset 2FA",
  "settings.totp.deleteBtn": "Delete 2FA",
  "settings.totp.footnote": "Bila 2FA disediakan, staf wajib masukkan kod dari app authenticator semasa clock in.",
  "settings.totp.closeModal": "Tutup",
  "settings.totp.manualCode": "Kod manual",
  "settings.totp.confirmLabel": "Kod 6 digit untuk sahkan",
  "settings.totp.confirmBtn": "Sahkan & Aktifkan",
  "settings.totp.modalTitle": "Setup 2FA - {name}",
  "settings.totp.modalLead":
    "Imbas kod QR ini dengan app authenticator pada telefon {name}, atau masukkan kod secara manual.",
  "settings.totp.staffFallback": "Staf",
  "settings.totp.generatingQr": "Menjana kod QR...",
  "settings.totp.needStaff": "Pilih nama staf dari senarai di sebelah dahulu sebelum setup 2FA.",
  "settings.totp.generateFailed": "Gagal jana 2FA: {error}",
  "settings.totp.generateFailedShort": "Tidak dapat jana kod QR. Tutup dan cuba lagi.",
  "settings.totp.needSix": "Masukkan kod 6 digit.",
  "settings.totp.confirmed": "2FA disahkan & diaktifkan.",
  "settings.totp.codeMismatch": "Kod tidak sepadan.",
  "settings.totp.deleteTitle": "Padam 2FA?",
  "settings.totp.deleteLead":
    "Padam setup 2FA untuk {name}? Authenticator sedia ada tidak lagi sah. Guna Setup 2FA untuk daftar semula.",
  "settings.totp.deleteCancel": "Batal",
  "settings.totp.deleteConfirm": "Ya, padam",
  "settings.totp.deletedOk": "2FA dipadam. Boleh setup semula bila perlu.",
  "settings.totp.deleteFailed": "Gagal padam 2FA: {error}",

  // ?? Mesej ???????????????????????????????????????????????????????????????????
  "settings.common.error": "ralat",
  "settings.common.loadingShort": "Memuat...",
  "settings.msg.ownerOnly": "Hanya pemilik (owner) boleh kemaskini rekod pemilik.",
  "settings.msg.nameRequired": "Isi nama.",
  "settings.msg.nameDuplicate": "Nama ini sudah digunakan oleh rekod lain.",
  "settings.msg.limitReached": "Had 40 rekod staf dicapai. Padam rekod tidak digunakan dahulu.",
  "settings.msg.emailInvalid": "E-mel tidak sah.",
  "settings.msg.staffUpdated": "Butiran staf dikemas kini.",
  "settings.msg.staffAdded": "Kakitangan ditambah.",
  "settings.msg.ownerUndeletable": "Rekod pemilik tidak boleh dipadam.",
  "settings.msg.confirmDelete": "Padam kakitangan ini dari pangkalan data?",
  "settings.msg.deleted": "Dipadam."
};

var en = {
  // ?? Settings shell ??????????????????????????????????????????????????????????
  "settings.docTitle": "Settings - TAB KAUNTER",
  "settings.title": "Settings",
  "settings.lead": "Manage operational staff records.",
  "settings.iframe.staff": "Staff - Settings",

  // ?? Staff page ??????????????????????????????????????????????????????????????
  "settings.staff.docTitle": "Staff - Settings",
  "settings.staff.title": "Staff",
  "settings.staff.addBtn": "Add staff",
  "settings.staff.lead":
    "Edit operational staff details. Clock in/out and drawer monitoring is in the <strong>Staff</strong> sidebar menu.",

  // ?? Store location ??????????????????????????????????????????????????????????
  "settings.store.title": "Store location",
  "settings.store.hint": "Clock-in restriction - staff can only clock in within the store radius.",
  "settings.store.radius": "Radius (metres)",
  "settings.store.useCurrent": "Use current location",
  "settings.store.clear": "Remove restriction",
  "settings.store.footnote": "Open this page at the store (on a device with GPS) before setting the location.",
  "settings.store.statusUnset": "Location not set yet.",
  "settings.store.statusSet": "Set: {radius} m - {lat}, {lng}",
  "settings.store.statusError": "Could not load store location.",
  "settings.store.noGps": "This device does not support GPS.",
  "settings.store.noPermission": "Location permission was denied.",
  "settings.store.msgSet": "Store location saved.",
  "settings.store.msgSetFailed": "Could not set location: {error}",
  "settings.store.msgCleared": "Location restriction removed.",
  "settings.store.msgClearFailed": "Could not remove location restriction: {error}",

  // ?? List & form ?????????????????????????????????????????????????????????????
  "settings.list.title": "Staff list",
  "settings.list.hint": "Select a name to edit details.",
  "settings.list.empty": "No staff records yet. Click <strong>Add staff</strong> to start.",
  "settings.form.title": "Staff details",
  "settings.form.ownerNote":
    "<strong>Owner profile</strong> - update the display name only.",
  "settings.form.sectionBasic": "Basic info",
  "settings.form.name": "Full name",
  "settings.form.email": "Email",
  "settings.form.emailPlaceholder": "name@example.com",
  "settings.form.role": "Role",
  "settings.form.status": "Status",
  "settings.form.sectionWork": "Work details",
  "settings.form.phone": "Phone",
  "settings.form.startedAt": "Start date",
  "settings.form.payType": "Pay type",
  "settings.form.payAmount": "Rate / basic pay (RM)",
  "settings.form.sectionSecurity": "Clock-in security",
  "settings.form.delete": "Delete",
  "settings.form.save": "Save",

  // ?? Roles & pay ?????????????????????????????????????????????????????????????
  "settings.role.owner": "Owner",
  "settings.role.cashier": "Cashier",
  "settings.role.kitchen": "Kitchen",
  "settings.role.runner": "Runner",
  "settings.role.supervisor": "Supervisor",
  "settings.payType.hourly": "Hourly",
  "settings.payType.salary": "Monthly",

  // ?? 2FA ?????????????????????????????????????????????????????????????????????
  "settings.totp.loadError": "Could not load 2FA status.",
  "settings.totp.statusOff": "Off",
  "settings.totp.statusOn": "On",
  "settings.totp.headTitle": "2FA Clock In (Authenticator App)",
  "settings.totp.setupBtn": "Setup 2FA",
  "settings.totp.resetBtn": "Reset 2FA",
  "settings.totp.deleteBtn": "Delete 2FA",
  "settings.totp.footnote": "When 2FA is set up, staff must enter a code from the authenticator app to clock in.",
  "settings.totp.closeModal": "Close",
  "settings.totp.manualCode": "Manual code",
  "settings.totp.confirmLabel": "6-digit code to confirm",
  "settings.totp.confirmBtn": "Confirm & Activate",
  "settings.totp.modalTitle": "Setup 2FA - {name}",
  "settings.totp.modalLead":
    "Scan this QR code with the authenticator app on {name}'s phone, or enter the code manually.",
  "settings.totp.staffFallback": "Staff",
  "settings.totp.generatingQr": "Generating QR code...",
  "settings.totp.needStaff": "Select a staff name from the list first, then set up 2FA.",
  "settings.totp.generateFailed": "Could not generate 2FA: {error}",
  "settings.totp.generateFailedShort": "Could not generate the QR code. Close and try again.",
  "settings.totp.needSix": "Enter the 6-digit code.",
  "settings.totp.confirmed": "2FA confirmed and turned on.",
  "settings.totp.codeMismatch": "Code does not match.",
  "settings.totp.deleteTitle": "Delete 2FA?",
  "settings.totp.deleteLead":
    "Delete the 2FA setup for {name}? The current authenticator will stop working. Use Setup 2FA to enroll again.",
  "settings.totp.deleteCancel": "Cancel",
  "settings.totp.deleteConfirm": "Yes, delete",
  "settings.totp.deletedOk": "2FA deleted. You can set it up again when needed.",
  "settings.totp.deleteFailed": "Could not delete 2FA: {error}",

  // ?? Messages ????????????????????????????????????????????????????????????????
  "settings.common.error": "error",
  "settings.common.loadingShort": "Loading...",
  "settings.msg.ownerOnly": "Only the owner can update the owner record.",
  "settings.msg.nameRequired": "Enter a name.",
  "settings.msg.nameDuplicate": "This name is already used by another record.",
  "settings.msg.limitReached": "The 40-staff limit has been reached. Delete unused records first.",
  "settings.msg.emailInvalid": "Email is not valid.",
  "settings.msg.staffUpdated": "Staff details updated.",
  "settings.msg.staffAdded": "Staff added.",
  "settings.msg.ownerUndeletable": "The owner record cannot be deleted.",
  "settings.msg.confirmDelete": "Delete this staff member from the database?",
  "settings.msg.deleted": "Deleted."
};

export var SETTINGS = { ms: ms, en: en };
