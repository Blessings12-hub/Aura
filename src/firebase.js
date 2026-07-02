// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk",
  authDomain: "aura-5693e.firebaseapp.com",
  databaseURL: "https://aura-5693e-default-rtdb.firebaseio.com",
  projectId: "aura-5693e",
  storageBucket: "aura-5693e.firebasestorage.app",
  messagingSenderId: "1028269030459",
  appId: "1:1028269030459:web:43762becb2ccccb61c301e",
  measurementId: "G-9PG36HYYR7"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
// Realtime Database — used specifically for presence (online/last-seen).
// Firestore has no reliable "the client disconnected" signal; RTDB's
// onDisconnect() is handled server-side, so it fires even on a crashed tab
// or lost connection, not just a clean unmount.
export const rtdb = getDatabase(app);