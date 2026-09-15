/**
 * Kamus: Pembantu AI: widget sembang, pangkalan pengetahuan.
 *
 * Lihat js/i18n/dictionary.js untuk peraturan menulis entri - ringkasnya:
 * ms mesti SAMA TEPAT dengan teks sedia ada, dan istilah lazim Bahasa Inggeris
 * (POS, Clock In/Out, drawer, shift, KDS, COGS, QR, void, refund) dikekalkan.
 *
 * Nota: prompt sistem dalam js/ai-assistant/ai-service.js BUKAN teks UI dan
 * sengaja tidak dimasukkan ke sini.
 */

var ms = {
  // ?? Umum ????????????????????????????????????????????????????????????????????
  "ai.title": "Pembantu AI",
  "ai.send": "Hantar",
  "ai.composer.messageLabel": "Mesej",

  // ?? Widget sembang terapung (semua pengguna) ?????????????????????????????????
  "ai.widget.open": "Buka Pembantu AI",
  "ai.widget.sub": "Tanya tentang SOP syarikat, produk dan cara guna sistem.",
  "ai.widget.placeholder": "Tanya apa sahaja...",
  "ai.widget.empty": "Hai! Tanya apa sahaja tentang operasi kedai.",
  "ai.widget.error":
    "Maaf, Pembantu AI tidak dapat dihubungi buat masa ini. Sila cuba semula atau rujuk Owner.",

  // ?? Sembang owner ???????????????????????????????????????????????????????????
  "ai.owner.historyLabel": "Sejarah perbualan",
  "ai.owner.history": "Sejarah",
  "ai.owner.newChat": "Sembang baharu",
  "ai.owner.placeholder": "Tanya apa sahaja tentang pangkalan pengetahuan...",
  "ai.owner.clear": "Kosongkan",
  "ai.owner.empty": "Mulakan perbualan tentang pangkalan pengetahuan anda.",
  "ai.owner.error": "Maaf, Pembantu AI tidak dapat dihubungi buat masa ini. Sila cuba semula.",
  "ai.owner.confirmClear": "Kosongkan mesej dalam sembang ini?",

  // ?? Pangkalan pengetahuan (editor teks) ?????????????????????????????????????
  "ai.kb.title": "Pangkalan data",
  "ai.kb.edit": "Edit",
  "ai.kb.save": "Simpan",
  "ai.kb.lead":
    "Maklumat rujukan untuk Pembantu AI. Baca dalam mod paparan; klik <strong>Edit</strong> untuk ubah.",
  "ai.kb.contentLabel": "Kandungan pengetahuan",
  "ai.kb.placeholder": "## Soalan atau topik&#10;Jawapan penuh di sini...",
  "ai.kb.alertRelogin": "Sila log masuk semula.",
  "ai.kb.alertSaveFail": "Gagal simpan. Sila cuba lagi.",
  "ai.kb.alertLoadFail": "Gagal memuatkan data.",
  "ai.kb.reloginFoot": "Pastikan anda log masuk sebagai owner/admin.",
  "ai.kb.sessionMissing":
    "Sesi log masuk tidak dijumpai. Sila log masuk semula, kemudian buka Pangkalan data.",

  // ?? Modal borang pengetahuan ????????????????????????????????????????????????
  "ai.modal.addTitle": "Tambah maklumat",
  "ai.modal.editTitle": "Edit maklumat",
  "ai.modal.viewTitle": "Lihat maklumat",
  "ai.modal.deleteTitle": "Padam maklumat?",
  "ai.modal.intro":
    "Isi tajuk dan jawapan yang jelas. Staf dan AI akan guna maklumat ini apabila ditanya.",
  "ai.modal.titleLabel": "Tajuk / topik",
  "ai.modal.titleHint": "Soalan atau perkara yang biasa ditanya",
  "ai.modal.titlePlaceholder": "Contoh: Cara proses bayaran balik",
  "ai.modal.category": "Kategori",
  "ai.modal.status": "Status",
  "ai.modal.statusHint": "Aktif = AI boleh gunakan - Draf = simpan dulu - Arkib = tidak dipaparkan",
  "ai.modal.contentLabel": "Jawapan / maklumat",
  "ai.modal.contentHint": "Langkah demi langkah jika prosedur. Tulis ringkas dan tepat.",
  "ai.modal.contentPlaceholder":
    "Contoh:&#10;1) Semak resit asal&#10;2) Minta kelulusan shift lead&#10;3) Proses bayaran balik mengikut polisi",
  "ai.modal.advanced": "Pilihan lanjutan (kata kunci)",
  "ai.modal.tagsLabel": "Kata kunci",
  "ai.modal.tagsHint": "Pisahkan dengan koma - membantu carian",
  "ai.modal.tagsPlaceholder": "refund, tunai, kaunter",
  "ai.modal.cancel": "Batal",
  "ai.modal.save": "Simpan",
  "ai.modal.delete": "Padam",
  "ai.modal.deletePre": "Padam",
  "ai.modal.deletePost": "? Tindakan ini tidak boleh dibatalkan.",
  "ai.modal.alertTitle": "Sila isi tajuk / topik.",
  "ai.modal.alertContent": "Sila isi jawapan / maklumat.",

  // ?? Label kategori (nilai Firestore kekal dalam Bahasa Inggeris) ????????????
  "ai.category.productInformation": "Maklumat produk",
  "ai.category.promotions": "Promosi",
  "ai.category.sop": "SOP / Prosedur",
  "ai.category.inventory": "Inventori / Stok",
  "ai.category.attendance": "Kehadiran",
  "ai.category.salesProcess": "Proses jualan",
  "ai.category.refundPolicy": "Polisi bayaran balik",
  "ai.category.exchangePolicy": "Polisi pertukaran",
  "ai.category.faq": "Soalan lazim",
  "ai.category.other": "Lain-lain",

  // ?? Label status ????????????????????????????????????????????????????????????
  "ai.status.active": "Aktif",
  "ai.status.draft": "Draf",
  "ai.status.archived": "Arkib",

  // ?? Pilihan susunan ?????????????????????????????????????????????????????????
  "ai.sort.updatedDesc": "Terbaru dahulu",
  "ai.sort.updatedAsc": "Terlama dahulu",
  "ai.sort.titleAsc": "Tajuk (A-Z)",
  "ai.sort.titleDesc": "Tajuk (Z-A)",
  "ai.sort.categoryAsc": "Kategori (A-Z)"
};

