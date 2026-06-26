import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

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

export function signInAnon() {
  return signInAnonymously(auth);
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}