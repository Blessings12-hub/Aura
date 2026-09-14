import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  deleteUser,
} from 'firebase/auth';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

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
export const firebaseAuth = app ? getAuth(app) : null;

export function requireFirebase() {
  if (!firebaseAuth) {
    throw new Error('Aura is not connected to Firebase. Add the VITE_FIREBASE_* web app variables.');
  }
  return firebaseAuth;
}

export async function ensureFirebaseSession() {
  const auth = requireFirebase();
  if (auth.currentUser) return auth.currentUser;
  const result = await signInAnonymously(auth);
  return result.user;
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
}

// Links a Google account to the CURRENT anonymous session, so the same
// uid (and therefore the same users/{uid} doc, matches, history) can be
// recovered later on a new device. This is the "Link a Google account"
// button in Account Settings.
export async function linkGoogleAccount() {
  const auth = requireFirebase();
  if (!auth.currentUser) throw new Error('No active session to link.');
  const provider = new GoogleAuthProvider();
  const result = await linkWithPopup(auth.currentUser, provider);
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
  return result.user;
}

export async function deleteCurrentFirebaseUser() {
  const auth = requireFirebase();
  if (!auth.currentUser) return;
  await deleteUser(auth.currentUser);
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