var en = {
  // ?? General ?????????????????????????????????????????????????????????????????
  "ai.title": "AI Assistant",
  "ai.send": "Send",
  "ai.composer.messageLabel": "Message",

  // ?? Floating chat widget (all users) ????????????????????????????????????????
  "ai.widget.open": "Open the AI Assistant",
  "ai.widget.sub": "Ask about company SOPs, products and how to use the system.",
  "ai.widget.placeholder": "Ask anything...",
  "ai.widget.empty": "Hi! Ask anything about running the shop.",
  "ai.widget.error":
    "Sorry, the AI Assistant cannot be reached right now. Please try again or ask the Owner.",

  // ?? Owner chat ??????????????????????????????????????????????????????????????
  "ai.owner.historyLabel": "Conversation history",
  "ai.owner.history": "History",
  "ai.owner.newChat": "New chat",
  "ai.owner.placeholder": "Ask anything about your knowledge base...",
  "ai.owner.clear": "Clear",
  "ai.owner.empty": "Start a conversation about your knowledge base.",
  "ai.owner.error": "Sorry, the AI Assistant cannot be reached right now. Please try again.",
  "ai.owner.confirmClear": "Clear the messages in this chat?",

  // ?? Knowledge base (text editor) ????????????????????????????????????????????
  "ai.kb.title": "Database",
  "ai.kb.edit": "Edit",
  "ai.kb.save": "Save",
  "ai.kb.lead":
    "Reference information for the AI Assistant. Read it in view mode; click <strong>Edit</strong> to change it.",
  "ai.kb.contentLabel": "Knowledge content",
  "ai.kb.placeholder": "## Question or topic&#10;Full answer here...",
  "ai.kb.alertRelogin": "Please log in again.",
  "ai.kb.alertSaveFail": "Save failed. Please try again.",
  "ai.kb.alertLoadFail": "Failed to load the data.",
  "ai.kb.reloginFoot": "Make sure you are logged in as owner/admin.",
  "ai.kb.sessionMissing":
    "Login session not found. Please log in again, then open Database.",

  // ?? Knowledge form modal ????????????????????????????????????????????????????
  "ai.modal.addTitle": "Add information",
  "ai.modal.editTitle": "Edit information",
  "ai.modal.viewTitle": "View information",
  "ai.modal.deleteTitle": "Delete information?",
  "ai.modal.intro":
    "Fill in a clear title and answer. Staff and the AI will use this information when asked.",
  "ai.modal.titleLabel": "Title / topic",
  "ai.modal.titleHint": "A question or something that is commonly asked",
  "ai.modal.titlePlaceholder": "Example: How to process a refund",
  "ai.modal.category": "Category",
  "ai.modal.status": "Status",
  "ai.modal.statusHint": "Active = the AI may use it - Draft = save for later - Archived = hidden",
  "ai.modal.contentLabel": "Answer / information",
  "ai.modal.contentHint": "Step by step if it is a procedure. Keep it short and accurate.",
  "ai.modal.contentPlaceholder":
    "Example:&#10;1) Check the original receipt&#10;2) Get shift lead approval&#10;3) Process the refund according to policy",
  "ai.modal.advanced": "Advanced options (keywords)",
  "ai.modal.tagsLabel": "Keywords",
  "ai.modal.tagsHint": "Separate with commas - helps with search",
  "ai.modal.tagsPlaceholder": "refund, cash, counter",
  "ai.modal.cancel": "Cancel",
  "ai.modal.save": "Save",
  "ai.modal.delete": "Delete",
  "ai.modal.deletePre": "Delete",
  "ai.modal.deletePost": "? This action cannot be undone.",
  "ai.modal.alertTitle": "Please fill in the title / topic.",
  "ai.modal.alertContent": "Please fill in the answer / information.",

  // ?? Category labels (Firestore values stay in English) ??????????????????????
  "ai.category.productInformation": "Product information",
  "ai.category.promotions": "Promotions",
  "ai.category.sop": "SOP / Procedure",
  "ai.category.inventory": "Inventory / Stock",
  "ai.category.attendance": "Attendance",
  "ai.category.salesProcess": "Sales process",
  "ai.category.refundPolicy": "Refund policy",
  "ai.category.exchangePolicy": "Exchange policy",
  "ai.category.faq": "FAQ",
  "ai.category.other": "Other",

  // ?? Status labels ???????????????????????????????????????????????????????????
  "ai.status.active": "Active",
  "ai.status.draft": "Draft",
  "ai.status.archived": "Archived",

  // ?? Sort options ????????????????????????????????????????????????????????????
  "ai.sort.updatedDesc": "Newest first",
  "ai.sort.updatedAsc": "Oldest first",
  "ai.sort.titleAsc": "Title (A-Z)",
  "ai.sort.titleDesc": "Title (Z-A)",
  "ai.sort.categoryAsc": "Category (A-Z)"
};

export var AI = { ms: ms, en: en };
