import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
} from 'firebase/auth';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyD3SJuB_zajVYspjfXWccVHoENx6E-HXhk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'aura-5693e.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'aura-5693e',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'aura-5693e.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1028269030459',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1028269030459:web:43762becb2ccccb61c301e',
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
const app = firebaseConfigured ? (getApps()[0] || initializeApp(firebaseConfig)) : null;
export const firebaseAuth = app ? getAuth(app) : null;

export function requireFirebase() {
  if (!firebaseAuth) {
    throw new Error('Firebase Auth is not configured. Add the VITE_FIREBASE_* web app variables.');
  }
  return firebaseAuth;
}

export async function ensureFirebaseSession() {
  const auth = requireFirebase();
  if (auth.currentUser) return auth.currentUser;
  const result = await signInAnonymously(auth);
  return result.user;
}

export function observeFirebaseAuth(callback) {
  if (!firebaseAuth) return () => {};
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signOutFirebase() {
  if (firebaseAuth) await signOut(firebaseAuth);
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
