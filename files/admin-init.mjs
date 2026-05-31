/**
 * mcp/lib/admin-init.mjs
 * Firestore Admin SDK initializer.
 * Reuses same pattern as scripts/lib/admin-init.mjs.
 *
 * Env vars (in priority order):
 *   GOOGLE_APPLICATION_CREDENTIALS  — path to service account JSON
 *   FIRESTORE_EMULATOR_HOST         — if set, connects to emulator
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

let _db = null;

export async function getAdminFirestore() {
  if (_db) return _db;

  if (!getApps().length) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ?? resolve(process.cwd(), 'firebase-service-account.json');

    let credential;
    try {
      const raw = await readFile(credPath, 'utf8');
      credential = cert(JSON.parse(raw));
    } catch {
      // Emulator mode — no credentials needed
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'possystem-6907d' });
        _db = getFirestore();
        return _db;
      }
      throw new Error(
        `Cannot load service account from ${credPath}. ` +
        `Set GOOGLE_APPLICATION_CREDENTIALS or FIRESTORE_EMULATOR_HOST.`
      );
    }

    initializeApp({ credential });
  }

  _db = getFirestore();
  return _db;
}
