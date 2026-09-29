import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  linkWithRedirect,
  signInWithRedirect,
  getRedirectResult,
  deleteUser,
} from 'firebase/auth';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

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

// FIXED: linkGoogleAccount() and signInWithGoogleRecovery() used to open
// a popup (linkWithPopup / signInWithPopup). That works fine on a
// desktop browser, but on a phone it's exactly the flow most likely to
// silently fail: Safari/Chrome on iOS and Android routinely block
// window.open() unless it happens synchronously inside the original tap
// (async code between the tap and the call — which this had, via
// ensureFirebaseSession() — is enough to lose that), and any in-app
// browser (Instagram, TikTok, Facebook, etc.) or installed-PWA context
// blocks Google's OAuth popup outright with "This browser or app may
// not be secure." The person taps "Link a Google account", nothing
// visibly happens, and there's no error to show because the popup call
// itself often just hangs or rejects with a vague auth/popup-blocked.
//
// A full-page redirect has none of that problem — it's the same
// navigation a link click does, so nothing can block it as a popup.
// The tradeoff is that the app reloads: signInWithRedirect/linkWithRedirect
// resolve as soon as the browser starts navigating away (not once the
// user has actually finished signing in), so there's nothing meaningful
// to await here. The real result is picked up by
// consumeGoogleRedirectResult() below, called once on mount by whichever
// page can trigger this (AccountSettings for linking, Login for
// recovery) after the browser lands back on that same page.
export async function linkGoogleAccount() {
  const auth = requireFirebase();
  const current = auth.currentUser || (await ensureFirebaseSession());
  if (!current) throw new Error('No active session to link.');
  const provider = new GoogleAuthProvider();
  await linkWithRedirect(current, provider);
}

// Signs in with Google on a NEW device/browser to recover a previously-
// linked account. If this Google account was linked before, Firebase
// resolves straight back to that same uid; if it was never linked,
// Firebase creates a brand-new (non-anonymous) account instead — the
// caller should treat that as "nothing to recover" the same way the old
// Appwrite recovery flow did. See the redirect-vs-popup note above.
export async function signInWithGoogleRecovery() {
  const auth = requireFirebase();
  const provider = new GoogleAuthProvider();
  // No resetSessionCache() call needed here the way the old popup version
  // had one after success: a redirect is a full page reload, so the
  // module-level sessionPromise this would clear is gone anyway. By the
  // time the page comes back, auth.currentUser already reflects whichever
  // account Firebase resolved the redirect to — ensureFirebaseSession()
  // picks that up on its own the normal way, no special-casing needed.
  await signInWithRedirect(auth, provider);
}

// Resolves the redirect started by linkGoogleAccount() or
// signInWithGoogleRecovery() above, once the browser lands back on the
// page that started it. Safe to call on every normal page load too —
// with no pending redirect it just resolves to null almost immediately,
// so callers don't need to know in advance whether one is pending.
export async function consumeGoogleRedirectResult() {
  const auth = requireFirebase();
  const result = await getRedirectResult(auth);
  return result?.user || null;
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
