#!/usr/bin/env node
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

async function main() {
  ensureAdminInitialized();
  const db = getAdminFirestore();

  const ingsSnap = await db.collection("ingredients").get();
  const ingMap = {};
  ingsSnap.docs.forEach(d => { ingMap[d.data().name] = { id: d.id, ...d.data() }; });
  console.log("Ingredients loaded:", Object.keys(ingMap).length);

  const openedAt = Timestamp.fromDate(new Date(2026, 2, 1));
  const batch = db.batch();

  const stocks = [
    { name: "Patty Ayam",        qty: 1100,  cpu: 1.03  },
    { name: "Patty Daging",      qty: 650,   cpu: 1.10  },
    { name: "Ayam Crispy",       qty: 250,   cpu: 2.25  },
    { name: "Roti Burger",       qty: 1700,  cpu: 0.75  },
    { name: "Roti Obolong",      qty: 150,   cpu: 1.28  },
    { name: "Cheese Slice",      qty: 680,   cpu: 0.75  },
    { name: "Telur",             qty: 200,   cpu: 0.43  },
    { name: "Lettuce",           qty: 42,    cpu: 4.50  },
    { name: "Timun",             qty: 22,    cpu: 5.00  },
    { name: "Kobis",             qty: 18,    cpu: 3.00  },
    { name: "Bawang",            qty: 9,     cpu: 6.50  },
    { name: "Sos Cili",          qty: 8000,  cpu: 0.013 },
    { name: "Sos Tomato",        qty: 7000,  cpu: 0.013 },
    { name: "Mayonis",           qty: 25000, cpu: 0.024 },
    { name: "Sos Cheese",        qty: 2000,  cpu: 0.050 },
    { name: "Sos Black Pepper",  qty: 2800,  cpu: 0.020 },
    { name: "Kentang Goreng",    qty: 14000, cpu: 0.012 },
    { name: "Minyak Masak",      qty: 3500,  cpu: 0.015 },
    { name: "Margerin",          qty: 8000,  cpu: 0.028 }
  ];

  let count = 0;
  stocks.forEach(item => {
    const ing = ingMap[item.name];
    if (!ing) { console.log("Skip:", item.name); return; }
    const ref = db.collection("ingredient_batches").doc();
    batch.set(ref, {
      ingredientId: ing.id,
      qtyRemaining: item.qty,
      qtyOriginal: item.qty,
      costPerUnit: item.cpu,
      openedAt: openedAt,
      purchaseOccurredAt: openedAt,
      synthetic: false,
      createdAt: FieldValue.serverTimestamp()
    });
    count++;
    console.log("OK:", item.name, item.qty);
  });

  await batch.commit();
  console.log("Selesai —", count, "batch ditambah.");
}

main().catch(err => { console.error(err); process.exit(1); });
