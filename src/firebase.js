// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
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