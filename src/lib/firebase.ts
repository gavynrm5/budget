import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { firebaseConfig, isFirebaseConfigured } from "../config/firebase";

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;

// Offline persistence: data is cached in IndexedDB, the app works with no
// signal, and queued writes sync automatically when the connection returns.
export const db = app
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true
    })
  : null;

if (auth) setPersistence(auth, browserLocalPersistence).catch(() => {});

export async function signInWithGoogle() {
  if (!auth) return;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    // Some installed-app contexts block popups. Fall back to a full redirect.
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      throw err;
    }
  }
}

export function signOut() {
  return auth ? fbSignOut(auth) : Promise.resolve();
}
