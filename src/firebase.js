// src/firebase.js
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database';

// Config now comes from Vite env vars (see .env.example) instead of being
// hardcoded here. This isn't hiding a secret — a Firebase web apiKey is not
// sensitive, security rules are the real gate — it's about having ONE place
// (Vercel's Environment Variables screen) where these values live, instead
// of them being buried in source and drifting out of sync with .env.example.
//
// The hardcoded values are kept as fallbacks so nothing breaks on the
// current Vercel deployment before its env vars are set. Once
// VITE_FIREBASE_* is added in Vercel -> Settings -> Environment Variables
// and redeployed, the env values take over automatically and these
// fallbacks become dead weight you can delete.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'aura-5693e.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://aura-5693e-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'aura-5693e',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'aura-5693e.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1028269030459',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1028269030459:web:43762becb2ccccb61c301e',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-9PG36HYYR7',
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

// Firebase App Check — proves requests are coming from this real, unmodified
// app instance, not a script hitting the Firestore/Storage/RTDB REST API
// directly with the same config values (which anyone can read out of this
// public bundle; the security rules are the actual gate, but App Check adds
// a second layer that blocks non-app traffic before it even reaches them).
//
// To turn this on: Firebase Console -> App Check -> register this web app
// with the reCAPTCHA v3 provider, then set VITE_FIREBASE_RECAPTCHA_SITE_KEY
// in your .env to the site key it gives you. Leave it unset and the app
// runs exactly as before — App Check is opt-in here, not required.
// IMPORTANT: only flip enforcement on per-product (Firestore/Storage/RTDB)
// in the console AFTER confirming real traffic is generating valid tokens
// (App Check's "Requests" metrics tab), or you'll lock out real users too.
const recaptchaSiteKey = import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
} else if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    'App Check not initialized — set VITE_FIREBASE_RECAPTCHA_SITE_KEY '
    + 'to enable it (see comment above this line in src/firebase.js).',
  );
}

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
// Realtime Database — used specifically for presence (online/last-seen).
// Firestore has no reliable "the client disconnected" signal; RTDB's
// onDisconnect() is handled server-side, so it fires even on a crashed tab
// or lost connection, not just a clean unmount.
export const rtdb = getDatabase(app);
