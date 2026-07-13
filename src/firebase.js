// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk,
  authDomain: import.meta.env.VITE_aura-5693e.firebaseapp.com,
  databaseURL: import.meta.env.VITE_https://aura-5693e-default-rtdb.firebaseio.com,
  projectId: import.meta.env.VITE_aura-5693e,
  storageBucket: import.meta.env.VITE_aura-5693e.firebasestorage.app,
  messagingSenderId: import.meta.env.VITE_1028269030459,
  appId: import.meta.env.VITE_1:1028269030459:web:43762becb2ccccb61c301e,
  measurementId: import.meta.env.VITE_G-9PG36HYYR7,
};

if (!firebaseConfig.apiKey) {
  // Fails loudly at startup instead of Firebase throwing a cryptic
  // "invalid-api-key" error later, the first time something tries to talk
  // to Firestore/Auth — this is almost always a missing .env file.
  throw new Error(
    'Missing Firebase config. Copy .env.example to .env and fill in your '
    + 'Firebase project values (Firebase Console -> Project settings).',
  );
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
// Realtime Database — used specifically for presence (online/last-seen).
// Firestore has no reliable "the client disconnected" signal; RTDB's
// onDisconnect() is handled server-side, so it fires even on a crashed tab
// or lost connection, not just a clean unmount.
export const rtdb = getDatabase(app);
