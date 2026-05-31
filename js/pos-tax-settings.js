/**
 * Langgan peratus cukai pelanggan dari Firestore `staff_settings/default`.
 */
import { subscribeStaffSettings } from "./staff/staff-repository.js";
import { clampTaxPercent } from "./pos-tax.js";

var cachedTaxPercent = 0;
var listeners = new Set();
var unsubFirestore = null;

function emitTax() {
  var pct = cachedTaxPercent;
  listeners.forEach(function (fn) {
    try {
      fn(pct);
    } catch (e) {}
  });
}

function applySettings(data) {
  cachedTaxPercent = clampTaxPercent(data && data.customerTaxPercent);
  emitTax();
}

export function getCustomerTaxPercent() {
  return cachedTaxPercent;
}

export function subscribeCustomerTaxPercent(fn) {
  listeners.add(fn);
  try {
    fn(cachedTaxPercent);
  } catch (e) {}
  if (!unsubFirestore) {
    unsubFirestore = subscribeStaffSettings(applySettings, function () {
      cachedTaxPercent = 0;
      emitTax();
    });
  }
  return function () {
    listeners.delete(fn);
    if (!listeners.size && unsubFirestore) {
      unsubFirestore();
      unsubFirestore = null;
    }
  };
}
