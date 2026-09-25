import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  deleteUser,
} from 'firebase/auth';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const app = firebaseConfigured ? (getApps()[0] || initializeApp(firebaseConfig)) : null;

// FOUND IN A READINESS REVIEW: useSendCooldown.js's own comment already
// said this plainly — the message-send throttle it implements is
// client-side only, and "anyone calling the Firestore SDK directly
// bypasses this entirely." That's true of every write in this app, not
// just chat messages: nothing stopped a script from calling
// signInAnonymously() directly (trivial — it's a public, unauthenticated
// Firebase Auth method) and then writing to Firestore as fast as the
// network allows, completely outside this web app.
//
// App Check closes that specific gap: once enabled, Firestore requires
// every client-SDK request to carry proof it's coming from a real
// instance of THIS app running in a real browser (reCAPTCHA v3, invisible
// to users — no challenge to solve) rather than a bare script holding
// stolen or freshly-minted credentials. It does not replace real rate
// limiting for a legitimate user double-tapping "send" (that's still
// useSendCooldown's job) — it stops the class of abuse that skips the UI
// entirely.
//
// SEQUENCING MATTERS HERE — read this before touching the Firebase
// Console: enabling Firestore enforcement (a toggle in Firebase Console →
// App Check) is an ALL-OR-NOTHING switch for every client Firestore call
// in the entire app, not just chat. If VITE_RECAPTCHA_SITE_KEY below is
// missing, wrong, or this code hasn't actually been deployed yet,
// enabling enforcement will reject every Firestore read and write from
// every user — the whole app goes down, not just message spam. Deploy
// this file FIRST, confirm (Firebase Console → App Check → your app
// should show real request volume within a few minutes of normal use)
// that tokens are actually being issued, and only THEN flip enforcement
// on. Enforcement stays OFF by default until you turn it on — deploying
// this alone changes nothing for users.
if (app && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Never let App Check's own setup break the app that depends on it —
    // worst case here is enforcement (once turned on) starts rejecting
    // requests, which is loud and immediately obvious, rather than this
    // throwing during startup and taking everything down silently.
    console.error('App Check init failed', err);
  }
}
export const firebaseAuth = app ? getAuth(app) : null;

export function requireFirebase() {
  if (!firebaseAuth) {
    throw new Error('Aura is not connected to Firebase. Add the VITE_FIREBASE_* web app variables.');
  }
  return firebaseAuth;
}

// ---------------------------------------------------------------------------
// ONE session, ever.
//
// The old version of ensureFirebaseSession() checked `auth.currentUser` and,
// if it was null, immediately called signInAnonymously(). On a cold load,
// currentUser is null for everybody for the first few hundred milliseconds
// while Firebase restores the saved session out of IndexedDB — and in that
// window PresenceRoot, useCurrentUser (on whatever page mounted), Login.jsx
// and React StrictMode's double-mount ALL called this function at once. Each
// one saw currentUser === null and each one started its own sign-in.
//
// Two things went wrong as a result, and they're the two errors in the
// console:
//
//   * "AbortError: The user aborted a request." — each new sign-in attempt
//     cancels the in-flight auth/token requests started by the previous one.
//     Five racing callers = a burst of aborted requests, one logged per
//     cancelled call.
//
//   * "FirebaseError: Missing or insufficient permissions." — Firestore
//     reads that were already in flight were signed with a uid that the
//     race had just thrown away (or with no uid at all, because auth hadn't
//     landed yet). firestore.rules requires request.auth != null on
//     essentially every collection, so those reads are rejected.
//
// The fix is to make this function idempotent: wait for Firebase's own
// restore to finish FIRST, only sign in anonymously if there's genuinely
// nobody, and cache the promise so that every caller — however many there
// are, however early they run — awaits the exact same sign-in.
// ---------------------------------------------------------------------------
let sessionPromise = null;

function waitForInitialAuth(auth) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => { unsubscribe(); resolve(user); },
      (error) => { unsubscribe(); reject(error); },
    );
  });
}

export function ensureFirebaseSession() {
  const auth = requireFirebase();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!sessionPromise) {
    sessionPromise = (async () => {
      // Keep the anonymous uid across reloads. Without this, a browser that
      // can't use the default IndexedDB persistence silently falls back to
      // in-memory, which means a brand-new uid on every refresh and a
      // users/{uid} doc that never exists — which the app reads as "not
      // registered" and bounces to /login forever.
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch {
        // Private mode / storage blocked. Firebase falls back on its own;
        // the session just won't survive a reload, which is not fatal.
      }

      const restored = await waitForInitialAuth(auth);
      if (restored) return restored;

      const result = await signInAnonymously(auth);
      return result.user;
    })();

    // If sign-in genuinely fails (offline, bad config), clear the cache so a
    // later attempt can retry instead of being stuck on a rejected promise.
    sessionPromise.catch(() => { sessionPromise = null; });
  }

  return sessionPromise;
}

// Call this after anything that deliberately ends the current session, so
// the next ensureFirebaseSession() starts a fresh one instead of handing
// back the old, now-invalid user.
function resetSessionCache() {
  sessionPromise = null;
}

// Drop-in replacement for Appwrite's getCurrentAccount() — same `.$id`
// shape so call sites that used to read currentAccount.$id don't need to
// change. Waits for auth to be ready (signs in anonymously if needed)
// rather than racing firebaseAuth.currentUser, which can still be null on
// first load before Firebase has restored/created a session.
export async function getCurrentFirebaseUser() {
  const user = await ensureFirebaseSession();
  if (!user) return null;
  return { $id: user.uid, uid: user.uid, isAnonymous: user.isAnonymous, email: user.email };
}

export function observeFirebaseAuth(callback) {
  if (!firebaseAuth) return () => {};
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signOutFirebase() {
  if (firebaseAuth) await signOut(firebaseAuth);
  resetSessionCache();
}

// Links a Google account to the CURRENT anonymous session, so the same
// uid (and therefore the same users/{uid} doc, matches, history) can be
// recovered later on a new device. This is the "Link a Google account"
// button in Account Settings.
export async function linkGoogleAccount() {
  const auth = requireFirebase();
  const current = auth.currentUser || (await ensureFirebaseSession());
  if (!current) throw new Error('No active session to link.');
  const provider = new GoogleAuthProvider();
  const result = await linkWithPopup(current, provider);
  return result.user;
}

// Signs in with Google on a NEW device/browser to recover a previously-
// linked account. If this Google account was linked before, Firebase
// resolves straight back to that same uid; if it was never linked,
// Firebase creates a brand-new (non-anonymous) account instead — the
// caller should treat that as "nothing to recover" the same way the old
// Appwrite recovery flow did.
export async function signInWithGoogleRecovery() {
  const auth = requireFirebase();
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  resetSessionCache();
  return result.user;
}

export async function deleteCurrentFirebaseUser() {
  const auth = requireFirebase();
  if (!auth.currentUser) return;
  await deleteUser(auth.currentUser);
  resetSessionCache();
}

export async function registerFirebaseMessaging() {
  if (!firebaseConfigured || typeof window === 'undefined' || !(await isSupported())) return null;
  const messaging = getMessaging(app);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) return null;
  return getToken(messaging, { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready });
}

export async function listenForFirebaseMessages(callback) {
  if (!firebaseConfigured || typeof window === 'undefined' || !(await isSupported())) return () => {};
  return onMessage(getMessaging(app), callback);
}

export { firebaseConfig };
