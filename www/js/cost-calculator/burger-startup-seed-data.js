/**
 * Spesifikasi data seed burger — tiada import Firestore (boleh guna dari browser & Node).
 */

/** @param {Record<string,string>} slugToId */
export function buildUsage(slugToId, parts) {
  var u = {};
  for (var i = 0; i < parts.length; i++) {
    var slug = parts[i][0];
    var val = parts[i][1];
    var ingId = slugToId[slug];
    if (!ingId) continue;
    u[ingId] = val;
  }
  return u;
}

export function getIngredientCatalog() {
  return [
    {
      slug: "patty_ayam",
      name: "Patty Ayam",
      category: "Protein",
      unit: "pcs",
      listPurchasePrice: 80.34,
      listPurchaseQty: 78,
      sortIndex: 0,
      supplier: "Pembekal protein beku",
      minStockQty: 20,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 2,
          qtyOriginal: 10,
          totalRm: 10,
          daysAgoPurchase: 58,
          daysAgoOpened: 58,
          ledgerKind: "initial",
          supplierBatchCode: "SEED-PA-LOT1",
          daysToExpiry: 120,
          ledgerNotes: "Belian awal (lot lama — FIFO)"
        },
        {
          qtyRemaining: 78,
          qtyOriginal: 78,
          totalRm: 80.34,
          daysAgoPurchase: 9,
          daysAgoOpened: 9,
          ledgerKind: "purchase",
          supplierBatchCode: "SEED-PA-LOT2",
          daysToExpiry: 150,
          ledgerNotes: "Restok pati ayam"
        }
      ]
    },
    {
      slug: "patty_daging",
      name: "Patty Daging",
      category: "Protein",
      unit: "pcs",
      listPurchasePrice: 55,
      listPurchaseQty: 50,
      sortIndex: 1,
      supplier: "Pembekal protein beku",
      minStockQty: 15,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 3,
          qtyOriginal: 10,
          totalRm: 11,
          daysAgoPurchase: 45,
          daysAgoOpened: 45,
          ledgerKind: "initial",
          daysToExpiry: 110
        },
        {
          qtyRemaining: 47,
          qtyOriginal: 47,
          totalRm: 51.7,
          daysAgoPurchase: 7,
          ledgerKind: "purchase",
          daysToExpiry: 140
        }
      ]
    },
    {
      slug: "crispy_fillet",
      name: "Filet ayam rangup",
      category: "Protein",
      unit: "pcs",
      listPurchasePrice: 18,
      listPurchaseQty: 8,
      sortIndex: 2,
      supplier: "Pembekal protein beku",
      minStockQty: 6,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 32,
          qtyOriginal: 32,
          totalRm: 72,
          daysAgoPurchase: 5,
          ledgerKind: "initial",
          daysToExpiry: 90
        }
      ]
    },
    {
      slug: "telur",
      name: "Telur",
      category: "Protein",
      unit: "pcs",
      listPurchasePrice: 39,
      listPurchaseQty: 90,
      sortIndex: 3,
      supplier: "Pembekal runcit",
      minStockQty: 12,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 90,
          qtyOriginal: 90,
          totalRm: 39,
          daysAgoPurchase: 4,
          ledgerKind: "initial",
          ledgerNotes: "Setara ~3 tray (30 biji/tray, RM13/tray)",
          daysToExpiry: 21
        }
      ]
    },
    {
      slug: "roti_burger",
      name: "Roti Burger",
      category: "Roti",
      unit: "pcs",
      listPurchasePrice: 4.5,
      listPurchaseQty: 6,
      sortIndex: 4,
      supplier: "Kilang roti",
      minStockQty: 12,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 48,
          qtyOriginal: 48,
          totalRm: 36,
          daysAgoPurchase: 2,
          ledgerKind: "initial",
          daysToExpiry: 5
        }
      ]
    },
    {
      slug: "roti_obolong",
      name: "Roti Obolong",
      category: "Roti",
      unit: "pcs",
      listPurchasePrice: 5.5,
      listPurchaseQty: 6,
      sortIndex: 5,
      supplier: "Kilang roti",
      minStockQty: 12,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 42,
          qtyOriginal: 42,
          totalRm: 38.5,
          daysAgoPurchase: 2,
          ledgerKind: "initial",
          daysToExpiry: 5
        }
      ]
    },
    {
      slug: "lettuce",
      name: "Daun salad",
      category: "Sayur-sayuran",
      unit: "kg",
      listPurchasePrice: 8,
      listPurchaseQty: 1,
      sortIndex: 6,
      supplier: "Sayur segar",
      minStockQty: 0.4,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 2.5,
          qtyOriginal: 2.5,
          totalRm: 20,
          daysAgoPurchase: 1,
          ledgerKind: "initial",
          daysToExpiry: 4
        }
      ]
    },
    {
      slug: "kobis",
      name: "Kobis",
      category: "Sayur-sayuran",
      unit: "kg",
      listPurchasePrice: 4.5,
      listPurchaseQty: 1,
      sortIndex: 7,
      supplier: "Sayur segar",
      minStockQty: 0.5,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 3,
          qtyOriginal: 3,
          totalRm: 13.5,
          daysAgoPurchase: 2,
          ledgerKind: "initial",
          daysToExpiry: 7
        }
      ]
    },
    {
      slug: "timun",
      name: "Timun",
      category: "Sayur-sayuran",
      unit: "kg",
      listPurchasePrice: 5,
      listPurchaseQty: 1,
      sortIndex: 8,
      supplier: "Sayur segar",
      minStockQty: 0.5,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 4,
          qtyOriginal: 4,
          totalRm: 20,
          daysAgoPurchase: 1,
          ledgerKind: "initial",
          daysToExpiry: 5
        }
      ]
    },
    {
      slug: "bawang",
      name: "Bawang",
      category: "Sayur-sayuran",
      unit: "kg",
      listPurchasePrice: 6.5,
      listPurchaseQty: 1,
      sortIndex: 9,
      supplier: "Sayur segar",
      minStockQty: 0.3,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 2,
          qtyOriginal: 2,
          totalRm: 13,
          daysAgoPurchase: 3,
          ledgerKind: "initial",
          daysToExpiry: 14
        }
      ]
    },
    {
      slug: "sos_cili",
      name: "Sos Cili",
      category: "Sos & Perasa",
      unit: "ml",
      listPurchasePrice: 6.5,
      listPurchaseQty: 500,
      sortIndex: 10,
      supplier: "Pembekal sos",
      minStockQty: 200,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 1500,
          qtyOriginal: 1500,
          totalRm: 19.5,
          daysAgoPurchase: 10,
          ledgerKind: "initial",
          daysToExpiry: 270
        }
      ]
    },
    {
      slug: "sos_tomato",
      name: "Sos tomat",
      category: "Sos & Perasa",
      unit: "ml",
      listPurchasePrice: 6.5,
      listPurchaseQty: 500,
      sortIndex: 11,
      supplier: "Pembekal sos",
      minStockQty: 150,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 1000,
          qtyOriginal: 1000,
          totalRm: 13,
          daysAgoPurchase: 12,
          ledgerKind: "initial",
          daysToExpiry: 270
        }
      ]
    },
    {
      slug: "mayonis",
      name: "Mayones",
      category: "Sos & Perasa",
      unit: "ml",
      listPurchasePrice: 12,
      listPurchaseQty: 500,
      sortIndex: 12,
      supplier: "Pembekal sos",
      minStockQty: 150,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 800,
          qtyOriginal: 800,
          totalRm: 19.2,
          daysAgoPurchase: 8,
          ledgerKind: "initial",
          daysToExpiry: 120
        }
      ]
    },
    {
      slug: "sos_cheese",
      name: "Sos keju",
      category: "Sos & Perasa",
      unit: "ml",
      listPurchasePrice: 15,
      listPurchaseQty: 300,
      sortIndex: 13,
      supplier: "Pembekal sos",
      minStockQty: 90,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 600,
          qtyOriginal: 600,
          totalRm: 30,
          daysAgoPurchase: 14,
          ledgerKind: "initial",
          daysToExpiry: 180
        }
      ]
    },
    {
      slug: "sos_black_pepper",
      name: "Sos lada hitam",
      category: "Sos & Perasa",
      unit: "ml",
      listPurchasePrice: 10,
      listPurchaseQty: 500,
      sortIndex: 14,
      supplier: "Pembekal sos",
      minStockQty: 100,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 500,
          qtyOriginal: 500,
          totalRm: 10,
          daysAgoPurchase: 20,
          ledgerKind: "initial",
          daysToExpiry: 300
        }
      ]
    },
    {
      slug: "kentang_goreng",
      name: "Kentang Goreng",
      category: "Makanan beku & sampingan",
      unit: "g",
      listPurchasePrice: 12,
      listPurchaseQty: 1000,
      sortIndex: 15,
      supplier: "Pembekal beku",
      minStockQty: 400,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 2500,
          qtyOriginal: 3000,
          totalRm: 36,
          daysAgoPurchase: 6,
          daysAgoOpened: 6,
          ledgerKind: "initial",
          daysToExpiry: 180
        },
        {
          qtyRemaining: 800,
          qtyOriginal: 1000,
          totalRm: 12,
          daysAgoPurchase: 1,
          ledgerKind: "purchase",
          daysToExpiry: 180
        }
      ]
    },
    {
      slug: "serbuk_bbq",
      name: "Serbuk perasa BBQ",
      category: "Makanan beku & sampingan",
      unit: "g",
      listPurchasePrice: 6,
      listPurchaseQty: 100,
      sortIndex: 16,
      supplier: "Pembekal perasa",
      minStockQty: 30,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 220,
          qtyOriginal: 220,
          totalRm: 13.2,
          daysAgoPurchase: 15,
          ledgerKind: "initial",
          daysToExpiry: 365
        }
      ]
    },
    {
      slug: "serbuk_spicy",
      name: "Serbuk perasa pedas",
      category: "Makanan beku & sampingan",
      unit: "g",
      listPurchasePrice: 6,
      listPurchaseQty: 100,
      sortIndex: 17,
      supplier: "Pembekal perasa",
      minStockQty: 30,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 200,
          qtyOriginal: 200,
          totalRm: 12,
          daysAgoPurchase: 15,
          ledgerKind: "initial",
          daysToExpiry: 365
        }
      ]
    },
    {
      slug: "cheese_slice",
      name: "Hirisan keju",
      category: "Lain-lain",
      unit: "pcs",
      listPurchasePrice: 9,
      listPurchaseQty: 12,
      sortIndex: 18,
      supplier: "Pembekal tenusu",
      minStockQty: 6,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 48,
          qtyOriginal: 48,
          totalRm: 36,
          daysAgoPurchase: 4,
          ledgerKind: "initial",
          daysToExpiry: 60
        }
      ]
    },
    {
      slug: "margerin",
      name: "Marjerin",
      category: "Lain-lain",
      unit: "g",
      listPurchasePrice: 7,
      listPurchaseQty: 250,
      sortIndex: 19,
      supplier: "Pembekal runcit",
      minStockQty: 50,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 500,
          qtyOriginal: 500,
          totalRm: 14,
          daysAgoPurchase: 10,
          ledgerKind: "initial",
          daysToExpiry: 90
        }
      ]
    },
    {
      slug: "minyak_masak",
      name: "Minyak Masak",
      category: "Lain-lain",
      unit: "ml",
      listPurchasePrice: 30,
      listPurchaseQty: 2000,
      sortIndex: 20,
      supplier: "Pembekal runcit",
      minStockQty: 400,
      stockStatus: "ok",
      batchesSpec: [
        {
          qtyRemaining: 4000,
          qtyOriginal: 4000,
          totalRm: 60,
          daysAgoPurchase: 5,
          ledgerKind: "initial",
          daysToExpiry: 540
        }
      ]
    }
  ];
}

