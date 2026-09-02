import type { Auth, GoogleAuthProvider as GoogleAuthProviderClass, User, UserCredential } from 'firebase/auth';
import type { DocumentReference, Firestore, DocumentSnapshot, FirestoreError, Unsubscribe } from 'firebase/firestore';

interface FirebaseServices {
  auth: Auth;
  db: Firestore;
  GoogleAuthProvider: typeof GoogleAuthProviderClass;
  onAuthStateChanged: (auth: Auth, callback: (user: User | null) => void) => Unsubscribe;
  signInWithPopup: (auth: Auth, provider: GoogleAuthProviderClass) => Promise<UserCredential>;
  signOut: (auth: Auth) => Promise<void>;
  doc: (db: Firestore, path: string, ...pathSegments: string[]) => DocumentReference;
  setDoc: (ref: DocumentReference, data: object) => Promise<void>;
  onSnapshot: (
    ref: DocumentReference,
    onNext: (snapshot: DocumentSnapshot) => void,
    onError: (error: FirestoreError) => void
  ) => Unsubscribe;
  serverTimestamp: () => unknown;
}

let firebasePromise: Promise<FirebaseServices> | null = null;

/**
 * Lazily initializes the Firebase SDK on first call and memoizes the
 * result. Keeps `firebase`/`@firebase/*` - the single largest vendor
 * chunk - out of the app's initial JS bundle, since cross-device config
 * sync isn't needed for first paint (see refactor-opportunities.md /
 * CHANGELOG.md). Re-exports only the named functions this app actually
 * uses (rather than the whole `auth`/`firestore` module namespaces) so
 * Rollup can still tree-shake the rest of those SDKs out of this lazy
 * chunk too.
 */
export function getFirebase(): Promise<FirebaseServices> {
  if (!firebasePromise) {
    firebasePromise = initFirebase();
  }
  return firebasePromise;
}

async function initFirebase(): Promise<FirebaseServices> {
  const [
    { initializeApp },
    { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut },
    { getFirestore, doc, setDoc, onSnapshot, serverTimestamp, getDocFromServer },
    { default: firebaseConfig },
  ] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
    import('../../firebase-applet-config.json'),
  ]);

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const auth = getAuth(app);

  // Connectivity Test
  try {
    await getDocFromServer(doc(db, 'settings', 'connection-test'));
    console.log("[Firebase] Connection test complete.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("[Firebase] Client is offline. Check Firebase configuration.");
    }
  }

  return { auth, db, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, doc, setDoc, onSnapshot, serverTimestamp };
}
