import { initializeApp, applicationDefault, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

/**
 * Server-side (admin-privileged) access to the same Firestore project the
 * client uses for Config sync (src/services/firebase.ts) - needed for the
 * PayPal sweeper background job (Code Hardening item #2, Step 4), which
 * runs on a timer with no logged-in request to read `Config` or persist a
 * background-sync credential with.
 *
 * Bypasses firestore.rules entirely (that's what "admin" means here) -
 * only ever touches the `system/paypalSweeperAuth` doc (not covered by
 * firestore.rules, and never client-writable) and reads `settings/global`
 * (the same Config document the client already syncs, just read-only from
 * here).
 *
 * Requires Application Default Credentials to actually authenticate - on
 * Google Cloud (Cloud Run, etc.) this resolves automatically from the
 * attached service account; for local development, run
 * `gcloud auth application-default login` or set
 * `GOOGLE_APPLICATION_CREDENTIALS` to a downloaded service account key.
 * Constructing the app below never fails without those - failures only
 * surface when a query actually runs, which every caller here already
 * handles as a soft/best-effort failure.
 */
let app: App | null = null;
let db: Firestore | null = null;

export function getAdminFirestore(): Firestore {
  if (!app) {
    app = initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId,
    });
  }
  if (!db) {
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
  return db;
}
