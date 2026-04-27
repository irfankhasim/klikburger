import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

var __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Laluan punca repo (scripts/lib → .. → ..). */
export function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

/** Baca `projectId` lalai daripada `.firebaserc`. */
export function readDefaultFirebaseProjectId() {
  var root = getRepoRoot();
  var p = path.join(root, ".firebaserc");
  if (!existsSync(p)) return "possystem-6907d";
  try {
    var j = JSON.parse(readFileSync(p, "utf8"));
    var id = j.projects && j.projects.default;
    return typeof id === "string" && id ? id : "possystem-6907d";
  } catch (e) {
    return "possystem-6907d";
  }
}