/** Templat menu & tambahan — `usageParts` guna slug bahan (bukan ID Firestore). */
export function getProductTemplates() {
  return [
    {
      name: "Burger ayam biasa",
      sellingPrice: 5.5,
      sortIndex: 100,
      usageParts: [
        ["patty_ayam", 1],
        ["roti_burger", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["timun", { guna: 18, gunaUnit: "g" }],
        ["sos_cili", { guna: 12, gunaUnit: "ml" }],
        ["mayonis", { guna: 14, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Burger daging biasa",
      sellingPrice: 6,
      sortIndex: 101,
      usageParts: [
        ["patty_daging", 1],
        ["roti_burger", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["timun", { guna: 18, gunaUnit: "g" }],
        ["sos_tomato", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Burger ayam istimewa",
      sellingPrice: 7,
      sortIndex: 102,
      usageParts: [
        ["patty_ayam", 1],
        ["roti_burger", 1],
        ["cheese_slice", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["kobis", { guna: 25, gunaUnit: "g" }],
        ["bawang", { guna: 12, gunaUnit: "g" }],
        ["sos_tomato", { guna: 8, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Burger daging istimewa",
      sellingPrice: 7.5,
      sortIndex: 103,
      usageParts: [
        ["patty_daging", 1],
        ["roti_burger", 1],
        ["cheese_slice", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["kobis", { guna: 25, gunaUnit: "g" }],
        ["bawang", { guna: 12, gunaUnit: "g" }],
        ["sos_black_pepper", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Burger ayam rangup",
      sellingPrice: 8.5,
      sortIndex: 104,
      usageParts: [
        ["crispy_fillet", 1],
        ["roti_burger", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["timun", { guna: 18, gunaUnit: "g" }],
        ["sos_cheese", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 14, gunaUnit: "ml" }],
        ["margerin", { guna: 5, gunaUnit: "g" }]
      ]
    },
    {
      name: "Obolong ayam biasa",
      sellingPrice: 6.5,
      sortIndex: 105,
      usageParts: [
        ["patty_ayam", 1],
        ["roti_obolong", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["timun", { guna: 18, gunaUnit: "g" }],
        ["sos_cili", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 14, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Obolong daging biasa",
      sellingPrice: 7,
      sortIndex: 106,
      usageParts: [
        ["patty_daging", 1],
        ["roti_obolong", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["timun", { guna: 18, gunaUnit: "g" }],
        ["sos_tomato", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Obolong ayam istimewa",
      sellingPrice: 8,
      sortIndex: 107,
      usageParts: [
        ["patty_ayam", 1],
        ["roti_obolong", 1],
        ["cheese_slice", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["kobis", { guna: 28, gunaUnit: "g" }],
        ["bawang", { guna: 12, gunaUnit: "g" }],
        ["sos_tomato", { guna: 8, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Obolong daging istimewa",
      sellingPrice: 8.5,
      sortIndex: 108,
      usageParts: [
        ["patty_daging", 1],
        ["roti_obolong", 1],
        ["cheese_slice", 1],
        ["lettuce", { guna: 22, gunaUnit: "g" }],
        ["kobis", { guna: 28, gunaUnit: "g" }],
        ["bawang", { guna: 12, gunaUnit: "g" }],
        ["sos_black_pepper", { guna: 10, gunaUnit: "ml" }],
        ["mayonis", { guna: 12, gunaUnit: "ml" }],
        ["margerin", { guna: 4, gunaUnit: "g" }]
      ]
    },
    {
      name: "Benjo",
      sellingPrice: 4.5,
      sortIndex: 109,
      usageParts: [
        ["patty_ayam", 0.5],
        ["roti_burger", 1],
        ["sos_cili", { guna: 8, gunaUnit: "ml" }],
        ["mayonis", { guna: 10, gunaUnit: "ml" }],
        ["margerin", { guna: 3, gunaUnit: "g" }]
      ]
    },
    {
      name: "Kentang goreng perasa BBQ",
      sellingPrice: 5,
      sortIndex: 110,
      usageParts: [
        ["kentang_goreng", { guna: 130, gunaUnit: "g" }],
        ["serbuk_bbq", { guna: 7, gunaUnit: "g" }],
        ["minyak_masak", { guna: 18, gunaUnit: "ml" }]
      ]
    },
    {
      name: "Kentang goreng pedas",
      sellingPrice: 5,
      sortIndex: 111,
      usageParts: [
        ["kentang_goreng", { guna: 130, gunaUnit: "g" }],
        ["serbuk_spicy", { guna: 7, gunaUnit: "g" }],
        ["minyak_masak", { guna: 18, gunaUnit: "ml" }]
      ]
    },
    {
      name: "Tambah keju",
      sellingPrice: 1.5,
      sortIndex: 200,
      usageParts: [["cheese_slice", 1]]
    },
    {
      name: "Tambah telur",
      sellingPrice: 1.5,
      sortIndex: 201,
      usageParts: [["telur", 1]]
    },
    {
      name: "Tambah pati",
      sellingPrice: 2.5,
      sortIndex: 202,
      usageParts: [["patty_daging", 1]]
    },
    {
      name: "Tambah sayur",
      sellingPrice: 0.5,
      sortIndex: 203,
      usageParts: [
        ["lettuce", { guna: 35, gunaUnit: "g" }],
        ["kobis", { guna: 25, gunaUnit: "g" }],
        ["timun", { guna: 22, gunaUnit: "g" }]
      ]
    }
  ];
}
