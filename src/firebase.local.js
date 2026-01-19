import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";


// 1. Config Logic
const localConfig = JSON.parse(localStorage.getItem("firebase_custom_config") || "null");
let firebaseConfig = {};

if (localConfig && localConfig.apiKey) {
  firebaseConfig = localConfig;
} else {
  firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ""
  };
}

// 2. Initialize
let app, auth, db, provider;

if (firebaseConfig.apiKey) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
  } catch (e) { console.error("Firebase Init Failed:", e); }
} else { console.warn("Firebase keys missing."); }

// --- AUTHENTICATION ---

async function trySignIn() {
  if (!auth) throw new Error("Firebase not initialized.");
  if (auth.currentUser) return auth.currentUser;

  // 1. DYNAMIC OAUTH (Settings > Client ID)
  const clientId = localStorage.getItem("oauth_client_id");

  if (clientId && chrome && chrome.identity && chrome.identity.launchWebAuthFlow) {
    try {
      console.log("Aha: Starting Dynamic OAuth Flow...");
      const redirectUri = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/

      // Construct Auth URL manually
      const authUrl = `https://accounts.google.com/o/oauth2/auth` +
        `?client_id=${clientId}` +
        `&response_type=id_token` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=email%20profile%20openid` +
        `&nonce=${Math.random().toString(36).substring(2)}`;

      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
          url: authUrl,
          interactive: true
        }, (responseUrl) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(responseUrl);
        });
      });

      // Parse ID Token from URL Fragment
      // URL looks like: https://<id>.chromiumapp.org/#id_token=...&...
      const urlParams = new URLSearchParams(new URL(responseUrl).hash.substring(1)); // substring(1) removes '#'
      const idToken = urlParams.get("id_token");

      if (!idToken) throw new Error("No id_token found in response.");

      console.log("Aha: Got ID Token via WebAuthFlow!");
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      return result.user;

    } catch (e) {
      console.warn("Dynamic OAuth failed:", e);
      // Fallback to Anonymous
    }
  }

  // 2. Fallback: Anonymous Auth
  try {
    console.log("Aha: Signing in anonymously...");
    const result = await signInAnonymously(auth);
    console.log("Aha: Signed in as", result.user.uid);
    return result.user;
  } catch (e) {
    console.error("Anonymous Auth Failed:", e);
    throw e;
  }
}

async function ensureAuth() {
  if (!auth) throw new Error("Missing Config/API Key.");
  if (auth.currentUser) return auth.currentUser;

  // Auto-attempt sign-in if not authenticated
  try {
    return await trySignIn();
  } catch (e) {
    throw new Error("Sign-in failed: " + e.message);
  }
}

async function saveEntry(payload) {
  if (!db) throw new Error("Cloud sync disabled.");

  const finalPayload = {
    ...payload,
    status: "open",
    createdAt: serverTimestamp()
  };
  // Returns the Document Reference (contains the Real Cloud ID)
  return await addDoc(collection(db, "raw_entries"), finalPayload);
}

async function fetchOpenContexts() {
  if (!db) return [];
  try {
    const q = query(
      collection(db, "raw_entries"),
      where("status", "==", "open")
      // Removed sessionRef filter to allow fetching replies for counters
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id, // Real Cloud ID
      ...doc.data(),
      timestamp: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().getTime() : Date.now()
    }));
  } catch (e) {
    console.error("Fetch failed:", e);
    return [];
  }
}

async function markEntryDone(id) {
  if (!db) return;
  const ref = doc(db, "raw_entries", id);
  await updateDoc(ref, { status: "done" });
}

async function markEntryActive(id) {
  if (!db) return;
  const ref = doc(db, "raw_entries", id);
  await updateDoc(ref, { status: "open" });
}

async function updateEntry(id, fields) {
  if (!db) return;
  const ref = doc(db, "raw_entries", id);
  await updateDoc(ref, fields);
}

async function deleteEntry(id) {
  if (!db) return;
  const ref = doc(db, "raw_entries", id);
  await deleteDoc(ref);
}

export { auth, provider, trySignIn, ensureAuth, saveEntry, fetchOpenContexts, markEntryDone, markEntryActive, updateEntry, deleteEntry };