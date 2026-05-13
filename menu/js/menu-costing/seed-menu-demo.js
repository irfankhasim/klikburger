/**
 * Data demo untuk `recipes` + `menu_items` (hanya jika kedua-dua koleksi kosong).
 * Tidak sentuh `ingredients` / `modifiers`.
 */
import { db, collection, getDocs, addDoc } from "../../../shared/firebase/init.js";
import { COL_INGREDIENTS, COL_RECIPES, COL_MENU_ITEMS } from "../../../shared/firebase/collections.js";

export async function seedMenuCostingIfEmpty() {
  var rSnap = await getDocs(collection(db, COL_RECIPES));
  var mSnap = await getDocs(collection(db, COL_MENU_ITEMS));
  if (!rSnap.empty || !mSnap.empty) return { seeded: false, reason: "collections-not-empty" };

  var ingSnap = await getDocs(collection(db, COL_INGREDIENTS));
  if (ingSnap.empty) return { seeded: false, reason: "no-ingredients" };

  var ids = ingSnap.docs.map(function (d) {
    return d.id;
  });
  var first = ids[0];
  var second = ids[1] || first;
  var usage = {};
  usage[first] = 100;
  if (second !== first) usage[second] = 1;

  var recipeRef = await addDoc(collection(db, COL_RECIPES), {
    sortIndex: 0,
    name: "Resipi demo (contoh BOM)",
    usage: usage
  });

  await addDoc(collection(db, COL_MENU_ITEMS), {
    sortIndex: 0,
    name: "Item menu demo",
    sellingPrice: 12.5,
    recipeId: recipeRef.id
  });

  return { seeded: true, recipeId: recipeRef.id };
}
