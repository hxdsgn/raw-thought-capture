import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc } from "firebase/firestore";

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

// --- HELPER FUNCTIONS ---

async function ensureAuth() {
  if (!auth) throw new Error("Missing Config/API Key.");
  if (auth.currentUser) return auth.currentUser;
  throw new Error("User not signed in");
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
      where("status", "==", "open"),
      where("sessionRef", "==", null)
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

export { auth, provider, signInWithPopup, ensureAuth, saveEntry, fetchOpenContexts, markEntryDone };