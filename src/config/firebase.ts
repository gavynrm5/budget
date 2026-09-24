/**
 * ============================================================
 *  PASTE YOUR FIREBASE WEB APP CONFIG HERE
 * ============================================================
 * Firebase console > Project settings (gear icon) > General >
 * "Your apps" > your Web app > "SDK setup and configuration" > Config.
 *
 * Copy each value from that snippet into the matching field below.
 * These values are not secret. Your data is protected by the Firestore
 * security rules in firestore.rules, not by hiding this config.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyC6FSbPWouWNlImIIPChDM34pPiMOB-J50",
  authDomain: "my-budget-ff7ca.firebaseapp.com",
  projectId: "my-budget-ff7ca",
  storageBucket: "my-budget-ff7ca.firebasestorage.app",
  messagingSenderId: "278959982656",
  appId: "1:278959982656:web:d11c6246fff2351be877a5"
};

export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
